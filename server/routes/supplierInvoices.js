/* ---------- 매입 장부 (2026-11-10, 마이그레이션 050) ----------
   공급처의 거래명세서·세금계산서·영수증 메일에서 피클이 금액을 뽑아 기록하고(상태 RECORDED), 사람이 Works 대시보드
   "매입 장부"에서 확인(CONFIRMED)하거나 잘못된 기록을 제외(REJECTED)한다. 확인된 매입은 월간 정산 엑셀에 들어간다(lib/settlement.js).
   ① POST /api/bot/supplier-invoices — 피클 기록. 같은 공급처+문서번호면 갱신(이미 사람이 확인한 줄은 바꾸지 않음).
      문서번호가 없으면 같은 공급처·발행일·합계 금액의 줄을 같은 문서로 본다(같은 메일을 두 번 읽어도 한 줄).
   ② GET /api/admin/supplier-invoices?month=YYYY-MM, PATCH /api/admin/supplier-invoices/:id — Works(권한 영역 dashboard).
   피클은 돈을 보내거나 결제하지 않는다 — 기록만 한다. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { isMissingSchemaError } = require("../lib/pgErrors");
const { botWriteLimiter } = require("../lib/rateLimiters");
const { requireBotKey, BOT_ACTOR_ID } = require("../lib/botAuth");
const { monthRangeFromKey } = require("../lib/settlement");
const { kstMonthKey } = require("../lib/kst");
const { isMissingColumnError, extractMissingColumnName } = require("../lib/pgErrors");
const { CATEGORIES, PAYMENT_METHODS, EVIDENCE_TYPES, vatDeductibility } = require("../lib/expenses");

/* 지출 장부 칸(052) — 실행 전이면 이 칸만 빼고 다시 쓴다 */
const EXPENSE_COLUMNS = ["category", "payment_method", "card_last4", "funded_by", "evidence_type", "memo", "shared", "settlement_id", "recurring_id", "recurring_month", "import_hash", "product_id"];
async function writeWithExpenseColumns(run, payload) {
  let current = { ...payload };
  let result = await run(current);
  for (let i = 0; i < EXPENSE_COLUMNS.length && result.error && isMissingColumnError(result.error); i++) {
    const named = extractMissingColumnName(result.error);
    const col = named && named in current ? named : EXPENSE_COLUMNS.find((c) => c in current);
    if (!col) break;
    const { [col]: _omit, ...rest } = current;
    current = rest;
    result = await run(current);
  }
  return result;
}

const router = express.Router();
const TABLE = "supplier_invoices";
const DOC_TYPES = ["statement", "tax_invoice", "receipt", "other"];
const STATUSES = ["RECORDED", "CONFIRMED", "REJECTED"];
const MAX_AMOUNT = 1000000000;
const MIGRATION_MISSING = "매입 장부 표가 아직 없습니다(마이그레이션 050 미실행)";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanText(v, max) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
}

/* 금액: 정수 원. "12,000원" 같은 글도 숫자만 뽑는다. 없으면 undefined, 이상하면 null. */
function parseAmount(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return null;
  return Math.round(n);
}

/* 피클 본문 → 저장할 값. 순수 함수(테스트용). */
function normalizeInvoice(body) {
  const b = body && typeof body === "object" ? body : {};
  const supplierName = cleanText(b.supplierName, 50);
  if (!supplierName) return { error: "공급처(supplierName)가 필요합니다" };
  const docType = String(b.docType || "statement");
  if (!DOC_TYPES.includes(docType)) return { error: `docType은 ${DOC_TYPES.join(", ")} 중 하나여야 합니다` };
  const issuedOn = String(b.issuedOn || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn) || Number.isNaN(new Date(`${issuedOn}T00:00:00Z`).getTime())) return { error: "issuedOn은 YYYY-MM-DD 형식이어야 합니다" };
  const total = parseAmount(b.totalAmount);
  const supply = parseAmount(b.supplyAmount);
  const vat = parseAmount(b.vatAmount);
  if (total === undefined || total === null) return { error: "totalAmount(합계, 원)가 필요합니다" };
  if (supply === null || vat === null) return { error: "금액 형식이 올바르지 않습니다" };
  let metadata = {};
  if (b.metadata !== undefined && b.metadata !== null) {
    if (typeof b.metadata !== "object" || Array.isArray(b.metadata) || JSON.stringify(b.metadata).length > 4000) return { error: "metadata는 4000자 이하의 객체여야 합니다" };
    metadata = b.metadata;
  }
  // 지출 장부 칸(2026-11-11, 052) — 모두 선택. 빈 문자열은 "지우기"
  const opt = (v) => (v === undefined ? undefined : v === null || v === "" ? null : v);
  const category = opt(b.category);
  if (category && !CATEGORIES[category]) return { error: `category는 ${Object.keys(CATEGORIES).join(", ")} 중 하나여야 합니다` };
  const paymentMethod = opt(b.paymentMethod);
  if (paymentMethod && !PAYMENT_METHODS[paymentMethod]) return { error: `paymentMethod는 ${Object.keys(PAYMENT_METHODS).join(", ")} 중 하나여야 합니다` };
  const evidenceType = opt(b.evidenceType);
  if (evidenceType && !EVIDENCE_TYPES[evidenceType]) return { error: `evidenceType은 ${Object.keys(EVIDENCE_TYPES).join(", ")} 중 하나여야 합니다` };
  let cardLast4 = opt(b.cardLast4);
  if (cardLast4) {
    cardLast4 = String(cardLast4).replace(/\D/g, "").slice(-4);
    if (cardLast4.length !== 4) return { error: "cardLast4는 카드 번호 뒤 4자리 숫자입니다(전체 번호는 저장하지 않음)" };
  }
  const fundedBy = opt(b.fundedBy);
  if (fundedBy && !/^[a-z0-9_-]{1,40}$/i.test(fundedBy)) return { error: "fundedBy는 'business' 또는 동업자 id입니다" };
  // 공급가액+부가세가 합계와 다르면 저장은 하되 표시(사람이 확인할 때 보게)
  const amountMismatch = supply !== undefined && vat !== undefined && Math.abs(supply + vat - total) > 1;
  return {
    fields: {
      supplier_name: supplierName.toLowerCase(),
      supplier_label: cleanText(b.supplierLabel, 80),
      doc_type: docType,
      doc_number: cleanText(b.docNumber, 100),
      issued_on: issuedOn,
      supply_amount: supply,
      vat_amount: vat,
      total_amount: total,
      items_summary: cleanText(b.itemsSummary, 1000),
      metadata: amountMismatch ? { ...metadata, amountMismatch: true } : metadata,
      category: category === null ? "other" : category,
      payment_method: paymentMethod,
      card_last4: cardLast4,
      funded_by: fundedBy === null ? "business" : fundedBy,
      evidence_type: evidenceType,
      memo: b.memo === undefined ? undefined : cleanText(b.memo, 1000) || null,
      shared: b.shared === undefined ? undefined : b.shared !== false && b.shared !== "false",
      product_id: b.productId === undefined ? undefined : cleanText(b.productId, 100) || null,
    },
    trackingNumber: String(b.trackingNumber || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase() || null,
    amountMismatch,
  };
}

function toApi(r) {
  return {
    id: r.id,
    supplierName: r.supplier_name,
    supplierLabel: r.supplier_label || null,
    docType: r.doc_type,
    docNumber: r.doc_number || null,
    issuedOn: r.issued_on,
    supplyAmount: r.supply_amount ?? null,
    vatAmount: r.vat_amount ?? null,
    totalAmount: r.total_amount,
    itemsSummary: r.items_summary || null,
    shipmentId: r.shipment_id || null,
    status: r.status,
    source: r.source || null,
    amountMismatch: !!(r.metadata && r.metadata.amountMismatch),
    category: r.category || "purchase",
    paymentMethod: r.payment_method || null,
    cardLast4: r.card_last4 || null,
    fundedBy: r.funded_by || "business",
    evidenceType: r.evidence_type || null,
    memo: r.memo || null,
    shared: r.shared !== false,
    settlementId: r.settlement_id || null,
    recurringId: r.recurring_id || null,
    productId: r.product_id || null,
    vatDeductible: vatDeductibility(r),
    createdAt: r.created_at || null,
  };
}

const dropUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/* /api/bot/expenses는 같은 기능의 새 이름(2026-11-11 지출 장부) — 매입 외 지출도 이 통로로 */
router.post(["/api/bot/supplier-invoices", "/api/bot/expenses"], botWriteLimiter, requireBotKey, async (req, res) => {
  const n = normalizeInvoice(req.body);
  if (n.error) return res.status(400).json({ ok: false, error: n.error });
  const f = n.fields;
  try {
    // 같은 문서 찾기
    let q = supabaseAdmin.from(TABLE).select("*").eq("supplier_name", f.supplier_name);
    q = f.doc_number ? q.eq("doc_number", f.doc_number) : q.eq("issued_on", f.issued_on).eq("total_amount", f.total_amount).is("doc_number", null);
    const { data: found, error: findErr } = await q.limit(1);
    if (findErr) throw findErr;
    const existing = (found || [])[0];

    // 송장번호를 주면 그 공급처 송장과 연결
    let shipmentId;
    if (n.trackingNumber) {
      const { data: sh } = await supabaseAdmin.from("supplier_shipments").select("id").eq("supplier_name", f.supplier_name).eq("tracking_number", n.trackingNumber).maybeSingle();
      if (sh) shipmentId = sh.id;
    }

    const nowIso = new Date().toISOString();
    let row;
    let created = false;
    if (existing) {
      if (existing.status !== "RECORDED") return res.json({ ok: true, created: false, unchanged: true, invoice: toApi(existing) });
      // 사람이 고친 칸은 AI가 덮어쓰지 않는다(2026-11-11)
      const humanEdited = (existing.metadata && existing.metadata.humanEdited) || [];
      const botPatch = dropUndefined({ ...f, metadata: { ...(existing.metadata || {}), ...f.metadata, humanEdited }, shipment_id: shipmentId, updated_at: nowIso });
      for (const col of humanEdited) delete botPatch[col];
      const { data, error } = await writeWithExpenseColumns((p) => supabaseAdmin.from(TABLE).update(p).eq("id", existing.id).select().single(), botPatch);
      if (error) throw error;
      row = data;
    } else {
      const { data, error } = await writeWithExpenseColumns((p) => supabaseAdmin.from(TABLE).insert(p).select().single(), dropUndefined({ ...f, shipment_id: shipmentId, status: "RECORDED", source: "pickle", updated_at: nowIso }));
      if (error) throw error;
      row = data;
      created = true;
    }
    supabaseAdmin
      .from("admin_audit_log")
      .insert({ admin_id: BOT_ACTOR_ID, admin_email: "bot:pickle", action: created ? "bot.supplier_invoice_create" : "bot.supplier_invoice_update", target_type: "supplier_invoice", target_id: String(row.id), detail: { supplier: row.supplier_name, total: row.total_amount, ip: req.ip } })
      .then(({ error }) => { if (error) console.error("[bot] 활동 로그 적재 실패:", error.message); });
    res.json({ ok: true, created, amountMismatch: n.amountMismatch, invoice: toApi(row) });
  } catch (err) {
    if (isMissingSchemaError(err)) return res.status(503).json({ ok: false, error: MIGRATION_MISSING });
    console.error("[botSupplierInvoices]", err && err.message);
    res.status(500).json({ ok: false, error: "매입 기록 실패" });
  }
});

/* 달별 목록 + 합계(확인된 것·확인 대기). 공급처별 확인된 합계도 함께. */
router.get("/api/admin/supplier-invoices", requireAdmin, async (req, res) => {
  const monthKey = /^\d{4}-\d{2}$/.test(String(req.query.month || "")) ? String(req.query.month) : kstMonthKey(new Date());
  const range = monthRangeFromKey(monthKey);
  if (!range) return res.status(400).json({ error: "월 형식이 올바르지 않습니다(YYYY-MM)." });
  const [y, m] = monthKey.split("-").map(Number);
  const first = `${monthKey}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").gte("issued_on", first).lt("issued_on", next).order("issued_on", { ascending: false }).limit(1000);
  if (error) {
    if (isMissingSchemaError(error)) return res.json({ month: monthKey, items: [], totals: { confirmed: 0, recorded: 0 }, bySupplier: [], migrationMissing: true });
    console.error("[supplier-invoices] 목록 조회 실패:", error.message);
    return res.status(500).json({ error: "매입 장부를 불러오지 못했습니다." });
  }
  const totals = { confirmed: 0, recorded: 0 };
  const bySupplier = new Map();
  for (const r of data || []) {
    if (r.status === "CONFIRMED") {
      totals.confirmed += r.total_amount || 0;
      const cur = bySupplier.get(r.supplier_name) || { name: r.supplier_name, label: r.supplier_label || null, total: 0 };
      cur.total += r.total_amount || 0;
      bySupplier.set(r.supplier_name, cur);
    } else if (r.status === "RECORDED") totals.recorded += r.total_amount || 0;
  }
  res.json({ month: monthKey, items: (data || []).map(toApi), totals, bySupplier: [...bySupplier.values()].sort((a, b) => b.total - a.total) });
});

/* 사람이 직접 입력(2026-11-11) — AI가 놓친 매입, 현금 영수증 등. 사람이 넣은 것은 바로 "확인" 상태. */
router.post("/api/admin/supplier-invoices", requireAdmin, async (req, res) => {
  const n = normalizeInvoice(req.body);
  if (n.error) return res.status(400).json({ error: n.error });
  const nowIso = new Date().toISOString();
  const { data, error } = await writeWithExpenseColumns(
    (p) => supabaseAdmin.from(TABLE).insert(p).select().single(),
    dropUndefined({ ...n.fields, metadata: { ...n.fields.metadata, createdBy: req.user.email }, status: "CONFIRMED", source: "manual", updated_at: nowIso })
  );
  if (error) {
    if (isMissingSchemaError(error)) return res.status(503).json({ error: MIGRATION_MISSING });
    if (error.code === "23505") return res.status(409).json({ error: "같은 공급처·문서번호의 기록이 이미 있습니다." });
    console.error("[supplier-invoices] 직접 입력 실패:", error.message);
    return res.status(500).json({ error: "저장에 실패했습니다." });
  }
  logAdminAction(req, "supplier_invoice.create", "supplier_invoice", data.id, { supplier: data.supplier_name, total: data.total_amount });
  res.json({ ok: true, invoice: toApi(data) });
});

/* 확인·제외·되돌리기, 그리고 모든 칸 고치기(AI가 잘못 읽었을 때). 확인된 줄도 사람은 고칠 수 있다. 바뀌기 전 값은 활동 로그에. */
router.patch("/api/admin/supplier-invoices/:id", requireAdmin, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: "해당 매입 기록을 찾을 수 없습니다." });
  const b = req.body || {};
  const { data: cur, error: curErr } = await supabaseAdmin.from(TABLE).select("*").eq("id", req.params.id).maybeSingle();
  if (curErr) return res.status(isMissingSchemaError(curErr) ? 503 : 500).json({ error: isMissingSchemaError(curErr) ? MIGRATION_MISSING : "불러오지 못했습니다." });
  if (!cur) return res.status(404).json({ error: "해당 매입 기록을 찾을 수 없습니다." });

  const patch = {};
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return res.status(400).json({ error: "상태 값이 올바르지 않습니다." });
    patch.status = b.status;
  }
  const fieldKeys = ["supplierName", "supplierLabel", "docType", "docNumber", "issuedOn", "supplyAmount", "vatAmount", "totalAmount", "itemsSummary",
    "category", "paymentMethod", "cardLast4", "fundedBy", "evidenceType", "memo", "shared", "productId"];
  // 동업자 정산에 들어간 지출은 금액·낸 사람·부담 방식·상태를 바꾸지 못한다(정산을 먼저 취소) — 정산 결과가 어긋나지 않게
  if (cur.settlement_id) {
    const locked = ["totalAmount", "fundedBy", "shared"].filter((k) => b[k] !== undefined && String(b[k]) !== String({ totalAmount: cur.total_amount, fundedBy: cur.funded_by, shared: cur.shared }[k]));
    if (locked.length || (b.status !== undefined && b.status !== cur.status)) {
      return res.status(409).json({ error: "동업자 정산에 포함된 지출입니다. 금액·낸 사람·상태를 바꾸려면 그 정산을 먼저 취소해 주세요." });
    }
  }
  if (fieldKeys.some((k) => b[k] !== undefined)) {
    const merged = {
      supplierName: cur.supplier_name, supplierLabel: cur.supplier_label, docType: cur.doc_type, docNumber: cur.doc_number, issuedOn: cur.issued_on,
      supplyAmount: cur.supply_amount, vatAmount: cur.vat_amount, totalAmount: cur.total_amount, itemsSummary: cur.items_summary,
      category: cur.category, paymentMethod: cur.payment_method, cardLast4: cur.card_last4, fundedBy: cur.funded_by, evidenceType: cur.evidence_type,
      memo: cur.memo, shared: cur.shared, productId: cur.product_id,
    };
    for (const k of fieldKeys) if (b[k] !== undefined) merged[k] = b[k] === "" ? null : b[k];
    const n = normalizeInvoice(merged);
    if (n.error) return res.status(400).json({ error: n.error });
    const f = n.fields;
    const expenseCols = cur.category === undefined ? {} : {
      category: f.category ?? "other", payment_method: f.payment_method ?? null, card_last4: f.card_last4 ?? null, funded_by: f.funded_by ?? "business",
      evidence_type: f.evidence_type ?? null, memo: f.memo ?? null, shared: f.shared !== false, product_id: f.product_id ?? null,
    };
    for (const [col, v] of Object.entries({ supplier_name: f.supplier_name, supplier_label: f.supplier_label ?? null, doc_type: f.doc_type, doc_number: f.doc_number ?? null, issued_on: f.issued_on, supply_amount: f.supply_amount ?? null, vat_amount: f.vat_amount ?? null, total_amount: f.total_amount, items_summary: f.items_summary ?? null, ...expenseCols })) {
      if (String(v ?? "") !== String(cur[col] ?? "")) patch[col] = v;
    }
    const meta = { ...(cur.metadata || {}) };
    const edited = Object.keys(patch).filter((k) => k !== "status");
    if (edited.length) meta.humanEdited = [...new Set([...(meta.humanEdited || []), ...edited])];
    if (n.amountMismatch) meta.amountMismatch = true;
    else delete meta.amountMismatch;
    if (JSON.stringify(meta) !== JSON.stringify(cur.metadata || {})) patch.metadata = meta;
  }
  if (!Object.keys(patch).length) return res.json({ ok: true, unchanged: true, invoice: toApi(cur) });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from(TABLE).update(patch).eq("id", cur.id).select().maybeSingle();
  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "같은 공급처·문서번호의 기록이 이미 있습니다." });
    console.error("[supplier-invoices] 변경 실패:", error.message);
    return res.status(500).json({ error: "저장에 실패했습니다." });
  }
  const keys = Object.keys(patch).filter((k) => k !== "updated_at" && k !== "metadata");
  logAdminAction(req, keys.length === 1 && keys[0] === "status" ? "supplier_invoice.status" : "supplier_invoice.update", "supplier_invoice", data.id, {
    before: Object.fromEntries(keys.map((k) => [k, cur[k] ?? null])),
    after: Object.fromEntries(keys.map((k) => [k, patch[k]])),
  });
  res.json({ ok: true, invoice: toApi(data) });
});

module.exports = router;
module.exports.normalizeInvoice = normalizeInvoice;
module.exports.parseAmount = parseAmount;
module.exports.toApi = toApi;
module.exports.writeWithExpenseColumns = writeWithExpenseColumns;
