/* ---------- AI 승인함 (2026-11-11, 마이그레이션 054) ----------
   실시간 에이전트 AI → 작업 "제안" → 사람(권한 있는 관리자)이 Works "AI 승인함"에서 승인 → 서버가 승인자 신분으로 그 작업 하나만 실행.
   - 제안 때 서버가 미리 검사하고(안 되는 건 바로 반려) 바뀔 내용(전→후)을 만들어 둔다. 승인 때 한 번 더 검사한다.
   - 같은 대상에 대한 같은 작업이 대기 중이면 새로 만들지 않는다. 24시간 안에 결정 안 하면 만료.
   - 묶어서 승인·거절(ids 여러 개), 되돌리기(되돌릴 수 있는 작업만), 새 요청이 오면 Works 폰 푸시(5분에 한 번까지).
   - AI 권한 설정(메인 관리자만): 전체 켜기/끄기, 작업별 허용, 조건부 자동 승인(기본 꺼짐 — 하루 건수·금액 상한).
   모든 제안·승인·거절·실행·되돌리기는 활동 로그(admin_audit_log)에 남는다. 실행된 작업의 원래 로그에도 "AI 제안 #번호"가 붙는다. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { isMissingSchemaError } = require("../lib/pgErrors");
const { botLimiter, botWriteLimiter } = require("../lib/rateLimiters");
const { requireBotKey, BOT_ACTOR_ID } = require("../lib/botAuth");
const { hasAreaPermission, getStoredPermissions, resolvePermissions } = require("../lib/adminGuard");
const { MASTER_ADMIN_EMAIL } = require("../lib/auth");
const { ACTIONS, loadPolicy, normalizePolicy, catalog } = require("../lib/agentActions");
const { kstDateKey } = require("../lib/kst");

const router = express.Router();
const TABLE = "agent_actions";
const MIGRATION_MISSING = "AI 승인함 표가 아직 없습니다(마이그레이션 054 미실행)";
const ID_RE = /^[0-9a-f-]{1,40}$/i; // 실제 표는 숫자(bigserial), 테스트용 가짜 DB는 uuid — 문자열로 다룬다
const AUTO_ACTOR = { id: BOT_ACTOR_ID, email: "bot:pickle(자동 승인)", isMaster: false };

function botAudit(action, targetId, detail) {
  supabaseAdmin.from("admin_audit_log").insert({ admin_id: BOT_ACTOR_ID, admin_email: "bot:pickle", action, target_type: "agent_action", target_id: String(targetId), detail })
    .then(({ error }) => { if (error) console.error("[agent] 활동 로그 적재 실패:", error.message); });
}

function toApi(r) {
  const a = ACTIONS[r.action_type] || {};
  return {
    id: r.id, type: r.action_type, label: a.label || r.action_type, area: a.area || null, undoable: !!a.undoable,
    target: r.target, reason: r.reason || null, preview: r.preview || {}, status: r.status, autoApproved: !!r.auto_approved,
    createdAt: r.created_at, expiresAt: r.expires_at, decidedBy: r.decided_by || null, decidedAt: r.decided_at || null,
    decisionNote: r.decision_note || null, executedAt: r.executed_at || null, error: r.error || null, undoneAt: r.undone_at || null,
  };
}

/* 만료 정리 — 결정 없이 24시간 지난 제안 */
async function expireStale(db = supabaseAdmin) {
  await db.from(TABLE).update({ status: "EXPIRED" }).eq("status", "PENDING").lt("expires_at", new Date().toISOString());
}

/* 이 관리자가 승인할 수 있는 작업 종류(그 영역 "수정" 권한) — 승인 못 하는 종류는 목록·알림·푸시에서 아예 빼서
   "권한이 없습니다" 같은 표시 없이 안 보이게 한다(2026-11-11 사용자 요청). */
async function decidableTypes(req) {
  const out = [];
  for (const [k, a] of Object.entries(ACTIONS)) if (await hasAreaPermission(req, a.area, "edit")) out.push(k);
  return out;
}

/* 푸시 받을 관리자 — 대기 중인 종류 중 하나라도 승인할 수 있는 사람만 */
async function pushRecipients(pendingTypes) {
  const areas = [...new Set(pendingTypes.map((k) => ACTIONS[k] && ACTIONS[k].area).filter(Boolean))];
  const { data: subs } = await supabaseAdmin.from("push_subscriptions").select("admin_id");
  const ids = [...new Set((subs || []).map((x) => x.admin_id).filter(Boolean))];
  const allowed = [];
  for (const id of ids) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(id);
      if (((data && data.user && data.user.email) || "").toLowerCase() === MASTER_ADMIN_EMAIL) { allowed.push(id); continue; }
      const perms = resolvePermissions(await getStoredPermissions(id), false);
      if (areas.some((a) => perms[a] === "edit")) allowed.push(id);
    } catch (e) { /* 확인 못 하면 보내지 않음 */ }
  }
  return allowed;
}

/* 새 승인 요청 폰 푸시 — 5분에 한 번까지(여러 건이 몰려도 알림 폭탄이 되지 않게) */
let lastPushAt = 0;
async function notifyPending() {
  if (Date.now() - lastPushAt < 5 * 60 * 1000) return;
  lastPushAt = Date.now();
  try {
    const { data: pend } = await supabaseAdmin.from(TABLE).select("action_type").eq("status", "PENDING");
    const types = (pend || []).map((r) => r.action_type);
    const adminIds = await pushRecipients(types);
    if (!adminIds.length) return;
    const { sendPushToAdmins } = require("../lib/push");
    await sendPushToAdmins({ title: "AI 승인 요청", body: `실시간 에이전트 AI가 승인을 기다리는 작업 ${types.length || 1}건`, tab: "agent" }, { adminIds });
  } catch (e) { /* 푸시 실패는 무시 */ }
}

/* 실행 — 승인자(또는 자동 승인) 신분으로 기존 관리자 API 호출 */
async function executeRecord(rec, actor, { auto = false, note } = {}) {
  const def = ACTIONS[rec.action_type];
  const nowIso = new Date().toISOString();
  // 승인 시점에 다시 검사(그 사이 주문이 처리됐거나 재고가 바뀌었을 수 있음)
  const prep = await def.prepare(rec.params || {});
  if (prep.error) {
    const { data } = await supabaseAdmin.from(TABLE).update({ status: "FAILED", error: `승인 시점 검사 실패: ${prep.error}`, decided_by: actor.email, decided_at: nowIso, decision_note: note || null, auto_approved: auto })
      .eq("id", rec.id).eq("status", "PENDING").select().maybeSingle();
    return data || rec;
  }
  // 먼저 PENDING → 처리 중 선점(두 번 눌러도 한 번만)
  const { data: claimed } = await supabaseAdmin.from(TABLE).update({ status: "EXECUTED", decided_by: actor.email, decided_at: nowIso, decision_note: note || null, auto_approved: auto, params: prep.params })
    .eq("id", rec.id).eq("status", "PENDING").select().maybeSingle();
  if (!claimed) return null;
  const r = await def.execute(prep.params, { actor, actionId: String(rec.id) }).catch((e) => ({ error: e.message }));
  const { data } = await supabaseAdmin.from(TABLE).update(r.error ? { status: "FAILED", error: String(r.error).slice(0, 500) } : { executed_at: new Date().toISOString(), result: r })
    .eq("id", rec.id).select().maybeSingle();
  return data;
}

/* ---------- AI(봇) ---------- */
router.get("/api/bot/actions/policy", botLimiter, requireBotKey, async (req, res) => {
  const p = await loadPolicy();
  if (p.error) return res.status(503).json({ ok: false, error: MIGRATION_MISSING });
  res.json({ ok: true, enabled: p.policy.enabled, actions: Object.fromEntries(Object.entries(p.policy.actions).map(([k, v]) => [k, { label: ACTIONS[k].label, enabled: p.policy.enabled && v.enabled, autoApprove: v.autoApprove }])) });
});

router.post("/api/bot/actions", botWriteLimiter, requireBotKey, async (req, res) => {
  const { type, params, reason } = req.body || {};
  const def = ACTIONS[type];
  if (!def) return res.status(400).json({ ok: false, error: `type은 ${Object.keys(ACTIONS).join(", ")} 중 하나입니다` });
  const p = await loadPolicy();
  if (p.error) return res.status(503).json({ ok: false, error: MIGRATION_MISSING });
  if (!p.policy.enabled) return res.status(403).json({ ok: false, error: "AI 작업 제안이 지금 꺼져 있습니다(AI 권한 설정)", code: "AGENT_DISABLED" });
  const cfg = p.policy.actions[type];
  if (!cfg.enabled) return res.status(403).json({ ok: false, error: `${def.label}은(는) 지금 허용되지 않은 작업입니다(AI 권한 설정)`, code: "ACTION_DISABLED" });

  const prep = await def.prepare(params && typeof params === "object" ? params : {}).catch((e) => ({ error: e.message }));
  if (prep.error) {
    botAudit("agent.propose_rejected", type, { type, error: prep.error });
    return res.status(422).json({ ok: false, error: prep.error, code: "PRECHECK_FAILED" }); // 사람에게 가기 전에 반려(C)
  }
  await expireStale();
  const { data: dup } = await supabaseAdmin.from(TABLE).select("*").eq("dedupe_key", prep.dedupeKey).eq("status", "PENDING").maybeSingle();
  if (dup) return res.json({ ok: true, duplicate: true, action: toApi(dup) });

  const { data: rec, error } = await supabaseAdmin.from(TABLE).insert({
    action_type: type, params: prep.params, target: prep.target, reason: String(reason || "").replace(/[\u0000-\u001F]/g, " ").slice(0, 500) || null,
    preview: prep.preview, status: "PENDING", dedupe_key: prep.dedupeKey, source: "pickle",
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  }).select().single();
  if (error) {
    if (error.code === "23505") return res.json({ ok: true, duplicate: true });
    if (isMissingSchemaError(error)) return res.status(503).json({ ok: false, error: MIGRATION_MISSING });
    return res.status(500).json({ ok: false, error: "제안 저장 실패" });
  }
  botAudit("agent.propose", rec.id, { type, target: prep.target });

  // 조건부 자동 승인(D) — 메인 관리자가 켠 작업만, 하루 건수·금액 상한 안에서
  if (def.autoAllowed && cfg.autoApprove) {
    const today = kstDateKey(new Date());
    const { data: todays } = await supabaseAdmin.from(TABLE).select("id, created_at").eq("action_type", type).eq("auto_approved", true).gte("created_at", new Date(Date.now() - 36 * 3600e3).toISOString());
    const usedToday = (todays || []).filter((r) => kstDateKey(new Date(r.created_at)) === today).length;
    const amount = prep.preview && prep.preview.amount;
    const underAmount = !def.amountBased || (cfg.autoMaxAmount != null && amount != null && amount <= cfg.autoMaxAmount);
    if (usedToday < cfg.autoDailyLimit && underAmount) {
      const done = await executeRecord(rec, AUTO_ACTOR, { auto: true, note: "조건부 자동 승인" });
      botAudit("agent.auto_execute", rec.id, { type, target: prep.target, status: done && done.status });
      return res.json({ ok: true, autoApproved: true, action: toApi(done || rec) });
    }
  }
  notifyPending().catch(() => {});
  res.json({ ok: true, action: toApi(rec) });
});

/* AI가 자기 제안의 결과를 확인 — ids=1,2,3 또는 since=ISO */
router.get("/api/bot/actions", botLimiter, requireBotKey, async (req, res) => {
  await expireStale().catch(() => {});
  let q = supabaseAdmin.from(TABLE).select("*").order("created_at", { ascending: false }).limit(100);
  const ids = String(req.query.ids || "").split(",").map((x) => x.trim()).filter((x) => ID_RE.test(x));
  if (ids.length) q = q.in("id", ids.slice(0, 100));
  else if (req.query.since) q = q.gte("created_at", String(req.query.since));
  const { data, error } = await q;
  if (error) return res.status(isMissingSchemaError(error) ? 503 : 500).json({ ok: false, error: isMissingSchemaError(error) ? MIGRATION_MISSING : "조회 실패" });
  res.json({ ok: true, items: (data || []).map((r) => ({ id: r.id, type: r.action_type, target: r.target, status: r.status, error: r.error || null, decidedAt: r.decided_at, executedAt: r.executed_at, autoApproved: !!r.auto_approved })) });
});

/* ---------- 관리자 ---------- */
router.get("/api/admin/agent-actions", requireAdmin, async (req, res) => {
  await expireStale().catch(() => {});
  const view = req.query.view === "history" ? "history" : "pending";
  let q = supabaseAdmin.from(TABLE).select("*").order("created_at", { ascending: view === "pending" }).limit(view === "pending" ? 300 : 100);
  q = view === "pending" ? q.eq("status", "PENDING") : q.neq("status", "PENDING");
  const { data, error } = await q;
  if (error) {
    if (isMissingSchemaError(error)) return res.json({ items: [], migrationMissing: true, catalog: catalog() });
    return res.status(500).json({ error: "AI 승인함을 불러오지 못했습니다." });
  }
  const p = await loadPolicy();
  // 승인할 수 없는 종류는 목록에서 아예 뺀다(서버가 결정 때도 다시 확인)
  const types = await decidableTypes(req);
  const canDecide = Object.fromEntries(Object.keys(ACTIONS).map((k) => [k, types.includes(k)]));
  const items = (data || []).filter((r) => types.includes(r.action_type)).map(toApi);
  res.json({ items, catalog: catalog(), policy: req.isMasterAdmin ? p.policy || null : null, canDecide, isMaster: !!req.isMasterAdmin });
});

/* 승인·거절(여러 건 한 번에) — { ids:[…], decision:"approve"|"reject", note? } */
router.post("/api/admin/agent-actions/decide", requireAdmin, async (req, res) => {
  const { ids, decision, note } = req.body || {};
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x)).filter((x) => ID_RE.test(x)))].slice(0, 100);
  if (!list.length || !["approve", "reject"].includes(decision)) return res.status(400).json({ error: "ids와 decision(approve/reject)이 필요합니다." });
  await expireStale().catch(() => {});
  const { data: recs, error } = await supabaseAdmin.from(TABLE).select("*").in("id", list);
  if (error) return res.status(isMissingSchemaError(error) ? 503 : 500).json({ error: isMissingSchemaError(error) ? MIGRATION_MISSING : "불러오지 못했습니다." });
  const actor = { id: req.user.id, email: req.user.email, isMaster: !!req.isMasterAdmin };
  const noteStr = String(note || "").slice(0, 300) || null;
  const results = [];
  for (const id of list) {
    const rec = (recs || []).find((r) => String(r.id) === id);
    if (!rec) { results.push({ id, ok: false, error: "없는 요청" }); continue; }
    if (rec.status !== "PENDING") { results.push({ id, ok: false, error: `이미 처리됨(${rec.status})` }); continue; }
    const def = ACTIONS[rec.action_type];
    if (!def || !(await hasAreaPermission(req, def.area, "edit"))) { results.push({ id, ok: false, error: "이 작업을 승인할 권한이 없습니다" }); continue; }
    if (decision === "reject") {
      const { data } = await supabaseAdmin.from(TABLE).update({ status: "REJECTED", decided_by: actor.email, decided_at: new Date().toISOString(), decision_note: noteStr }).eq("id", id).eq("status", "PENDING").select().maybeSingle();
      results.push({ id, ok: !!data, status: data ? "REJECTED" : rec.status });
      continue;
    }
    const done = await executeRecord(rec, actor, { note: noteStr });
    results.push({ id, ok: !!done && done.status === "EXECUTED", status: done ? done.status : "SKIPPED", error: done && done.error });
  }
  logAdminAction(req, decision === "approve" ? "agent.approve" : "agent.reject", "agent_action", list.join(","), { results: results.map((r) => ({ id: r.id, status: r.status, error: r.error })), note: noteStr });
  res.json({ ok: true, results });
});

/* 되돌리기 — 실행된 작업 중 되돌릴 수 있는 것만 */
router.post("/api/admin/agent-actions/:id/undo", requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  if (!ID_RE.test(id)) return res.status(404).json({ error: "요청을 찾을 수 없습니다." });
  const { data: rec } = await supabaseAdmin.from(TABLE).select("*").eq("id", id).maybeSingle();
  if (!rec) return res.status(404).json({ error: "요청을 찾을 수 없습니다." });
  const def = ACTIONS[rec.action_type];
  if (!def || !def.undo) return res.status(400).json({ error: "되돌릴 수 없는 작업입니다(해당 화면에서 직접 고쳐 주세요)." });
  if (rec.status !== "EXECUTED") return res.status(409).json({ error: "실행된 작업만 되돌릴 수 있습니다." });
  if (!(await hasAreaPermission(req, def.area, "edit"))) return res.status(403).json({ error: "이 작업을 되돌릴 권한이 없습니다." });
  const r = await def.undo(rec, { actor: { id: req.user.id, email: req.user.email, isMaster: !!req.isMasterAdmin }, actionId: `${id}-undo` }).catch((e) => ({ error: e.message }));
  if (r.error) return res.status(409).json({ error: `되돌리지 못했습니다: ${r.error}` });
  const { data } = await supabaseAdmin.from(TABLE).update({ status: "UNDONE", undone_at: new Date().toISOString(), undone_by: req.user.email }).eq("id", id).select().maybeSingle();
  logAdminAction(req, "agent.undo", "agent_action", id, { type: rec.action_type, target: rec.target });
  res.json({ ok: true, action: toApi(data || rec) });
});

/* AI 권한 설정 — 경로가 adminGuard 영역표에 없으므로 메인 관리자만 들어온다 */
router.get("/api/admin/agent-policy", requireAdmin, async (req, res) => {
  const p = await loadPolicy();
  if (p.error) return res.json({ migrationMissing: true, catalog: catalog() });
  res.json({ ...p, catalog: catalog() });
});

router.put("/api/admin/agent-policy", requireAdmin, async (req, res) => {
  const next = normalizePolicy((req.body || {}).policy);
  const before = await loadPolicy();
  if (before.error) return res.status(503).json({ error: MIGRATION_MISSING });
  const { error } = await supabaseAdmin.from("agent_policy").upsert({ id: 1, policy: next, updated_by: req.user.email, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) return res.status(500).json({ error: "저장에 실패했습니다." });
  logAdminAction(req, "agent.policy", "agent_policy", "1", { before: before.policy, after: next });
  res.json({ ok: true, policy: next });
});

module.exports = router;
module.exports.expireStale = expireStale;
module.exports.executeRecord = executeRecord;
