/* ---------- 내 상태 · PIN(2단계 인증) · 직원 권한 관리 ----------
   /api/admin 관문(lib/adminGuard.js)이 로그인·관리자 확인을 이미 끝낸 뒤 들어온다.
   me / pin 경로는 PIN 검사를 건너뛴다(PIN을 설정·입력하는 요청 자체이므로).
   staff 경로는 마스터 관리자 전용 — 직원 권한 편집, 직원 PIN 지정·초기화, 직원 비밀번호 변경. */
const express = require("express");
const crypto = require("crypto");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin, requireMasterAdmin, MASTER_ADMIN_EMAIL } = require("../lib/auth");
const { logAdminAction, logSystemError } = require("../lib/adminLog");
const {
  AREAS, resolvePermissions, normalizePermissions,
  signPinToken, verifyPinToken, hashPin, isValidPin, pinVersionOf,
  getPinRow, getStoredPermissions, invalidateAdminCache, isPinLocked, pinLockedResponse,
} = require("../lib/adminGuard");
const { isMissingSchemaError } = require("../lib/pgErrors");

const router = express.Router();

/* PIN 잠금 정책(2026-10-02 사용자 요청) — 6번째 오입력에서 잠근다.
   ① 직원: 마스터 관리자가 "직원·권한" 탭에서 PIN을 초기화(또는 새로 지정)할 때까지 계속 잠김
   ② 마스터: 풀어줄 상위 관리자가 없으므로 30분 시간 잠금
   PIN 확인(verify)과 PIN 변경(change)이 같은 실패 횟수를 공유한다 — 예전엔 변경 쪽에 횟수 제한이
   없어서, 비밀번호가 유출되면 "현재 PIN" 칸으로 무제한 대입해 2단계 인증을 뚫을 수 있었다.
   잠기면 시스템 오류(알림센터·텔레그램·폰 푸시)로 마스터에게 바로 알린다. */
const MAX_PIN_FAILS = 6;
const MASTER_PIN_LOCK_MS = 30 * 60 * 1000;
const STAFF_PIN_LOCK_UNTIL = "9999-12-31T00:00:00.000Z";
const PIN_TABLE_MISSING = "PIN 기능용 DB 마이그레이션(040)이 아직 실행되지 않았습니다.";

// adminGuard가 붙인 req.isMasterAdmin 대신 이메일로 직접 판단한다(라우터만 단독으로 붙인 테스트에서도 같은 결과).
function isMasterUser(req) {
  return (req.user && (req.user.email || "").toLowerCase()) === MASTER_ADMIN_EMAIL;
}

/* 틀린 PIN 한 번을 기록하고, 이번이 6번째면 잠근다. 응답으로 보낼 { status, body }를 돌려준다. */
async function recordPinFailure(req, row) {
  const isMaster = isMasterUser(req);
  const failCount = (row.fail_count || 0) + 1;
  const lock = failCount >= MAX_PIN_FAILS;
  const lockedUntil = lock ? (isMaster ? new Date(Date.now() + MASTER_PIN_LOCK_MS).toISOString() : STAFF_PIN_LOCK_UNTIL) : null;
  await supabaseAdmin.from("admin_pins").update({ fail_count: lock ? 0 : failCount, locked_until: lockedUntil }).eq("user_id", req.user.id);
  invalidateAdminCache(req.user.id);
  if (lock) {
    logAdminAction(req, "admin.pin_locked", "admin", req.user.id, { email: req.user.email });
    logSystemError("admin_pin_locked", { email: req.user.email, lockedUntil: isMaster ? lockedUntil : "마스터 초기화 전까지" });
    return pinLockedResponse({ locked_until: lockedUntil }, isMaster);
  }
  const remaining = MAX_PIN_FAILS - failCount;
  return {
    status: 401,
    body: {
      error: `PIN이 올바르지 않습니다. (${remaining}회 남음 — ${MAX_PIN_FAILS}회 틀리면 잠깁니다)`,
      i18n: { key: "PIN이 올바르지 않습니다. ({remaining}회 남음 — {max}회 틀리면 잠깁니다)", vars: { remaining, max: MAX_PIN_FAILS } },
    },
  };
}

async function clearPinFailures(req, row) {
  if (row.fail_count || row.locked_until) {
    await supabaseAdmin.from("admin_pins").update({ fail_count: 0, locked_until: null }).eq("user_id", req.user.id);
    invalidateAdminCache(req.user.id);
  }
}

async function savePin(userId, pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  const row = { user_id: userId, pin_hash: hashPin(pin, salt), salt, fail_count: 0, locked_until: null, updated_at: new Date().toISOString() };
  const { error } = await supabaseAdmin.from("admin_pins").upsert(row, { onConflict: "user_id" });
  invalidateAdminCache(userId);
  return { row, error };
}

router.get("/api/admin/me", requireAdmin, async (req, res) => {
  const isMaster = !!req.isMasterAdmin;
  const pinRow = await getPinRow(req.user.id).catch(() => ({ unavailable: true }));
  const pinAvailable = !(pinRow && pinRow.unavailable);
  const verified = pinAvailable && !!pinRow && verifyPinToken(req.headers["x-admin-pin"], req.user.id, pinVersionOf(pinRow));
  const stored = await getStoredPermissions(req.user.id).catch(() => null);
  const { data: profile } = await supabaseAdmin.from("profiles").select("name").eq("id", req.user.id).maybeSingle();
  res.json({
    id: req.user.id,
    email: req.user.email,
    name: (profile && profile.name) || "",
    isMaster,
    permissions: resolvePermissions(stored, isMaster),
    tabAreas: Object.fromEntries(Object.entries(AREAS).flatMap(([key, a]) => a.tabs.map((tab) => [tab, key]))),
    // 잠긴 계정은 PIN 토큰이 남아 있어도 "확인 안 됨"으로 보내 PIN 창(잠금 안내)이 다시 뜨게 한다.
    pin: { enabled: pinAvailable, set: pinAvailable && !!pinRow, verified: !pinAvailable || (verified && !isPinLocked(pinRow)), locked: pinAvailable && isPinLocked(pinRow) },
  });
});

/* 처음 PIN 설정 — 이미 PIN이 있으면 거부(바꾸려면 change, 잊었으면 마스터가 초기화). */
router.post("/api/admin/pin/setup", requireAdmin, async (req, res) => {
  const pin = (req.body || {}).pin;
  if (!isValidPin(pin)) return res.status(400).json({ error: "PIN은 숫자 6자리여야 합니다." });
  const existing = await getPinRow(req.user.id).catch(() => ({ unavailable: true }));
  if (existing && existing.unavailable) return res.status(503).json({ error: PIN_TABLE_MISSING });
  if (existing) return res.status(409).json({ error: "이미 PIN이 설정돼 있습니다." });
  const { row, error } = await savePin(req.user.id, pin);
  if (error) return res.status(500).json({ error: "PIN 저장에 실패했습니다." });
  logAdminAction(req, "admin.pin_setup", "admin", req.user.id);
  const signed = signPinToken(req.user.id, pinVersionOf(row));
  res.json({ ok: true, token: signed.token, expiresAt: signed.expiresAt });
});

router.post("/api/admin/pin/verify", requireAdmin, async (req, res) => {
  const pin = (req.body || {}).pin;
  const { data: row, error } = await supabaseAdmin.from("admin_pins").select("*").eq("user_id", req.user.id).maybeSingle();
  if (error) return res.status(isMissingSchemaError(error) ? 503 : 500).json({ error: isMissingSchemaError(error) ? PIN_TABLE_MISSING : "PIN 확인에 실패했습니다." });
  if (!row) return res.status(409).json({ error: "PIN이 아직 설정되지 않았습니다.", code: "PIN_SETUP_REQUIRED" });

  if (isPinLocked(row)) {
    const locked = pinLockedResponse(row, isMasterUser(req));
    return res.status(locked.status).json(locked.body);
  }

  const ok = isValidPin(pin) && crypto.timingSafeEqual(Buffer.from(hashPin(pin, row.salt)), Buffer.from(row.pin_hash));
  if (!ok) {
    const failed = await recordPinFailure(req, row);
    return res.status(failed.status).json(failed.body);
  }

  await clearPinFailures(req, row);
  const signed = signPinToken(req.user.id, pinVersionOf(row));
  res.json({ ok: true, token: signed.token, expiresAt: signed.expiresAt });
});

router.post("/api/admin/pin/change", requireAdmin, async (req, res) => {
  const { currentPin, newPin } = req.body || {};
  if (!isValidPin(newPin)) return res.status(400).json({ error: "새 PIN은 숫자 6자리여야 합니다." });
  const { data: row } = await supabaseAdmin.from("admin_pins").select("*").eq("user_id", req.user.id).maybeSingle();
  if (!row) return res.status(409).json({ error: "PIN이 아직 설정되지 않았습니다.", code: "PIN_SETUP_REQUIRED" });
  if (isPinLocked(row)) {
    const locked = pinLockedResponse(row, isMasterUser(req));
    return res.status(locked.status).json(locked.body);
  }
  const ok = isValidPin(currentPin) && crypto.timingSafeEqual(Buffer.from(hashPin(currentPin, row.salt)), Buffer.from(row.pin_hash));
  if (!ok) {
    const failed = await recordPinFailure(req, row);
    return res.status(failed.status).json(failed.body);
  }
  const { row: saved, error } = await savePin(req.user.id, newPin);
  if (error) return res.status(500).json({ error: "PIN 저장에 실패했습니다." });
  logAdminAction(req, "admin.pin_change", "admin", req.user.id);
  const signed = signPinToken(req.user.id, pinVersionOf(saved));
  res.json({ ok: true, token: signed.token, expiresAt: signed.expiresAt });
});

/* ---------- 마스터 전용: 직원 관리 ---------- */
async function loadStaffTarget(id) {
  const { data: profile } = await supabaseAdmin.from("profiles").select("id, role, name").eq("id", id).maybeSingle();
  if (!profile || profile.role !== "admin") return { error: "관리자 계정이 아닙니다." };
  const { data: user } = await supabaseAdmin.auth.admin.getUserById(id);
  if (!user || !user.user) return { error: "계정을 찾을 수 없습니다." };
  if ((user.user.email || "").toLowerCase() === MASTER_ADMIN_EMAIL) return { error: "마스터 관리자 계정은 여기서 바꿀 수 없습니다." };
  return { profile, email: user.user.email || "" };
}

router.get("/api/admin/staff", requireMasterAdmin, async (req, res) => {
  const { data: profiles, error } = await supabaseAdmin.from("profiles").select("id, name, created_at").eq("role", "admin").order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: "직원 목록을 불러오지 못했습니다." });
  const { data: userList } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map((userList?.users || []).map((u) => [u.id, u.email || ""]));

  const { data: permRows, error: permErr } = await supabaseAdmin.from("admin_permissions").select("user_id, permissions");
  const permById = new Map(permErr ? [] : (permRows || []).map((r) => [r.user_id, r.permissions || {}]));
  const { data: pinRows, error: pinErr } = await supabaseAdmin.from("admin_pins").select("user_id, locked_until, updated_at");
  const pinById = new Map(pinErr ? [] : (pinRows || []).map((r) => [r.user_id, r]));

  const items = profiles
    .filter((p) => (emailById.get(p.id) || "").toLowerCase() !== MASTER_ADMIN_EMAIL)
    .map((p) => ({
      id: p.id,
      name: p.name || "",
      email: emailById.get(p.id) || "",
      permissions: resolvePermissions(permById.has(p.id) ? permById.get(p.id) : null, false),
      customized: permById.has(p.id),
      pinSet: pinById.has(p.id),
      pinLocked: !!(pinById.get(p.id)?.locked_until && new Date(pinById.get(p.id).locked_until).getTime() > Date.now()),
    }));
  res.json({
    items,
    areas: Object.entries(AREAS).map(([key, a]) => ({ key, label: a.label })),
    migrationMissing: !!(permErr && isMissingSchemaError(permErr)) || !!(pinErr && isMissingSchemaError(pinErr)),
  });
});

router.put("/api/admin/staff/:id/permissions", requireMasterAdmin, async (req, res) => {
  const target = await loadStaffTarget(req.params.id);
  if (target.error) return res.status(400).json({ error: target.error });
  const permissions = normalizePermissions((req.body || {}).permissions);
  const { error } = await supabaseAdmin.from("admin_permissions").upsert({ user_id: req.params.id, permissions, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return res.status(isMissingSchemaError(error) ? 503 : 500).json({ error: isMissingSchemaError(error) ? PIN_TABLE_MISSING : "권한 저장에 실패했습니다." });
  invalidateAdminCache(req.params.id);
  logAdminAction(req, "staff.permissions", "admin", req.params.id, { email: target.email, permissions });
  res.json({ ok: true });
});

/* { pin } → 6자리로 지정, { reset: true } → 삭제(직원이 다음 접속 때 스스로 새로 설정) */
router.post("/api/admin/staff/:id/pin", requireMasterAdmin, async (req, res) => {
  const target = await loadStaffTarget(req.params.id);
  if (target.error) return res.status(400).json({ error: target.error });
  const { pin, reset } = req.body || {};
  if (reset) {
    const { error } = await supabaseAdmin.from("admin_pins").delete().eq("user_id", req.params.id);
    if (error && !isMissingSchemaError(error)) return res.status(500).json({ error: "PIN 초기화에 실패했습니다." });
    invalidateAdminCache(req.params.id);
    logAdminAction(req, "staff.pin_reset", "admin", req.params.id, { email: target.email });
    return res.json({ ok: true });
  }
  if (!isValidPin(pin)) return res.status(400).json({ error: "PIN은 숫자 6자리여야 합니다." });
  const { error } = await savePin(req.params.id, pin);
  if (error) return res.status(isMissingSchemaError(error) ? 503 : 500).json({ error: isMissingSchemaError(error) ? PIN_TABLE_MISSING : "PIN 저장에 실패했습니다." });
  logAdminAction(req, "staff.pin_set", "admin", req.params.id, { email: target.email });
  res.json({ ok: true });
});

router.post("/api/admin/staff/:id/password", requireMasterAdmin, async (req, res) => {
  const target = await loadStaffTarget(req.params.id);
  if (target.error) return res.status(400).json({ error: target.error });
  const password = String((req.body || {}).password || "");
  if (password.length < 8) return res.status(400).json({ error: "비밀번호는 8자 이상이어야 합니다." });
  const { error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, { password });
  if (error) return res.status(400).json({ error: error.message || "비밀번호 변경에 실패했습니다." });
  logAdminAction(req, "staff.password", "admin", req.params.id, { email: target.email });
  res.json({ ok: true });
});

module.exports = router;
