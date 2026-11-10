/* ---------- 공급처 출고 송장 기록 (2026-11-10, 마이그레이션 048) ----------
   프린트캔버스·나염 공장·원단 도매 등 "우리가 물건을 받는 쪽" 배송을 모은다. 고객 주문(orders)·환불과는 전혀 연결되지 않는다.
   ① POST /api/bot/supplier-shipments — 비서 에이전트(피클)가 출고 메일에서 뽑은 값을 보낸다(헤더 X-REITEN-BOT-KEY, lib/botAuth.js).
      같은 공급처+송장번호면 새 줄을 만들지 않고 갱신한다. 상태는 앞으로만 간다(배송완료 뒤 "출고" 메일이 다시 와도 되돌리지 않음),
      metadata는 덮어쓰지 않고 합친다. 메일 본문은 외부에서 온 글이므로 길이·형식을 서버가 다시 자르고 검사한다.
   ② GET /api/admin/supplier-shipments, PATCH /api/admin/supplier-shipments/:id — Works "재고" 탭 "공급처 입고·배송" 목록과
      "입고 완료" 처리(권한 영역 inventory, lib/adminGuard.js).
   에이전트 쓰기는 이 표 하나로만 한정한다 — 여기서 orders·refunds 등 다른 표를 건드리지 말 것(README 0번 피클 원칙). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { isMissingSchemaError, isMissingColumnError } = require("../lib/pgErrors");
const { botWriteLimiter } = require("../lib/rateLimiters");
const { requireBotKey, BOT_ACTOR_ID } = require("../lib/botAuth");
const carriers = require("../lib/carriers");
const tracking = require("../lib/tracking");
const budget = require("../lib/trackingBudget");
const { TABLE, STATUS_RANK, OPEN_STATUSES, toApi, trackShipment, patchFromResult, supplierTrackingProvider, recheckHours, writeWithOptionalColumns } = require("../lib/supplierShipments");
const { botLimiter } = require("../lib/rateLimiters");
const { logInventoryChange, logSystemError } = require("../lib/adminLog");
const { notifyRestockSubscribers } = require("./inventory");

const router = express.Router();

const BOT_STATUSES = ["SHIPPED", "IN_TRANSIT", "DELIVERED"];
const ADMIN_STATUSES = ["SHIPPED", "IN_TRANSIT", "DELIVERED", "RECEIVED", "CANCELED"];
const METADATA_MAX_CHARS = 4000;
const MIGRATION_MISSING = "공급처 송장 표가 아직 없습니다(마이그레이션 048 미실행)";

/* 메일에서 온 글 — 제어문자를 지우고 길이를 자른다. 빈 값은 undefined(= 이번 요청에서 안 바꿈). */
function cleanText(v, max) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
}

function parseDate(v) {
  if (v === undefined || v === null || v === "") return { value: undefined };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { error: true };
  return { value: d.toISOString() };
}

/* 입고 품목 [{ productId?, color?, size?, qty, name? }] — 피클 초안은 상품을 못 찾았으면 name만 있어도 된다(사람이 Works에서 고른다).
   Works 입고 확정 때는 productId·color·size가 모두 있어야 한다(requireProduct). undefined면 이번 요청에서 안 바꿈. */
function parseReceiptItems(v, { requireProduct }) {
  if (v === undefined || v === null) return { items: undefined };
  if (!Array.isArray(v) || v.length > 50) return { error: "receiptItems는 50개 이하의 배열이어야 합니다" };
  const items = [];
  for (const it of v) {
    const qty = Math.floor(Number(it && it.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 100000) return { error: "입고 수량(qty)은 1~100000 사이 정수여야 합니다" };
    const row = {
      productId: cleanText(it.productId, 100) || null,
      color: cleanText(it.color, 40) || null,
      size: cleanText(it.size, 20) || null,
      qty,
      name: cleanText(it.name, 100) || null,
    };
    if (requireProduct && !(row.productId && row.color && row.size)) return { error: "재고에 더할 품목은 상품·색상·사이즈가 모두 있어야 합니다" };
    if (!requireProduct && !row.productId && !row.name) return { error: "입고 품목에는 productId 또는 name이 필요합니다" };
    items.push(row);
  }
  return { items };
}

/* 봇 요청 본문 → 저장할 값(snake_case). 순수 함수(테스트용). { fields } 또는 { error } */
function normalizeBotShipment(body) {
  const b = body && typeof body === "object" ? body : {};
  const supplierName = cleanText(b.supplierName, 50);
  const rawCarrierCode = cleanText(b.carrierCode, 50);
  const carrierName = cleanText(b.carrierName, 50);
  const trackingNumber = String(b.trackingNumber || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (!supplierName || !(rawCarrierCode || carrierName) || !trackingNumber) return { error: "필수 정보(공급처, 택배사, 송장번호) 누락" };
  if (trackingNumber.length < 6 || trackingNumber.length > 40) return { error: "송장번호 형식이 올바르지 않습니다(숫자·영문 6~40자)" };
  /* 택배사는 코드('kr.cjlogistics')나 이름('CJ대한통운', '경동택배') 어느 쪽으로 와도 lib/carriers.js 표에서 찾아 같은 코드로 저장한다.
     표에 없는 택배사도 받는다(코드 형식이면 그대로, 이름만 왔으면 'etc') — 배송조회 때 이름으로 스마트택배 목록을 찾는다. */
  const known = carriers.findCarrier(rawCarrierCode, carrierName);
  let carrierCode = known ? known.id : rawCarrierCode && /^[a-z0-9._-]+$/i.test(rawCarrierCode) ? rawCarrierCode.toLowerCase() : null;
  if (!carrierCode) {
    if (!carrierName) return { error: "택배사를 알아볼 수 없습니다(코드 예: kr.cjlogistics, 또는 carrierName에 택배사 이름)" };
    carrierCode = "etc";
  }

  let status;
  if (b.status !== undefined && b.status !== null && b.status !== "") {
    status = String(b.status).toUpperCase();
    if (!BOT_STATUSES.includes(status)) return { error: `status는 ${BOT_STATUSES.join(", ")} 중 하나여야 합니다` };
  }
  const shipped = parseDate(b.shippedAt);
  const delivered = parseDate(b.deliveredAt);
  if (shipped.error || delivered.error) return { error: "날짜 형식이 올바르지 않습니다(ISO 8601)" };

  const receipt = parseReceiptItems(b.receiptItems, { requireProduct: false });
  if (receipt.error) return { error: receipt.error };

  let metadata;
  if (b.metadata !== undefined && b.metadata !== null) {
    if (typeof b.metadata !== "object" || Array.isArray(b.metadata)) return { error: "metadata는 객체여야 합니다" };
    if (JSON.stringify(b.metadata).length > METADATA_MAX_CHARS) return { error: `metadata가 너무 깁니다(${METADATA_MAX_CHARS}자 이하)` };
    metadata = b.metadata;
  }

  return {
    fields: {
      supplier_name: supplierName.toLowerCase(),
      supplier_label: cleanText(b.supplierLabel, 80),
      carrier_code: carrierCode,
      tracking_number: trackingNumber,
      supplier_order_id: cleanText(b.supplierOrderId, 100),
      carrier_name: carrierName || (known ? known.name : undefined),
      items_summary: cleanText(b.itemsSummary, 1000),
      recipient_name: cleanText(b.recipientName, 50),
      status,
      receipt_items: receipt.items,
      shipped_at: shipped.value,
      delivered_at: delivered.value,
      metadata,
    },
  };
}

function dropUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/* 기존 행 + 새 값 → 갱신할 열만. 상태는 뒤로 가지 않고(관리자가 정한 입고 완료·취소도 유지), metadata는 합친다. */
function buildUpdate(existing, fields, nowIso) {
  // 출고일·배송완료일은 처음 들어온 값을 지킨다(같은 메일이 다시 와도 날짜가 바뀌지 않게)
  const patch = dropUndefined({
    ...fields, status: undefined, metadata: undefined,
    shipped_at: existing.shipped_at ? undefined : fields.shipped_at,
    delivered_at: existing.delivered_at ? undefined : fields.delivered_at,
  });
  const cur = existing.status;
  if (fields.status && cur !== "CANCELED" && (STATUS_RANK[fields.status] || 0) > (STATUS_RANK[cur] || 0)) patch.status = fields.status;
  if (fields.metadata) patch.metadata = { ...(existing.metadata || {}), ...fields.metadata };
  if (existing.received_at) delete patch.receipt_items; // 이미 입고 처리된 품목은 바꾸지 않는다
  // 사람이 Works에서 고친 칸은 AI가 같은 메일을 다시 보내도 덮어쓰지 않는다(2026-11-11)
  for (const col of (existing.metadata && existing.metadata.humanEdited) || []) delete patch[col];
  if ((patch.status || cur) === "DELIVERED" && !existing.delivered_at && !patch.delivered_at) patch.delivered_at = nowIso;
  patch.updated_at = nowIso;
  return patch;
}

function buildInsert(fields, nowIso) {
  const row = dropUndefined({ ...fields, status: fields.status || "SHIPPED", metadata: fields.metadata || {} });
  if (!row.shipped_at) row.shipped_at = nowIso;
  if (row.status === "DELIVERED" && !row.delivered_at) row.delivered_at = nowIso;
  row.updated_at = nowIso;
  return row;
}

/* 실제 DB의 id는 uuid라, 형식이 다른 값으로 조회하면 "없음"(404)이 아니라 Postgres 형식 오류(500)가 났다(2026-11-10 점검) — 미리 거른다. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function notFoundUnlessUuid(req, res, next) {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: "해당 송장을 찾을 수 없습니다." });
  next();
}

async function findExisting(supplierName, trackingNumber) {
  return supabaseAdmin.from(TABLE).select("*").eq("supplier_name", supplierName).eq("tracking_number", trackingNumber).maybeSingle();
}

router.post("/api/bot/supplier-shipments", botWriteLimiter, requireBotKey, async (req, res) => {
  const { fields, error: invalid } = normalizeBotShipment(req.body);
  if (invalid) return res.status(400).json({ ok: false, error: invalid });
  const nowIso = new Date().toISOString();

  try {
    let { data: existing, error } = await findExisting(fields.supplier_name, fields.tracking_number);
    if (error) throw error;
    let created = false;
    let row;
    if (!existing) {
      const ins = await writeWithOptionalColumns((p) => supabaseAdmin.from(TABLE).insert(p).select().single(), buildInsert(fields, nowIso));
      if (ins.error && ins.error.code === "23505") {
        // 같은 메일을 거의 동시에 두 번 보낸 경우 — 먼저 들어간 행을 갱신한다.
        ({ data: existing, error } = await findExisting(fields.supplier_name, fields.tracking_number));
        if (error || !existing) throw error || ins.error;
      } else if (ins.error) {
        throw ins.error;
      } else {
        row = ins.data;
        created = true;
      }
    }
    if (!row) {
      const upd = await writeWithOptionalColumns((p) => supabaseAdmin.from(TABLE).update(p).eq("id", existing.id).select().single(), buildUpdate(existing, fields, nowIso));
      if (upd.error) throw upd.error;
      row = upd.data;
    }

    supabaseAdmin
      .from("admin_audit_log")
      .insert({
        admin_id: BOT_ACTOR_ID,
        admin_email: "bot:pickle",
        action: created ? "bot.supplier_shipment_create" : "bot.supplier_shipment_update",
        target_type: "supplier_shipment",
        target_id: String(row.id),
        detail: { supplier: row.supplier_name, tracking: row.tracking_number, status: row.status, ip: req.ip },
      })
      .then(({ error: logErr }) => { if (logErr) console.error("[bot] 활동 로그 적재 실패:", logErr.message); });

    res.json({ ok: true, created, shipment: toApi(row) });
  } catch (err) {
    if (isMissingSchemaError(err)) return res.status(503).json({ ok: false, error: MIGRATION_MISSING });
    console.error("[botSupplierShipments]", err && err.message);
    res.status(500).json({ ok: false, error: "송장 동기화 실패" });
  }
});

/* 공급처별 건수용 — 단계 기록(tracking_events) 같은 큰 칸은 빼고 가져온다. 049 전이면 표시 이름 칸 없이. */
async function supplierSummaryRows() {
  const q = (cols) => supabaseAdmin.from(TABLE).select(cols).order("created_at", { ascending: false }).limit(2000);
  const r = await q("supplier_name, supplier_label, status");
  return r.error && isMissingColumnError(r.error) ? q("supplier_name, status") : r;
}

/* Works 목록 — 상태(진행 중/입고 완료/전체…)·공급처로 거르고, 공급처 목록(건수)·배송조회 사용 가능 여부·이번 달 조회 사용량을 함께 준다. */
router.get("/api/admin/supplier-shipments", requireAdmin, async (req, res) => {
  const filter = String(req.query.status || "open");
  const supplier = String(req.query.supplier || "").trim().toLowerCase();
  let q = supabaseAdmin.from(TABLE).select("*").order("created_at", { ascending: false }).limit(200);
  if (filter === "open") q = q.in("status", OPEN_STATUSES);
  else if (ADMIN_STATUSES.includes(filter)) q = q.eq("status", filter);
  if (supplier) q = q.eq("supplier_name", supplier);
  const [{ data, error }, sup] = await Promise.all([
    q,
    supplierSummaryRows(),
  ]);
  if (error) {
    if (isMissingSchemaError(error)) return res.json({ items: [], suppliers: [], migrationMissing: true });
    console.error("[supplier-shipments] 목록 조회 실패:", error.message);
    return res.status(500).json({ error: "공급처 배송 목록을 불러오지 못했습니다." });
  }
  // 공급처별 건수(진행 중 많은 순) — 공급처가 늘어도 Works에서 골라 볼 수 있게
  const bySupplier = new Map();
  for (const r of (sup && sup.data) || []) {
    const cur = bySupplier.get(r.supplier_name) || { name: r.supplier_name, label: null, open: 0, total: 0 };
    cur.label = cur.label || r.supplier_label || null;
    cur.total++;
    if (OPEN_STATUSES.includes(r.status)) cur.open++;
    bySupplier.set(r.supplier_name, cur);
  }
  // Works "배송조회" 버튼은 서버가 스마트택배로 조회하는 설정일 때만(기본은 피클 담당)
  const trackingEnabled = tracking.isConfigured() && supplierTrackingProvider() === "sweettracker";
  const usage = trackingEnabled ? await budget.usage(supabaseAdmin).catch(() => null) : null;
  res.json({
    items: (data || []).map(toApi),
    suppliers: [...bySupplier.values()].sort((a, b) => b.open - a.open || b.total - a.total),
    trackingEnabled,
    carriers: carriers.CARRIERS.map((c) => ({ id: c.id, name: c.name })),
    trackingUsage: usage && { month: usage.month, calls: usage.calls, limit: usage.limit, remaining: usage.remaining },
  });
});

/* Works "배송조회" 버튼 — 지금 스마트택배로 1건 조회해 저장하고 단계 기록을 돌려준다(월간 한도 1건 사용). */
router.post("/api/admin/supplier-shipments/:id/track", requireAdmin, notFoundUnlessUuid, async (req, res) => {
  const { data: row, error } = await supabaseAdmin.from(TABLE).select("*").eq("id", req.params.id).maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) return res.status(503).json({ error: MIGRATION_MISSING });
    return res.status(500).json({ error: "송장을 불러오지 못했습니다." });
  }
  if (!row) return res.status(404).json({ error: "해당 송장을 찾을 수 없습니다." });
  const r = await trackShipment(row);
  if (r.error) return res.status(r.budgetExhausted || r.noMigration ? 409 : 400).json({ error: r.error });
  res.json({ ok: true, shipment: toApi(r.row), lookupError: r.lookupError });
});

/* ---------- 사람이 직접 등록·수정·취소 (2026-11-11) ----------
   실시간 에이전트 AI가 놓친 송장을 직접 등록하고, AI가 잘못 적은 값(공급처·택배사·송장번호·품목·상태 등)을 고칠 수 있다.
   상태는 사람이면 어느 쪽으로든 바꿀 수 있다(되돌리기 포함). 단, 재고에 반영된 입고는 "입고 취소"(재고 차감)로만 되돌린다.
   모든 변경은 활동 로그에 바뀌기 전 값과 함께 남는다. */
const EDITABLE = {
  supplierName: "supplier_name", supplierLabel: "supplier_label", supplierOrderId: "supplier_order_id", carrierCode: "carrier_code",
  carrierName: "carrier_name", trackingNumber: "tracking_number", itemsSummary: "items_summary", shippedAt: "shipped_at",
  deliveredAt: "delivered_at", receiptItems: "receipt_items", status: "status",
};

router.post("/api/admin/supplier-shipments", requireAdmin, async (req, res) => {
  const { fields, error: invalid } = normalizeBotShipment(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
  const nowIso = new Date().toISOString();
  const { data: dup } = await findExisting(fields.supplier_name, fields.tracking_number);
  if (dup) return res.status(409).json({ error: "같은 공급처·송장번호가 이미 있습니다. 목록에서 수정해 주세요." });
  const row = { ...buildInsert(fields, nowIso), metadata: { ...(fields.metadata || {}), createdBy: req.user.email }, tracking_source: "manual" };
  const ins = await writeWithOptionalColumns((p) => supabaseAdmin.from(TABLE).insert(p).select().single(), row);
  if (ins.error) {
    if (isMissingSchemaError(ins.error)) return res.status(503).json({ error: MIGRATION_MISSING });
    console.error("[supplier-shipments] 직접 등록 실패:", ins.error.message);
    return res.status(500).json({ error: "등록에 실패했습니다." });
  }
  logAdminAction(req, "supplier_shipment.create", "supplier_shipment", ins.data.id, { supplier: ins.data.supplier_name, tracking: ins.data.tracking_number });
  res.json({ ok: true, shipment: toApi(ins.data) });
});

router.patch("/api/admin/supplier-shipments/:id", requireAdmin, notFoundUnlessUuid, async (req, res) => {
  const b = req.body || {};
  const { data: cur, error: curErr } = await supabaseAdmin.from(TABLE).select("*").eq("id", req.params.id).maybeSingle();
  if (curErr) return res.status(isMissingSchemaError(curErr) ? 503 : 500).json({ error: isMissingSchemaError(curErr) ? MIGRATION_MISSING : "송장을 불러오지 못했습니다." });
  if (!cur) return res.status(404).json({ error: "해당 송장을 찾을 수 없습니다." });

  // 바뀐 칸만 검사 — 기존 값 위에 새 값을 얹어 봇 등록과 같은 규칙으로 다시 정리한다
  const merged = {
    supplierName: cur.supplier_name, supplierLabel: cur.supplier_label, supplierOrderId: cur.supplier_order_id, carrierCode: cur.carrier_code,
    carrierName: cur.carrier_name, trackingNumber: cur.tracking_number, itemsSummary: cur.items_summary, shippedAt: cur.shipped_at, deliveredAt: cur.delivered_at,
  };
  for (const k of Object.keys(EDITABLE)) if (b[k] !== undefined && k !== "status" && k !== "receiptItems") merged[k] = b[k];
  if (b.carrierCode !== undefined && b.carrierName === undefined) merged.carrierName = undefined; // 택배사를 바꾸면 예전 이름은 버린다
  const { fields, error: invalid } = normalizeBotShipment(merged);
  if (invalid) return res.status(400).json({ error: invalid });

  const patch = {};
  for (const col of ["supplier_name", "supplier_label", "supplier_order_id", "carrier_code", "carrier_name", "tracking_number", "items_summary", "shipped_at", "delivered_at"]) {
    const v = fields[col] === undefined ? null : fields[col];
    if (String(v ?? "") !== String(cur[col] ?? "")) patch[col] = v;
  }
  // 빈 칸으로 지운 값(선택 항목)은 null로
  if (b.supplierLabel === "") patch.supplier_label = null;
  if (b.supplierOrderId === "") patch.supplier_order_id = null;
  if (b.itemsSummary === "") patch.items_summary = null;

  if (b.receiptItems !== undefined) {
    if (cur.received_at) return res.status(409).json({ error: "이미 입고 처리된 송장의 품목은 바꿀 수 없습니다. 입고 취소 후 다시 처리해 주세요." });
    const r = parseReceiptItems(b.receiptItems, { requireProduct: false });
    if (r.error) return res.status(400).json({ error: r.error });
    patch.receipt_items = r.items.length ? r.items : null;
  }

  if (b.status !== undefined) {
    const status = String(b.status).toUpperCase();
    if (!ADMIN_STATUSES.includes(status)) return res.status(400).json({ error: "상태 값이 올바르지 않습니다." });
    const applied = cur.metadata && Array.isArray(cur.metadata.inventoryApplied) && cur.metadata.inventoryApplied.length;
    if (cur.status === "RECEIVED" && status !== "RECEIVED" && applied) {
      return res.status(409).json({ error: "재고에 반영된 입고입니다. \"입고 취소\"로 되돌려 주세요(재고도 함께 빠집니다)." });
    }
    if (status !== cur.status) {
      patch.status = status;
      if ((status === "DELIVERED" || status === "RECEIVED") && !cur.delivered_at && patch.delivered_at === undefined) patch.delivered_at = new Date().toISOString();
      if (status === "RECEIVED" && !cur.received_at) patch.received_at = new Date().toISOString();
      if (cur.status === "RECEIVED" && status !== "RECEIVED") patch.received_at = null;
    }
  }
  if (!Object.keys(patch).length) return res.json({ ok: true, unchanged: true, shipment: toApi(cur) });

  if (patch.supplier_name || patch.tracking_number) {
    const { data: dup } = await findExisting(patch.supplier_name || cur.supplier_name, patch.tracking_number || cur.tracking_number);
    if (dup && dup.id !== cur.id) return res.status(409).json({ error: "같은 공급처·송장번호가 이미 있습니다." });
  }
  const editedCols = Object.keys(patch).filter((k) => k !== "status" && k !== "received_at");
  if (editedCols.length) patch.metadata = { ...(cur.metadata || {}), humanEdited: [...new Set([...((cur.metadata && cur.metadata.humanEdited) || []), ...editedCols])] };
  patch.updated_at = new Date().toISOString();
  const upd = await writeWithOptionalColumns((p) => supabaseAdmin.from(TABLE).update(p).eq("id", cur.id).select().maybeSingle(), patch);
  if (upd.error || !upd.data) {
    console.error("[supplier-shipments] 수정 실패:", upd.error && upd.error.message);
    return res.status(500).json({ error: "저장에 실패했습니다." });
  }
  const before = Object.fromEntries(Object.keys(patch).filter((k) => k !== "updated_at" && k !== "metadata").map((k) => [k, cur[k] ?? null]));
  const after = Object.fromEntries(Object.keys(patch).filter((k) => k !== "updated_at" && k !== "metadata").map((k) => [k, patch[k]]));
  logAdminAction(req, patch.status && Object.keys(after).length === 1 ? "supplier_shipment.status" : "supplier_shipment.update", "supplier_shipment", cur.id, { tracking: upd.data.tracking_number, before, after });
  res.json({ ok: true, shipment: toApi(upd.data) });
});

/* ---------- 피클 배송조회(2026-11-10, 비용 0원 방식) ----------
   ① GET  /api/bot/supplier-shipments/pending — 지금 조회해야 할 공급처 송장(출고·배송중, 출고 21일 이내, 마지막 조회가 12시간 이상 전).
      피클은 각 줄의 trackingUrl(택배사 공식 조회 화면)을 열어 상태를 읽는다. 받는 사람 이름 등 개인정보는 주지 않는다.
   ② POST /api/bot/supplier-shipments/:id/tracking — 피클이 읽은 결과 { delivered, statusText, events[], deliveredAt? } 또는 { error }.
      상태는 앞으로만(출고→배송중→배송완료), 입고 완료·취소는 건드리지 못한다. */
router.get("/api/bot/supplier-shipments/pending", botLimiter, requireBotKey, async (req, res) => {
  const now = new Date();
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
  const base = () =>
    supabaseAdmin
      .from(TABLE)
      .select("*")
      .in("status", ["SHIPPED", "IN_TRANSIT"])
      .gte("shipped_at", new Date(now.getTime() - 21 * 86400000).toISOString())
      .order("shipped_at", { ascending: true })
      .limit(200);
  const { data, error } = await base();
  if (error) {
    if (isMissingSchemaError(error)) return res.status(503).json({ ok: false, error: MIGRATION_MISSING });
    console.error("[bot] 조회 대기 송장 목록 실패:", error.message);
    return res.status(500).json({ ok: false, error: "목록을 불러오지 못했습니다" });
  }
  const recheckBefore = now.getTime() - recheckHours() * 3600 * 1000;
  const items = (data || [])
    .filter((r) => !r.tracking_checked_at || new Date(r.tracking_checked_at).getTime() <= recheckBefore)
    .slice(0, limit)
    .map((r) => {
      const a = toApi(r);
      return {
        id: a.id, supplierName: a.supplierName, supplierLabel: a.supplierLabel, carrierCode: a.carrierCode, carrierName: a.carrierName,
        trackingNumber: a.trackingNumber, trackingUrl: a.trackingUrl, status: a.status, shippedAt: a.shippedAt,
        lastCheckedAt: a.trackingCheckedAt, lastStatusText: a.trackingStatus,
      };
    });
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, recheckHours: recheckHours(), items });
});

/* 피클 조회 결과 검사 — 순수 함수(테스트용). { result } 또는 { error } */
function normalizePickleTracking(body) {
  const b = body && typeof body === "object" ? body : {};
  if (b.error) return { result: { error: cleanText(b.error, 200) || "조회 실패" } };
  if (typeof b.delivered !== "boolean") return { error: "delivered(true/false) 또는 error가 필요합니다" };
  if (b.events !== undefined && (!Array.isArray(b.events) || b.events.length > 30)) return { error: "events는 30개 이하의 배열이어야 합니다" };
  const events = (b.events || []).map((e) => ({ at: cleanText(e && e.at, 30) || "", where: cleanText(e && e.where, 60) || "", kind: cleanText(e && e.kind, 60) || "" })).filter((e) => e.at || e.kind);
  const deliveredAt = parseDate(b.deliveredAt);
  if (deliveredAt.error) return { error: "deliveredAt 날짜 형식이 올바르지 않습니다(ISO 8601)" };
  return { result: { delivered: b.delivered, statusText: cleanText(b.statusText, 60) || (b.delivered ? "배송완료" : ""), events, deliveredAt: deliveredAt.value } };
}

router.post("/api/bot/supplier-shipments/:id/tracking", botWriteLimiter, requireBotKey, notFoundUnlessUuid, async (req, res) => {
  const { result, error: invalid } = normalizePickleTracking(req.body);
  if (invalid) return res.status(400).json({ ok: false, error: invalid });
  const { data: row, error } = await supabaseAdmin.from(TABLE).select("*").eq("id", req.params.id).maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) return res.status(503).json({ ok: false, error: MIGRATION_MISSING });
    return res.status(500).json({ ok: false, error: "송장을 불러오지 못했습니다" });
  }
  if (!row) return res.status(404).json({ ok: false, error: "해당 송장을 찾을 수 없습니다." });
  const now = new Date();
  const patch = { ...patchFromResult(row, result, now), tracking_source: "pickle" };
  if (patch.status === "DELIVERED" && result.deliveredAt && !row.delivered_at) patch.delivered_at = result.deliveredAt;
  const upd = await writeWithOptionalColumns((p) => supabaseAdmin.from(TABLE).update(p).eq("id", row.id).select().maybeSingle(), patch);
  if (upd.error || !upd.data) {
    console.error("[bot] 배송조회 결과 저장 실패:", upd.error && upd.error.message);
    return res.status(500).json({ ok: false, error: "저장 실패" });
  }
  res.json({ ok: true, shipment: toApi(upd.data) });
});

/* 같은 상품·색상·사이즈는 합친다 */
function mergeReceiptItems(items) {
  const merged = new Map();
  for (const it of items) {
    const k = `${it.productId}:${it.color}:${it.size}`;
    merged.set(k, { productId: it.productId, color: it.color, size: it.size, qty: (merged.get(k) ? merged.get(k).qty : 0) + it.qty });
  }
  return [...merged.values()];
}

/* ---------- 입고 처리 → 재고 반영(2026-11-10) ----------
   Works "입고 완료" 창에서 품목(피클이 메일에서 미리 채운 초안을 사람이 확인·수정)을 확정하면 재고에 더하고 입고 완료로 바꾼다.
   먼저 상태를 RECEIVED로 "선점"한 뒤 재고를 더해서, 두 번 눌러도 재고가 두 번 더해지지 않는다. 재고 증가가 실패하면 상태를 되돌린다.
   재고가 0 → 양수로 바뀐 조합은 품절 알림 신청자에게 메일(routes/inventory.js와 같은 함수). */
router.post("/api/admin/supplier-shipments/:id/receive", requireAdmin, notFoundUnlessUuid, async (req, res) => {
  const parsed = parseReceiptItems((req.body || {}).items || [], { requireProduct: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const items = parsed.items;

  // 상품·색상·사이즈가 실제 상품 설정과 맞는지
  if (items.length) {
    const ids = [...new Set(items.map((it) => it.productId))];
    const { data: products, error: pErr } = await supabaseAdmin.from("products").select("id, colors, sizes").in("id", ids);
    if (pErr) return res.status(500).json({ error: "상품 정보를 불러오지 못했습니다." });
    const byId = new Map((products || []).map((p) => [p.id, p]));
    for (const it of items) {
      const p = byId.get(it.productId);
      if (!p || !(p.colors || []).includes(it.color) || !(p.sizes || []).includes(it.size)) {
        return res.status(400).json({ error: `상품·색상·사이즈 조합이 올바르지 않습니다: ${it.productId} ${it.color} ${it.size}` });
      }
    }
  }

  const nowIso = new Date().toISOString();
  const { data: cur, error: curErr } = await supabaseAdmin.from(TABLE).select("*").eq("id", req.params.id).maybeSingle();
  if (curErr) return res.status(isMissingSchemaError(curErr) ? 503 : 500).json({ error: isMissingSchemaError(curErr) ? MIGRATION_MISSING : "송장을 불러오지 못했습니다." });
  if (!cur) return res.status(404).json({ error: "해당 송장을 찾을 수 없습니다." });
  if (cur.status === "RECEIVED" || cur.status === "CANCELED") return res.status(409).json({ error: "이미 입고 완료(또는 취소)된 송장입니다." });

  const claim = await writeWithOptionalColumns(
    (p) => supabaseAdmin.from(TABLE).update(p).eq("id", cur.id).eq("status", cur.status).select().maybeSingle(),
    {
      status: "RECEIVED", received_at: nowIso, delivered_at: cur.delivered_at || nowIso, receipt_items: items.length ? items : cur.receipt_items || null, updated_at: nowIso,
      // 재고에 더한 품목을 남겨 두어 "입고 취소" 때 정확히 그만큼 뺀다(2026-11-11)
      metadata: {
        ...(cur.metadata || {}),
        inventoryApplied: mergeReceiptItems(items),
        receiptHistory: [...((cur.metadata && cur.metadata.receiptHistory) || []), { action: "receive", at: nowIso, by: req.user.email, items: mergeReceiptItems(items) }].slice(-20),
      },
    }
  );
  if (claim.error) return res.status(500).json({ error: "입고 처리에 실패했습니다." });
  if (!claim.data) return res.status(409).json({ error: "다른 화면에서 먼저 처리됐습니다. 새로고침해 주세요." });

  if (items.length) {
    const adds = mergeReceiptItems(items);
    const { data: prevRows } = await supabaseAdmin.from("inventory").select("product_id, color, size, qty").in("product_id", [...new Set(adds.map((a) => a.productId))]);
    const prevQty = new Map((prevRows || []).map((r) => [`${r.product_id}:${r.color}:${r.size}`, r.qty]));
    const { error: invErr } = await supabaseAdmin.rpc("restore_inventory", { p_items: adds });
    if (invErr) {
      await supabaseAdmin.from(TABLE).update({ status: cur.status, received_at: null, updated_at: new Date().toISOString() }).eq("id", cur.id);
      logSystemError("supplier_receipt_failed", { shipmentId: cur.id, error: invErr.message });
      return res.status(500).json({ error: "재고 반영에 실패해 입고 처리를 취소했습니다. 다시 시도해 주세요." });
    }
    logInventoryChange(adds.map((a) => ({ productId: a.productId, color: a.color, size: a.size, delta: a.qty, reason: "supplier_receipt", ref: `${cur.supplier_name}:${cur.tracking_number}`, adminEmail: req.user.email })));
    const restocked = adds.filter((a) => (prevQty.get(`${a.productId}:${a.color}:${a.size}`) || 0) <= 0);
    if (restocked.length) notifyRestockSubscribers(restocked).catch((err) => console.error("[restock] 알림 처리 실패:", err.message));
  }

  logAdminAction(req, "supplier_shipment.receive", "supplier_shipment", cur.id, { tracking: cur.tracking_number, items: items.length, qty: items.reduce((n, it) => n + it.qty, 0) });
  res.json({ ok: true, shipment: toApi(claim.data), addedToInventory: items.length });
});

/* ---------- 입고 취소 (2026-11-11) ----------
   잘못 누른 입고 처리를 되돌린다: 그때 더한 재고(metadata.inventoryApplied)를 빼고, 상태를 배송완료로 돌린다.
   이미 팔려서 재고가 그만큼 없으면 되돌리지 않고 알려준다(재고가 음수가 되지 않게). 재고 이력 사유 supplier_receipt_undo(051). */
router.post("/api/admin/supplier-shipments/:id/receive/undo", requireAdmin, notFoundUnlessUuid, async (req, res) => {
  const { data: cur, error } = await supabaseAdmin.from(TABLE).select("*").eq("id", req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: "송장을 불러오지 못했습니다." });
  if (!cur) return res.status(404).json({ error: "해당 송장을 찾을 수 없습니다." });
  if (cur.status !== "RECEIVED") return res.status(409).json({ error: "입고 완료 상태가 아닙니다." });
  const applied = (cur.metadata && Array.isArray(cur.metadata.inventoryApplied) && cur.metadata.inventoryApplied) || [];

  if (applied.length) {
    const { data: invRows } = await supabaseAdmin.from("inventory").select("product_id, color, size, qty").in("product_id", [...new Set(applied.map((a) => a.productId))]);
    const qty = new Map((invRows || []).map((r) => [`${r.product_id}:${r.color}:${r.size}`, r.qty]));
    const short = applied.filter((a) => (qty.get(`${a.productId}:${a.color}:${a.size}`) || 0) < a.qty);
    if (short.length) {
      return res.status(409).json({ error: `이미 판매돼 재고가 부족해 되돌릴 수 없습니다: ${short.map((a) => `${a.productId} ${a.color} ${a.size}`).join(", ")} — 재고 탭에서 직접 수정해 주세요.` });
    }
  }

  // 먼저 상태를 되돌려 선점(두 번 눌러도 한 번만 빠지게)
  const nowIso = new Date().toISOString();
  const history = [...((cur.metadata && cur.metadata.receiptHistory) || []), { action: "undo", at: nowIso, by: req.user.email, items: applied }].slice(-20);
  const { inventoryApplied: _drop, ...restMeta } = cur.metadata || {};
  const claim = await writeWithOptionalColumns(
    (p) => supabaseAdmin.from(TABLE).update(p).eq("id", cur.id).eq("status", "RECEIVED").select().maybeSingle(),
    { status: "DELIVERED", received_at: null, metadata: { ...restMeta, receiptHistory: history }, updated_at: nowIso }
  );
  if (claim.error) return res.status(500).json({ error: "입고 취소에 실패했습니다." });
  if (!claim.data) return res.status(409).json({ error: "다른 화면에서 먼저 처리됐습니다. 새로고침해 주세요." });

  if (applied.length) {
    const { error: invErr } = await supabaseAdmin.rpc("restore_inventory", { p_items: applied.map((a) => ({ ...a, qty: -a.qty })) });
    if (invErr) {
      await supabaseAdmin.from(TABLE).update({ status: "RECEIVED", received_at: cur.received_at, metadata: cur.metadata, updated_at: new Date().toISOString() }).eq("id", cur.id);
      logSystemError("supplier_receipt_failed", { shipmentId: cur.id, undo: true, error: invErr.message });
      return res.status(500).json({ error: "재고 차감에 실패해 입고 취소를 되돌렸습니다. 다시 시도해 주세요." });
    }
    logInventoryChange(applied.map((a) => ({ productId: a.productId, color: a.color, size: a.size, delta: -a.qty, reason: "supplier_receipt_undo", ref: `${cur.supplier_name}:${cur.tracking_number}`, adminEmail: req.user.email })));
  }
  logAdminAction(req, "supplier_shipment.receive_undo", "supplier_shipment", cur.id, { tracking: cur.tracking_number, items: applied });
  res.json({ ok: true, shipment: toApi(claim.data), removedFromInventory: applied.length });
});

module.exports = router;
module.exports.normalizeBotShipment = normalizeBotShipment;
module.exports.buildUpdate = buildUpdate;
module.exports.buildInsert = buildInsert;
module.exports.parseReceiptItems = parseReceiptItems;
module.exports.normalizePickleTracking = normalizePickleTracking;
