/* ---------- 지출 장부·동업자 정산 (2026-11-11, 마이그레이션 052) ----------
   지출 기록 자체(등록·수정·확인)는 routes/supplierInvoices.js(매입 장부를 넓힌 것)가 맡고, 이 파일은 그 위의 기능을 맡는다:
   ① 목록·통계(분류·결제수단·낸 사람·거래처, 지난달 대비, 6개월 추이, 예산, 부가세 공제 후보)
   ② 동업자 정산(50:50 등 비율, 즉시 나눠 기록 → 나중에 한 번에 정산, 정산 취소 가능)
   ③ 동업자·정기 지출·예산·상품 원가 설정
   ④ 카드사·은행 CSV 가져오기(중복 방지), 세무 신고용 장부 내보내기(CSV·엑셀), AI 피드백용 요약
   권한 영역 "expenses"(lib/adminGuard.js) — 마스터가 "직원·권한"에서 동업자에게 켠다. 모든 변경은 활동 로그에 남는다. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { isMissingSchemaError, isMissingColumnError } = require("../lib/pgErrors");
const { botLimiter } = require("../lib/rateLimiters");
const { requireBotKey, BOT_ACTOR_ID } = require("../lib/botAuth");
const { kstMonthKey } = require("../lib/kst");
const { toCsvGeneric, toXlsxBufferGeneric } = require("../lib/orderExport");
const ex = require("../lib/expenses");
const { toApi, writeWithExpenseColumns } = require("./supplierInvoices");

const router = express.Router();
const TABLE = "supplier_invoices";
const MIGRATION_MISSING = "지출 장부 칸이 아직 없습니다(마이그레이션 052 미실행)";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = (e) => isMissingSchemaError(e) || isMissingColumnError(e);

function monthParam(v) {
  return /^\d{4}-\d{2}$/.test(String(v || "")) ? String(v) : kstMonthKey(new Date());
}

async function loadPartners() {
  const { data, error } = await supabaseAdmin.from("expense_partners").select("*").order("created_at", { ascending: true });
  if (error) return { error };
  return { partners: (data || []).map((p) => ({ ...p, share_percent: Number(p.share_percent) })) };
}

async function loadBudgets() {
  const { data } = await supabaseAdmin.from("expense_budgets").select("*");
  return data || [];
}

async function rowsBetween(first, next) {
  return supabaseAdmin.from(TABLE).select("*").gte("issued_on", first).lt("issued_on", next).order("issued_on", { ascending: false }).limit(5000);
}

/* ---------- ① 기본 정보 + 목록 ---------- */
router.get("/api/admin/expenses/meta", requireAdmin, async (req, res) => {
  const p = await loadPartners();
  if (p.error) return res.json({ migrationMissing: true, categories: ex.CATEGORIES, paymentMethods: ex.PAYMENT_METHODS, evidenceTypes: ex.EVIDENCE_TYPES, partners: [], budgets: [] });
  const me = p.partners.find((x) => x.email && x.email.toLowerCase() === String(req.user.email || "").toLowerCase());
  res.json({ categories: ex.CATEGORIES, paymentMethods: ex.PAYMENT_METHODS, evidenceTypes: ex.EVIDENCE_TYPES, partners: p.partners, budgets: await loadBudgets(), myPartnerId: me ? me.id : null });
});

/* 목록 — 달·분류·낸 사람·상태·정산 여부로 거른다 */
router.get("/api/admin/expenses", requireAdmin, async (req, res) => {
  const monthKey = monthParam(req.query.month);
  const b = ex.monthBounds(monthKey);
  let q = supabaseAdmin.from(TABLE).select("*").gte("issued_on", b.first).lt("issued_on", b.next);
  if (req.query.category) q = q.eq("category", String(req.query.category));
  if (req.query.fundedBy) q = q.eq("funded_by", String(req.query.fundedBy));
  if (req.query.status && ["RECORDED", "CONFIRMED", "REJECTED"].includes(String(req.query.status))) q = q.eq("status", String(req.query.status));
  if (req.query.unsettled === "1") q = q.is("settlement_id", null).neq("funded_by", "business");
  const { data, error } = await q.order("issued_on", { ascending: false }).limit(2000);
  if (error) {
    if (missing(error)) return res.json({ month: monthKey, items: [], migrationMissing: true });
    console.error("[expenses] 목록 실패:", error.message);
    return res.status(500).json({ error: "지출 목록을 불러오지 못했습니다." });
  }
  res.json({ month: monthKey, items: (data || []).map(toApi) });
});

/* 통계 — 이번 달 요약 + 지난달 대비 + 6개월 추이 + 예산 */
router.get("/api/admin/expenses/stats", requireAdmin, async (req, res) => {
  const monthKey = monthParam(req.query.month);
  const from = ex.monthBounds(ex.shiftMonth(monthKey, -5)).first;
  const to = ex.monthBounds(monthKey).next;
  const { data, error } = await rowsBetween(from, to);
  if (error) {
    if (missing(error)) return res.json({ month: monthKey, migrationMissing: true });
    return res.status(500).json({ error: "통계를 불러오지 못했습니다." });
  }
  const rows = data || [];
  const inMonth = (mk) => rows.filter((r) => String(r.issued_on).slice(0, 7) === mk);
  const budgets = await loadBudgets();
  const current = ex.summarize(inMonth(monthKey), { budgets });
  const prev = ex.summarize(inMonth(ex.shiftMonth(monthKey, -1)));
  const trend = [-5, -4, -3, -2, -1, 0].map((d) => {
    const mk = ex.shiftMonth(monthKey, d);
    return { month: mk, total: ex.summarize(inMonth(mk)).confirmedTotal };
  });
  // 같은 달 매출(취소 제외) — "순매출 - 지출"
  const mb = ex.monthBounds(monthKey);
  const { data: orders } = await supabaseAdmin.from("orders").select("total, status, created_at, refunded_amount")
    .gte("created_at", `${mb.first}T00:00:00+09:00`).lt("created_at", `${mb.next}T00:00:00+09:00`);
  const revenue = (orders || []).filter((o) => o.status !== "취소").reduce((n, o) => n + (o.total || 0) - (o.refunded_amount || 0), 0);
  const p = await loadPartners();
  res.json({
    month: monthKey, ...current, previousTotal: prev.confirmedTotal, trend, revenue, profit: revenue - current.confirmedTotal,
    partners: p.partners || [], settlementPreview: p.partners ? ex.computeSettlement(rows.concat(await unsettledOutside(rows)), p.partners) : null,
  });
});

/* 정산 미리보기는 기간과 상관없이 "아직 정산 안 된 것 전부" — 통계 조회 범위 밖 것까지 더한다 */
async function unsettledOutside(rows) {
  const ids = new Set(rows.map((r) => r.id));
  const { data } = await supabaseAdmin.from(TABLE).select("*").is("settlement_id", null).eq("status", "CONFIRMED").neq("funded_by", "business").limit(5000);
  return (data || []).filter((r) => !ids.has(r.id));
}

/* ---------- ② 동업자 정산 ---------- */
router.get("/api/admin/expenses/settlement/preview", requireAdmin, async (req, res) => {
  const p = await loadPartners();
  if (p.error) return res.json({ migrationMissing: true });
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").is("settlement_id", null).eq("status", "CONFIRMED").neq("funded_by", "business").limit(5000);
  if (error) return res.status(missing(error) ? 200 : 500).json(missing(error) ? { migrationMissing: true } : { error: "정산 대상을 불러오지 못했습니다." });
  const result = ex.computeSettlement(data || [], p.partners);
  res.json({ ...result, items: (data || []).filter((r) => result.expenseIds.includes(r.id)).map(toApi), partners: p.partners });
});

router.post("/api/admin/expenses/settlements", requireAdmin, async (req, res) => {
  const p = await loadPartners();
  if (p.error) return res.status(503).json({ error: MIGRATION_MISSING });
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").is("settlement_id", null).eq("status", "CONFIRMED").neq("funded_by", "business").limit(5000);
  if (error) return res.status(500).json({ error: "정산 대상을 불러오지 못했습니다." });
  const result = ex.computeSettlement(data || [], p.partners);
  if (!result.count) return res.status(400).json({ error: "정산할 지출이 없습니다." });
  // 화면에서 본 합계와 지금 합계가 다르면(그 사이 다른 사람이 지출을 바꿈) 다시 확인하게 한다
  const expected = (req.body || {}).expectedTotal;
  if (expected !== undefined && Number(expected) !== result.total) return res.status(409).json({ error: "그 사이 정산 대상이 바뀌었습니다. 새로 고친 뒤 다시 확인해 주세요.", code: "STALE" });
  const dates = data.filter((r) => result.expenseIds.includes(r.id)).map((r) => r.issued_on).sort();
  const { data: st, error: stErr } = await supabaseAdmin
    .from("expense_settlements")
    .insert({ period_from: dates[0], period_to: dates[dates.length - 1], total_amount: result.total, balances: result.balances, transfers: result.transfers, memo: String((req.body || {}).memo || "").slice(0, 500) || null, created_by: req.user.email })
    .select()
    .single();
  if (stErr) return res.status(500).json({ error: "정산 기록에 실패했습니다." });
  // 아직 정산 안 된 것만 표시(동시에 두 번 눌러도 한 지출이 두 정산에 들어가지 않게)
  const { error: markErr } = await supabaseAdmin.from(TABLE).update({ settlement_id: st.id }).in("id", result.expenseIds).is("settlement_id", null);
  if (markErr) {
    await supabaseAdmin.from("expense_settlements").delete().eq("id", st.id);
    return res.status(500).json({ error: "정산 표시에 실패해 취소했습니다. 다시 시도해 주세요." });
  }
  logAdminAction(req, "expense.settle", "expense_settlement", st.id, { total: result.total, count: result.count, transfers: result.transfers });
  res.json({ ok: true, settlement: st, ...result });
});

router.get("/api/admin/expenses/settlements", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("expense_settlements").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) return res.json({ items: [], migrationMissing: missing(error) });
  res.json({ items: data || [] });
});

/* 정산 취소 — 그 정산에 묶인 지출의 표시를 지우고 정산 기록에 취소 시각을 남긴다(기록 자체는 지우지 않음) */
router.post("/api/admin/expenses/settlements/:id/cancel", requireAdmin, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: "정산 기록을 찾을 수 없습니다." });
  const { data: st } = await supabaseAdmin.from("expense_settlements").select("*").eq("id", req.params.id).maybeSingle();
  if (!st) return res.status(404).json({ error: "정산 기록을 찾을 수 없습니다." });
  if (st.canceled_at) return res.status(409).json({ error: "이미 취소된 정산입니다." });
  await supabaseAdmin.from(TABLE).update({ settlement_id: null }).eq("settlement_id", st.id);
  const { data } = await supabaseAdmin.from("expense_settlements").update({ canceled_at: new Date().toISOString(), canceled_by: req.user.email }).eq("id", st.id).select().maybeSingle();
  logAdminAction(req, "expense.settle_cancel", "expense_settlement", st.id, { total: st.total_amount });
  res.json({ ok: true, settlement: data });
});

/* ---------- ③ 설정: 동업자·예산·정기 지출·상품 원가 ---------- */
router.put("/api/admin/expenses/partners", requireAdmin, async (req, res) => {
  const list = Array.isArray((req.body || {}).partners) ? req.body.partners : null;
  if (!list || !list.length || list.length > 10) return res.status(400).json({ error: "동업자를 1~10명 입력해 주세요." });
  const rows = [];
  for (const p of list) {
    const id = String(p.id || "").trim();
    const name = String(p.name || "").trim().slice(0, 50);
    const share = Number(p.sharePercent);
    if (!/^[a-z0-9_-]{1,40}$/i.test(id) || id === "business" || !name || !Number.isFinite(share) || share < 0 || share > 100) {
      return res.status(400).json({ error: "동업자 id(영문)·이름·부담 비율(0~100)을 확인해 주세요." });
    }
    rows.push({ id, name, email: String(p.email || "").trim().toLowerCase().slice(0, 120) || null, share_percent: share, active: p.active !== false });
  }
  const sum = rows.filter((r) => r.active).reduce((n, r) => n + r.share_percent, 0);
  if (Math.abs(sum - 100) > 0.01) return res.status(400).json({ error: `부담 비율 합이 100%여야 합니다(지금 ${sum}%).` });
  const before = (await loadPartners()).partners || [];
  const { error } = await supabaseAdmin.from("expense_partners").upsert(rows, { onConflict: "id" });
  if (error) return res.status(missing(error) ? 503 : 500).json({ error: missing(error) ? MIGRATION_MISSING : "저장에 실패했습니다." });
  logAdminAction(req, "expense.partners", "expense_partners", "all", { before, after: rows });
  res.json({ ok: true, partners: (await loadPartners()).partners });
});

router.put("/api/admin/expenses/budgets", requireAdmin, async (req, res) => {
  const body = (req.body || {}).budgets || {};
  const rows = [];
  for (const [category, amount] of Object.entries(body)) {
    if (!ex.CATEGORIES[category]) return res.status(400).json({ error: `알 수 없는 분류: ${category}` });
    const n = Math.round(Number(amount));
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "예산은 0 이상 숫자여야 합니다." });
    rows.push({ category, monthly_amount: n, updated_at: new Date().toISOString() });
  }
  const { error } = await supabaseAdmin.from("expense_budgets").upsert(rows, { onConflict: "category" });
  if (error) return res.status(missing(error) ? 503 : 500).json({ error: missing(error) ? MIGRATION_MISSING : "저장에 실패했습니다." });
  logAdminAction(req, "expense.budgets", "expense_budgets", "all", { budgets: body });
  res.json({ ok: true, budgets: await loadBudgets() });
});

function normalizeRecurring(b, { partial = false } = {}) {
  const out = {};
  if (!partial || b.name !== undefined) { out.name = String(b.name || "").trim().slice(0, 80); if (!out.name) return { error: "이름이 필요합니다." }; }
  if (!partial || b.supplierName !== undefined) { out.supplier_name = String(b.supplierName || b.name || "").trim().toLowerCase().slice(0, 50); if (!out.supplier_name) return { error: "거래처가 필요합니다." }; }
  if (!partial || b.amount !== undefined) { out.amount = Math.round(Number(b.amount)); if (!Number.isFinite(out.amount) || out.amount <= 0) return { error: "금액은 0보다 커야 합니다." }; }
  if (!partial || b.dayOfMonth !== undefined) { out.day_of_month = Math.round(Number(b.dayOfMonth || 1)); if (out.day_of_month < 1 || out.day_of_month > 28) return { error: "결제일은 1~28일입니다." }; }
  if (b.category !== undefined) { if (!ex.CATEGORIES[b.category]) return { error: "분류가 올바르지 않습니다." }; out.category = b.category; }
  if (b.paymentMethod !== undefined) { if (b.paymentMethod && !ex.PAYMENT_METHODS[b.paymentMethod]) return { error: "결제수단이 올바르지 않습니다." }; out.payment_method = b.paymentMethod || null; }
  if (b.evidenceType !== undefined) { if (b.evidenceType && !ex.EVIDENCE_TYPES[b.evidenceType]) return { error: "증빙이 올바르지 않습니다." }; out.evidence_type = b.evidenceType || null; }
  if (b.cardLast4 !== undefined) { const c = String(b.cardLast4 || "").replace(/\D/g, "").slice(-4); out.card_last4 = c.length === 4 ? c : null; }
  if (b.fundedBy !== undefined) { if (!/^[a-z0-9_-]{1,40}$/i.test(String(b.fundedBy || "business"))) return { error: "낸 사람이 올바르지 않습니다." }; out.funded_by = b.fundedBy || "business"; }
  if (b.active !== undefined) out.active = !!b.active;
  return { fields: out };
}

router.get("/api/admin/expenses/recurring", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("expense_recurring").select("*").order("created_at", { ascending: true });
  if (error) return res.json({ items: [], migrationMissing: missing(error) });
  res.json({ items: data || [] });
});

router.post("/api/admin/expenses/recurring", requireAdmin, async (req, res) => {
  const n = normalizeRecurring(req.body || {});
  if (n.error) return res.status(400).json({ error: n.error });
  const { data, error } = await supabaseAdmin.from("expense_recurring").insert({ active: true, category: "software", funded_by: "business", ...n.fields }).select().single();
  if (error) return res.status(missing(error) ? 503 : 500).json({ error: missing(error) ? MIGRATION_MISSING : "저장에 실패했습니다." });
  logAdminAction(req, "expense.recurring_create", "expense_recurring", data.id, n.fields);
  res.json({ ok: true, item: data });
});

router.patch("/api/admin/expenses/recurring/:id", requireAdmin, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: "정기 지출을 찾을 수 없습니다." });
  const n = normalizeRecurring(req.body || {}, { partial: true });
  if (n.error) return res.status(400).json({ error: n.error });
  const { data: before } = await supabaseAdmin.from("expense_recurring").select("*").eq("id", req.params.id).maybeSingle();
  if (!before) return res.status(404).json({ error: "정기 지출을 찾을 수 없습니다." });
  const { data, error } = await supabaseAdmin.from("expense_recurring").update({ ...n.fields, updated_at: new Date().toISOString() }).eq("id", req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: "저장에 실패했습니다." });
  logAdminAction(req, "expense.recurring_update", "expense_recurring", req.params.id, { before, after: n.fields });
  res.json({ ok: true, item: data });
});

/* [크론] 정기 지출 — 오늘(KST) 날짜가 결제일 이상이고 이번 달에 아직 안 만들었으면 "확인 대기"로 한 줄 만든다(같은 달 중복은 DB 유니크로 막힘) */
async function generateRecurringExpenses({ db = supabaseAdmin, now = new Date() } = {}) {
  const { data, error } = await db.from("expense_recurring").select("*").eq("active", true);
  if (error) return { created: 0, skipped: missing(error) ? "no_migration" : error.message };
  const kst = new Date(now.getTime() + 9 * 3600e3);
  const monthKey = kstMonthKey(now);
  const day = kst.getUTCDate();
  let created = 0;
  for (const r of data || []) {
    if (r.last_month === monthKey || day < r.day_of_month) continue;
    const issuedOn = `${monthKey}-${String(r.day_of_month).padStart(2, "0")}`;
    const { error: insErr } = await db.from(TABLE).insert({
      supplier_name: r.supplier_name, supplier_label: r.name, doc_type: "other", issued_on: issuedOn, total_amount: r.amount, items_summary: r.name,
      category: r.category, payment_method: r.payment_method, card_last4: r.card_last4, funded_by: r.funded_by, evidence_type: r.evidence_type,
      status: "RECORDED", source: "recurring", recurring_id: r.id, recurring_month: monthKey, metadata: {}, updated_at: now.toISOString(),
    });
    if (!insErr || insErr.code === "23505") {
      await db.from("expense_recurring").update({ last_month: monthKey }).eq("id", r.id);
      if (!insErr) created++;
    } else console.error("[expense-recurring] 생성 실패:", insErr.message);
  }
  return { created };
}

router.get("/api/admin/expenses/unit-costs", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("products").select("id, name_ko, unit_cost, price, active").order("sort_order", { ascending: true });
  if (error) {
    const r2 = await supabaseAdmin.from("products").select("id, name_ko, unit_cost, price, active");
    if (r2.error) return res.json({ items: [], migrationMissing: missing(r2.error) });
    return res.json({ items: r2.data.map((p) => ({ id: p.id, name: p.name_ko, unitCost: p.unit_cost ?? null, price: p.price, active: p.active })) });
  }
  res.json({ items: (data || []).map((p) => ({ id: p.id, name: p.name_ko, unitCost: p.unit_cost ?? null, price: p.price, active: p.active })) });
});

router.put("/api/admin/expenses/unit-costs", requireAdmin, async (req, res) => {
  const costs = (req.body || {}).costs || {};
  const changed = {};
  for (const [id, v] of Object.entries(costs)) {
    const n = v === "" || v === null ? null : Math.round(Number(v));
    if (n !== null && (!Number.isFinite(n) || n < 0)) return res.status(400).json({ error: "원가는 0 이상 숫자여야 합니다." });
    const { error } = await supabaseAdmin.from("products").update({ unit_cost: n }).eq("id", id);
    if (error) return res.status(missing(error) ? 503 : 500).json({ error: missing(error) ? MIGRATION_MISSING : "저장에 실패했습니다." });
    changed[id] = n;
  }
  logAdminAction(req, "expense.unit_costs", "products", "unit_cost", changed);
  res.json({ ok: true });
});

/* 상품별 마진 — 그 달 주문(취소 제외)의 상품별 판매액·수량 − 원가×수량 */
router.get("/api/admin/expenses/margin", requireAdmin, async (req, res) => {
  const monthKey = monthParam(req.query.month);
  const mb = ex.monthBounds(monthKey);
  const [{ data: orders }, { data: products, error: pErr }] = await Promise.all([
    supabaseAdmin.from("orders").select("items, status").gte("created_at", `${mb.first}T00:00:00+09:00`).lt("created_at", `${mb.next}T00:00:00+09:00`),
    supabaseAdmin.from("products").select("id, name_ko, unit_cost"),
  ]);
  if (pErr) return res.json({ month: monthKey, items: [], migrationMissing: missing(pErr) });
  const byId = new Map((products || []).map((p) => [p.id, p]));
  const agg = new Map();
  for (const o of orders || []) {
    if (o.status === "취소") continue;
    for (const it of o.items || []) {
      if (!it || !it.productId || String(it.productId).startsWith("charm-")) continue;
      const cur = agg.get(it.productId) || { productId: it.productId, qty: 0, revenue: 0 };
      cur.qty += Number(it.qty) || 0;
      cur.revenue += Number(it.sum) || 0;
      agg.set(it.productId, cur);
    }
  }
  const items = [...agg.values()].map((a) => {
    const p = byId.get(a.productId) || {};
    const unitCost = p.unit_cost ?? null;
    const cost = unitCost == null ? null : unitCost * a.qty;
    return { ...a, name: p.name_ko || a.productId, unitCost, cost, margin: cost == null ? null : a.revenue - cost, marginRate: cost == null || !a.revenue ? null : (a.revenue - cost) / a.revenue };
  }).sort((x, y) => y.revenue - x.revenue);
  res.json({ month: monthKey, items });
});

/* ---------- ④ CSV 가져오기·내보내기·AI 요약 ---------- */
/* 화면이 카드사·은행 CSV를 읽어 열을 고른 뒤 보내는 줄: [{ date:'YYYY-MM-DD', merchant, amount, cardLast4?, memo? }] + 기본값.
   같은 거래(날짜·금액·가맹점·카드)는 다시 넣지 않는다. 분류를 확인해야 하므로 "확인 대기"로 들어간다. */
router.post("/api/admin/expenses/import", requireAdmin, async (req, res) => {
  const rows = Array.isArray((req.body || {}).rows) ? req.body.rows : [];
  const d = (req.body || {}).defaults || {};
  if (!rows.length || rows.length > 1000) return res.status(400).json({ error: "가져올 줄이 없거나 너무 많습니다(최대 1000줄)." });
  if (d.category && !ex.CATEGORIES[d.category]) return res.status(400).json({ error: "기본 분류가 올바르지 않습니다." });
  if (d.paymentMethod && !ex.PAYMENT_METHODS[d.paymentMethod]) return res.status(400).json({ error: "기본 결제수단이 올바르지 않습니다." });
  if (d.fundedBy && !/^[a-z0-9_-]{1,40}$/i.test(d.fundedBy)) return res.status(400).json({ error: "낸 사람이 올바르지 않습니다." });
  let created = 0;
  let duplicates = 0;
  const invalid = [];
  const nowIso = new Date().toISOString();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const date = String(r.date || "").trim();
    const amount = Math.round(Math.abs(Number(String(r.amount ?? "").replace(/[^0-9.-]/g, ""))));
    const merchant = String(r.merchant || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const last4 = String(r.cardLast4 || d.cardLast4 || "").replace(/\D/g, "").slice(-4);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !amount || !merchant) { invalid.push(i + 1); continue; }
    const hash = ex.importHash({ date, amount, merchant, cardLast4: last4 });
    // DB 유니크 색인(052)도 막지만, 한 번 더 확인해 같은 파일을 두 번 올려도 안전하게
    const { data: dup } = await supabaseAdmin.from(TABLE).select("id").eq("import_hash", hash).maybeSingle();
    if (dup) { duplicates++; continue; }
    const ins = await writeWithExpenseColumns((p) => supabaseAdmin.from(TABLE).insert(p).select("id").single(), {
      supplier_name: merchant.toLowerCase().slice(0, 50), supplier_label: merchant, doc_type: "other", issued_on: date, total_amount: amount,
      items_summary: String(r.memo || "").slice(0, 300) || null, category: d.category || "other", payment_method: d.paymentMethod || null,
      card_last4: last4.length === 4 ? last4 : null, funded_by: d.fundedBy || "business", evidence_type: d.evidenceType || (d.paymentMethod && d.paymentMethod.endsWith("card") ? "card" : null),
      status: "RECORDED", source: "import", import_hash: hash, metadata: { importedBy: req.user.email }, updated_at: nowIso,
    });
    if (ins.error) {
      if (ins.error.code === "23505") duplicates++;
      else if (missing(ins.error)) return res.status(503).json({ error: MIGRATION_MISSING });
      else invalid.push(i + 1);
    } else created++;
  }
  logAdminAction(req, "expense.import", "supplier_invoices", "import", { created, duplicates, invalid: invalid.length });
  res.json({ ok: true, created, duplicates, invalid });
});

async function partnerNameMap() {
  const p = await loadPartners();
  return Object.fromEntries((p.partners || []).map((x) => [x.id, x.name]));
}

/* 세무 신고·장부용 내보내기 — 기간(from~to, 기본 이번 달), 확인된 지출만 */
router.get("/api/admin/expenses/export", requireAdmin, async (req, res) => {
  const mk = monthParam(req.query.month);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? req.query.from : ex.monthBounds(mk).first;
  const toExcl = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? new Date(new Date(`${req.query.to}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10) : ex.monthBounds(mk).next;
  const { data, error } = await rowsBetween(from, toExcl);
  if (error) return res.status(500).json({ error: "내보내기에 실패했습니다." });
  const names = await partnerNameMap();
  const rows = (data || []).filter((r) => r.status === "CONFIRMED").sort((a, b) => String(a.issued_on).localeCompare(String(b.issued_on))).map((r) => ex.toLedgerRow(r, names));
  logAdminAction(req, "expense.export", "supplier_invoices", `${from}~${toExcl}`, { count: rows.length, format: req.query.format });
  const fname = `reiten-expenses-${from}`;
  if (req.query.format === "xlsx") {
    const buf = await toXlsxBufferGeneric([{ name: "지출 장부", columns: ex.LEDGER_COLUMNS, rows }]);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}.xlsx"`);
    return res.send(buf);
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fname}.csv"`);
  res.send(toCsvGeneric([{ title: "지출 장부", columns: ex.LEDGER_COLUMNS, rows }]));
});

/* AI 피드백용 요약 — 개인정보·카드번호 없이 합계·분류·거래처·추이·예산만. 사람에게도(복사해서 다른 AI에 붙여넣기), 실시간 에이전트 AI에게도 같은 내용 */
async function buildAiSummary(monthKey) {
  const from = ex.monthBounds(ex.shiftMonth(monthKey, -5)).first;
  const to = ex.monthBounds(monthKey).next;
  const { data, error } = await rowsBetween(from, to);
  if (error) return { error };
  const rows = data || [];
  const inMonth = (mk) => rows.filter((r) => String(r.issued_on).slice(0, 7) === mk);
  const budgets = await loadBudgets();
  const cur = ex.summarize(inMonth(monthKey), { budgets });
  const prev = ex.summarize(inMonth(ex.shiftMonth(monthKey, -1)));
  const trend = [-5, -4, -3, -2, -1, 0].map((d) => ({ month: ex.shiftMonth(monthKey, d), total: ex.summarize(inMonth(ex.shiftMonth(monthKey, d))).confirmedTotal }));
  const mb = ex.monthBounds(monthKey);
  const { data: orders } = await supabaseAdmin.from("orders").select("total, status, refunded_amount").gte("created_at", `${mb.first}T00:00:00+09:00`).lt("created_at", `${mb.next}T00:00:00+09:00`);
  const revenue = (orders || []).filter((o) => o.status !== "취소").reduce((n, o) => n + (o.total || 0) - (o.refunded_amount || 0), 0);
  const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
  const lines = [
    `# REITEN ${monthKey} 지출 요약 (AI 피드백용)`,
    `- 매출(취소·환불 제외) ${won(revenue)} / 확인된 지출 ${won(cur.confirmedTotal)} / 남은 돈 ${won(revenue - cur.confirmedTotal)}`,
    `- 지난달 지출 ${won(prev.confirmedTotal)} → 이번 달 ${won(cur.confirmedTotal)}` + (prev.confirmedTotal ? ` (${Math.round(((cur.confirmedTotal - prev.confirmedTotal) / prev.confirmedTotal) * 100)}%)` : ""),
    `- 확인 대기 ${cur.pendingCount}건 ${won(cur.pendingTotal)}`,
    `## 분류별`, ...cur.byCategory.map((c) => `- ${c.label}: ${won(c.total)}${revenue ? ` (매출의 ${Math.round((c.total / revenue) * 100)}%)` : ""}`),
    `## 결제수단별`, ...cur.byPaymentMethod.map((c) => `- ${c.label}: ${won(c.total)}`),
    `## 거래처 상위`, ...cur.topSuppliers.map((s) => `- ${s.label || s.name}: ${won(s.total)} (${s.count}건)`),
    `## 6개월 지출 추이`, ...trend.map((t) => `- ${t.month}: ${won(t.total)}`),
    ...(cur.budgets.length ? [`## 예산`, ...cur.budgets.map((b) => `- ${b.label}: ${won(b.spent)} / ${won(b.budget)} (${Math.round(b.ratio * 100)}%)`)] : []),
    `## 부가세(안내용)`, `- 매입세액 공제 후보 약 ${won(cur.vat.deductibleCandidate)}, 확인 필요 약 ${won(cur.vat.needsCheck)}`,
    `요청: 위 숫자를 보고 줄일 수 있는 지출, 비정상적으로 늘어난 항목, 매출 대비 비율이 높은 항목을 짚어 주세요.`,
  ];
  return { month: monthKey, revenue, ...cur, previousTotal: prev.confirmedTotal, trend, text: lines.join("\n") };
}

router.get("/api/admin/expenses/ai-summary", requireAdmin, async (req, res) => {
  const s = await buildAiSummary(monthParam(req.query.month));
  if (s.error) return res.status(missing(s.error) ? 200 : 500).json(missing(s.error) ? { migrationMissing: true } : { error: "요약을 만들지 못했습니다." });
  res.json(s);
});

router.get("/api/bot/expenses/summary", botLimiter, requireBotKey, async (req, res) => {
  const s = await buildAiSummary(monthParam(req.query.month));
  if (s.error) return res.status(503).json({ ok: false, error: MIGRATION_MISSING });
  supabaseAdmin.from("admin_audit_log").insert({ admin_id: BOT_ACTOR_ID, admin_email: "bot:pickle", action: "bot.expense_summary_read", target_type: "system", target_id: s.month, detail: { ip: req.ip } })
    .then(({ error }) => { if (error) console.error("[bot] 활동 로그 적재 실패:", error.message); });
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, ...s });
});

module.exports = router;
module.exports.generateRecurringExpenses = generateRecurringExpenses;
module.exports.buildAiSummary = buildAiSummary;
