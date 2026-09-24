/* /api/admin/* 전체에 걸리는 관문 — ① 로그인+관리자 확인 ② PIN(2단계) 확인 ③ 직원별 영역 권한 확인.
   라우트마다 흩어져 있던 requireAdmin은 그대로 두고(이 관문이 통과시킨 요청은 req.adminVerified로
   재검증을 건너뜀), "어느 경로가 어느 영역이냐"만 아래 AREAS 표 한 곳에서 관리한다 — 새 관리자 API를
   추가하면 이 표에 안 넣은 이상 마스터 관리자만 쓸 수 있다(기본 거부).
   PIN/권한 테이블(마이그레이션 040)이 없으면 그 검사만 꺼지고 기존 방식으로 동작한다. */
const crypto = require("crypto");
const { supabaseAdmin } = require("./supabase");
const { isMissingSchemaError } = require("./pgErrors");
const { MASTER_ADMIN_EMAIL } = require("./auth");

/* 영역 정의 — key는 DB(admin_permissions.permissions)에 그대로 저장되는 값이라 바꾸지 말 것.
   tabs는 Works 사이드바 data-tab, paths는 /api/admin/ 뒤의 경로 접두어(긴 것부터 매칭). */
const AREAS = {
  orders: { label: "주문·배송", tabs: ["orders"], paths: ["orders"] },
  returns: { label: "반품·교환", tabs: ["returns"], paths: ["returns"] },
  inventory: { label: "재고", tabs: ["inventory"], paths: ["inventory"] },
  qna: { label: "문의(Q&A)·CS 템플릿", tabs: ["qna"], paths: ["qna", "qna-templates"] },
  payments: { label: "결제 내역·시스템 오류", tabs: ["paymentlog"], paths: ["payment-log", "system-errors"] },
  products: { label: "상품·색상", tabs: ["products"], paths: ["products", "colors"] },
  coupons: { label: "쿠폰", tabs: ["coupons"], paths: ["coupons"] },
  reviews: { label: "리뷰", tabs: ["reviews"], paths: ["reviews"] },
  lookbook: { label: "룩북", tabs: ["lookbook"], paths: ["lookbook"] },
  members: { label: "회원 계정 관리", tabs: ["members"], paths: ["members"] },
  collab: { label: "협업(캘린더·공지·인수인계)", tabs: ["calendar", "notices"], paths: ["calendar-events", "notices", "handoff-notes"] },
  outbox: { label: "발송 실패 아웃박스", tabs: ["outbox"], paths: ["outbox"] },
  settings: { label: "정보·백업", tabs: ["settings"], paths: ["settings", "backup"] },
  auditlog: { label: "활동 로그", tabs: ["auditlog"], paths: ["audit-log"] },
  dashboard: { label: "대시보드·방문자·사용 통계", tabs: ["dashboard", "usagestats"], paths: ["dashboard", "analytics", "usage-log/stats"] },
};

/* 권한 검사 없이(PIN·로그인만) 모든 관리자가 쓰는 경로: 알림 개수, 사용 기록, 푸시 구독, 담당자 목록 조회. */
const OPEN_PATHS = ["notifications", "usage-log", "push", "admins"];
/* PIN 검사도 건너뛰는 경로: 내 상태 조회와 PIN 설정·인증 자체. */
const PIN_EXEMPT_PATHS = ["me", "pin"];

/* 신규 초대 직원의 기본 권한 — 마스터가 "직원·권한" 탭에서 바꾼다. */
const DEFAULT_STAFF_PERMISSIONS = { orders: "edit", returns: "edit", inventory: "edit", qna: "edit", collab: "edit" };

const LEVELS = ["none", "view", "edit"];
const LEVEL_RANK = { none: 0, view: 1, edit: 2 };

function firstSegments(sub) {
  return String(sub || "").replace(/^\/+/, "").split("/").filter(Boolean);
}

function matchesPrefix(sub, prefix) {
  const segs = firstSegments(sub);
  const pre = prefix.split("/");
  return pre.every((p, i) => segs[i] === p);
}

/* 경로 → 영역 key. 열린 경로면 "open", 표에 없으면 null(= 마스터 전용) */
function areaForPath(sub) {
  let best = null;
  let bestLen = -1;
  for (const [key, area] of Object.entries(AREAS)) {
    for (const p of area.paths) {
      const len = p.split("/").length;
      if (matchesPrefix(sub, p) && len > bestLen) { best = key; bestLen = len; }
    }
  }
  // 더 구체적인(긴) 경로가 이긴다 — "usage-log/stats"(대시보드 영역)가 "usage-log"(열림)보다 우선
  for (const p of OPEN_PATHS) {
    const len = p.split("/").length;
    if (matchesPrefix(sub, p) && len > bestLen) { best = "open"; bestLen = len; }
  }
  return best;
}

function requiredLevel(method) {
  return method === "GET" || method === "HEAD" ? "view" : "edit";
}

/* 저장된 permissions(없으면 null = 기존 관리자 전체 허용) → 영역별 최종 레벨 */
function resolvePermissions(stored, isMaster) {
  const out = {};
  for (const key of Object.keys(AREAS)) {
    if (isMaster || stored == null) out[key] = "edit";
    else out[key] = LEVELS.includes(stored[key]) ? stored[key] : "none";
  }
  return out;
}

function normalizePermissions(input) {
  const out = {};
  for (const key of Object.keys(AREAS)) {
    const v = input && input[key];
    out[key] = LEVELS.includes(v) ? v : "none";
  }
  return out;
}

/* ---------- PIN 인증 토큰 ----------
   PIN 확인이 끝나면 서버가 서명한 짧은 토큰(12시간)을 준다 — 브라우저는 세션 저장소에 두고 모든
   관리자 요청 헤더(X-Admin-Pin)에 실어 보낸다. PIN이 바뀌면(pin updated_at 포함) 예전 토큰은 즉시 무효. */
const PIN_TOKEN_TTL_MS = 12 * 3600 * 1000;

function signingKey() {
  return process.env.ADMIN_PIN_SECRET || crypto.createHash("sha256").update("reiten-admin-pin:" + (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "dev-only")).digest("hex");
}

function signPinToken(userId, pinVersion, now = Date.now()) {
  const exp = now + PIN_TOKEN_TTL_MS;
  const body = `${userId}.${exp}.${pinVersion}`;
  const sig = crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
  return { token: `${Buffer.from(body).toString("base64url")}.${sig}`, expiresAt: exp };
}

function verifyPinToken(token, userId, pinVersion, now = Date.now()) {
  if (!token || typeof token !== "string") return false;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return false;
  let body;
  try { body = Buffer.from(b64, "base64url").toString(); } catch (e) { return false; }
  const expected = crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const [uid, exp, ver] = body.split(".");
  return uid === userId && Number(exp) > now && ver === String(pinVersion);
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString("hex");
}

function isValidPin(pin) {
  return /^\d{6}$/.test(String(pin || ""));
}

/* ---------- 짧은 메모리 캐시 (요청마다 DB 2번 더 치지 않도록) ---------- */
const CACHE_TTL_MS = 10000;
const pinCache = new Map();
const permCache = new Map();

function invalidateAdminCache(userId) {
  if (userId) { pinCache.delete(userId); permCache.delete(userId); }
  else { pinCache.clear(); permCache.clear(); }
}

async function getPinRow(userId) {
  const hit = pinCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const { data, error } = await supabaseAdmin.from("admin_pins").select("*").eq("user_id", userId).maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) return { unavailable: true };
    throw error;
  }
  const value = data || null;
  pinCache.set(userId, { at: Date.now(), value });
  return value;
}

/* 저장된 권한. 행이 없으면 null(전체 허용), 테이블이 없어도 null. */
async function getStoredPermissions(userId) {
  const hit = permCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const { data, error } = await supabaseAdmin.from("admin_permissions").select("permissions").eq("user_id", userId).maybeSingle();
  if (error && !isMissingSchemaError(error)) throw error;
  const value = data ? data.permissions || {} : null;
  permCache.set(userId, { at: Date.now(), value });
  return value;
}

function pinVersionOf(row) {
  return row && row.updated_at ? new Date(row.updated_at).getTime() : 0;
}

async function adminGuard(req, res, next) {
  try {
    const sub = req.path;
    if (matchesPrefix(sub, "login-lock")) return next();

    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "로그인이 필요합니다." });
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData.user) return res.status(401).json({ error: "로그인이 만료되었습니다. 다시 로그인해 주세요." });
    req.user = authData.user;

    const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").select("role").eq("id", req.user.id).single();
    if (profileError || !profile || profile.role !== "admin") return res.status(403).json({ error: "관리자만 접근할 수 있습니다." });
    req.adminVerified = true;

    const isMaster = (req.user.email || "").toLowerCase() === MASTER_ADMIN_EMAIL;
    req.isMasterAdmin = isMaster;

    if (PIN_EXEMPT_PATHS.some((p) => matchesPrefix(sub, p))) return next();

    const pinRow = await getPinRow(req.user.id);
    if (!pinRow || !pinRow.unavailable) {
      if (!pinRow) return res.status(403).json({ error: "PIN을 먼저 설정해 주세요.", code: "PIN_SETUP_REQUIRED" });
      if (!verifyPinToken(req.headers["x-admin-pin"], req.user.id, pinVersionOf(pinRow))) {
        return res.status(403).json({ error: "PIN 인증이 필요합니다.", code: "PIN_REQUIRED" });
      }
    }

    if (isMaster) return next();

    const area = areaForPath(sub);
    if (area === "open") return next();
    if (area === null) return res.status(403).json({ error: "이 기능은 마스터 관리자만 사용할 수 있습니다.", code: "FORBIDDEN_AREA" });

    const perms = resolvePermissions(await getStoredPermissions(req.user.id), false);
    if (LEVEL_RANK[perms[area]] < LEVEL_RANK[requiredLevel(req.method)]) {
      const label = AREAS[area].label;
      const need = requiredLevel(req.method) === "view" ? "조회" : "수정";
      return res.status(403).json({ error: `'${label}' ${need} 권한이 없습니다. 마스터 관리자에게 문의하세요.`, code: "FORBIDDEN_AREA", area });
    }
    next();
  } catch (err) {
    console.error("[adminGuard]", err.message);
    res.status(500).json({ error: "권한 확인 중 오류가 발생했습니다." });
  }
}

module.exports = {
  AREAS, LEVELS, DEFAULT_STAFF_PERMISSIONS,
  areaForPath, requiredLevel, resolvePermissions, normalizePermissions,
  signPinToken, verifyPinToken, hashPin, isValidPin, pinVersionOf,
  getPinRow, getStoredPermissions, invalidateAdminCache, adminGuard,
};
