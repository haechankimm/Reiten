/* 관리자 로그인 실패 잠금 — server.js에서 분리(2026-11-09, 동작 변경 없음). */
const express = require("express");
const crypto = require("crypto");
const { supabaseAdmin } = require("../lib/supabase");
const { MASTER_ADMIN_EMAIL } = require("../lib/auth");
const { sendAdminLoginLocked } = require("../lib/mailer");
const { authLimiter } = require("../lib/rateLimiters");

const router = express.Router();

/* ---------- 관리자 로그인 실패 잠금 ----------
   로그인 자체는 브라우저가 Supabase Auth를 직접 호출해서 이뤄진다(server/를 거치지 않음) —
   그래서 이 서버가 로그인 성공·실패를 직접 볼 방법이 없다. works/index.html이 로그인 시도
   전후로 이 두 엔드포인트에 결과를 "보고"하게 해서, 같은 이메일로 7번 연속 실패하면 일정 시간
   로그인 버튼 자체를 막는다.
   ⚠️ 이건 실제 로그인 화면을 통한 시도에 대한 보완장치일 뿐이다. Supabase Auth REST API는
   공개 anon key로 누구나 직접 호출할 수 있어서(우리 서버를 거칠 필요가 없음), 이 엔드포인트를
   아예 건드리지 않고 Supabase에 바로 비밀번호를 대입하는 공격은 막지 못한다 — 그건 Supabase
   대시보드의 Authentication > Rate Limits(또는 Attack Protection)에서 별도로 설정해야
   하는, 코드로는 우회할 수 없는 영역이다. */
const LOGIN_FAIL_THRESHOLD = 7;
const LOGIN_LOCK_MINUTES = 15;

/* 잠금 기록은 "이메일 + 접속 IP" 단위로 센다(2026-10-02 노출 감사). 예전엔 이메일 하나에 묶여 있어서,
   로그인 화면을 쓰지도 않은 제3자가 대표 이메일로 success:false 보고만 7번 보내면 대표의 Works
   로그인 버튼이 15분씩 계속 잠기는(그리고 잠금 알림 메일이 계속 오는) 방해가 가능했다. IP를 함께
   키로 쓰면 공격자는 자기 IP에서만 잠기고, 다른 곳에서 접속하는 진짜 관리자는 영향을 받지 않는다.
   IP 원문은 저장하지 않고 해시 앞 16자리만 붙인다(login_attempts.email 컬럼을 그대로 재사용 —
   마이그레이션 불필요). */
function loginLockKey(email, req) {
  const ipHash = crypto.createHash("sha256").update(String(req.ip || "")).digest("hex").slice(0, 16);
  return `${email}#${ipHash}`;
}

router.get("/api/admin/login-lock", authLimiter, async (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase().slice(0, 200);
  if (!email) return res.json({ locked: false });

  const { data, error } = await supabaseAdmin.from("login_attempts").select("locked_until").eq("email", loginLockKey(email, req)).maybeSingle();
  if (error) console.error("[login-lock] 조회 실패(017_login_lockout.sql 미실행일 수 있음):", error.message);
  const lockedUntil = data?.locked_until ? new Date(data.locked_until) : null;
  if (lockedUntil && lockedUntil > new Date()) {
    return res.json({ locked: true, retryAfterSeconds: Math.ceil((lockedUntil - new Date()) / 1000) });
  }
  res.json({ locked: false });
});

/* 관리자 이메일 목록(5분 캐시) — 로그인 실패 보고는 인증 없이 들어오므로, 관리자가 아닌 아무 이메일로 계속 보내
   "로그인 잠금" 알림 메일을 도배하거나 login_attempts를 끝없이 늘릴 수 있었다(2026-10-28 정기 감사). Works 로그인
   전용 기능이라 관리자 이메일일 때만 세고 알린다(응답은 똑같이 ok라 관리자 여부는 드러나지 않는다). */
let adminEmailCache = { at: 0, emails: null };
async function isAdminEmail(email) {
  if (!adminEmailCache.emails || Date.now() - adminEmailCache.at > 5 * 60 * 1000) {
    const { data: rows, error } = await supabaseAdmin.from("profiles").select("id").eq("role", "admin");
    if (error) return true; // 확인을 못 하면 예전처럼 센다(관리자 잠금 보호가 우선)
    const emails = new Set();
    for (const r of rows || []) {
      const { data } = await supabaseAdmin.auth.admin.getUserById(r.id);
      const e = data && data.user && data.user.email;
      if (e) emails.add(e.toLowerCase());
    }
    if (MASTER_ADMIN_EMAIL) emails.add(MASTER_ADMIN_EMAIL);
    adminEmailCache = { at: Date.now(), emails };
  }
  return adminEmailCache.emails.has(email);
}

router.post("/api/admin/login-lock", authLimiter, async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase().slice(0, 200);
  const success = !!(req.body || {}).success;
  if (!email) return res.status(400).json({ error: "email이 필요합니다." });

  if (success) {
    /* success:true(실패 카운트 초기화)는 로그인이 방금 실제로 성공했을 때만 브라우저가 이미
       손에 쥐고 있는 Supabase 세션 토큰이 있다 — 그 토큰을 요구해서 본인 것이 맞는지 검증한다.
       검증 없이 email+success만 믿으면, 로그인을 한 번도 시도하지 않은 공격자가 남의 이메일로
       success:true를 계속 보내 실패 카운트를 미리 지워서 잠금 자체를 무력화할 수 있었다.
       (success:false는 로그인이 실패했을 때 보고하는 것이라 애초에 토큰이 존재하지 않으므로
       이 검증을 적용할 수 없다 — 그 경로의 잔여 위험은 알려진 제약으로 남겨둠.) */
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "인증 토큰이 필요합니다." });
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user || String(data.user.email || "").trim().toLowerCase() !== email) {
      return res.status(403).json({ error: "본인 계정에 대해서만 초기화할 수 있습니다." });
    }
    await supabaseAdmin.from("login_attempts").delete().eq("email", loginLockKey(email, req));
    return res.json({ ok: true });
  }

  if (!(await isAdminEmail(email))) return res.json({ ok: true });

  const lockKey = loginLockKey(email, req);
  const { data: prev, error: selectError } = await supabaseAdmin.from("login_attempts").select("fail_count").eq("email", lockKey).maybeSingle();
  if (selectError) console.error("[login-lock] 조회 실패(017_login_lockout.sql 미실행일 수 있음):", selectError.message);
  const failCount = (prev?.fail_count || 0) + 1;
  const patch = { email: lockKey, fail_count: failCount, updated_at: new Date().toISOString() };

  if (failCount >= LOGIN_FAIL_THRESHOLD) {
    patch.locked_until = new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000).toISOString();
    patch.fail_count = 0; // 잠금이 풀리면 다시 처음부터 셀 수 있게 초기화
    sendAdminLoginLocked({ email, failCount }).catch((err) => console.error("[mailer] 로그인 잠금 알림 메일 발송 실패:", err.message));
  }

  const { error: upsertError } = await supabaseAdmin.from("login_attempts").upsert(patch, { onConflict: "email" });
  if (upsertError) console.error("[login-lock] 저장 실패:", upsertError.message);
  res.json({ ok: true });
});

module.exports = router;
