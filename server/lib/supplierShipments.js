/* ---------- 공급처 송장 공용 로직 (2026-11-10, 마이그레이션 048·049) ----------
   routes/supplierShipments.js(피클 기록·Works 목록·배송조회 버튼)와 매시 크론(lib/scheduledJobs.js)이 함께 쓴다.
   배송조회는 스마트택배 키(SWEETTRACKER_API_KEY)가 있을 때만, 월간 한도(lib/trackingBudget.js) 안에서 한다. */
const { supabaseAdmin } = require("./supabase");
const tracking = require("./tracking");
const carriers = require("./carriers");
const { isMissingSchemaError, isMissingColumnError, extractMissingColumnName } = require("./pgErrors");

/* 나중 마이그레이션(049·050)에서 생긴 칸 — 아직 실행 전이면 그 칸만 빼고 다시 쓴다. */
const OPTIONAL_COLUMNS = ["supplier_label", "tracking_checked_at", "tracking_status", "tracking_events", "tracking_error", "receipt_items", "received_at", "tracking_source"];

/* run(payload) → Supabase 결과. 없는 칸 오류면 그 칸(이름을 모르면 선택 칸 하나)을 빼고 재시도. */
async function writeWithOptionalColumns(run, payload) {
  let current = { ...payload };
  let result = await run(current);
  for (let i = 0; i < OPTIONAL_COLUMNS.length && result.error && isMissingColumnError(result.error); i++) {
    const named = extractMissingColumnName(result.error);
    const col = named && named in current ? named : OPTIONAL_COLUMNS.find((c) => c in current);
    if (!col) break;
    const { [col]: _omit, ...rest } = current;
    current = rest;
    result = await run(current);
  }
  return result;
}

const TABLE = "supplier_shipments";
/* 상태 순서 — 봇·자동 조회는 앞으로만 간다. RECEIVED(입고 완료)·CANCELED(취소)는 관리자가 Works에서만 정한다. */
const STATUS_RANK = { SHIPPED: 1, IN_TRANSIT: 2, DELIVERED: 3, RECEIVED: 4 };
const OPEN_STATUSES = ["SHIPPED", "IN_TRANSIT", "DELIVERED"];
const HOUR = 3600 * 1000;

/* 공급처 송장 배송조회 담당 — 기본은 피클(공식 조회 페이지를 보고 POST /api/bot/supplier-shipments/:id/tracking으로 보냄, 비용 0원).
   Render SUPPLIER_TRACKING_PROVIDER=sweettracker로 바꾸면 서버가 스마트택배로 직접 조회한다(월간 한도를 고객 주문과 나눠 씀). (2026-11-10 사용자 결정) */
function supplierTrackingProvider(env = process.env) {
  return String(env.SUPPLIER_TRACKING_PROVIDER || "pickle").toLowerCase() === "sweettracker" ? "sweettracker" : "pickle";
}

/* 자동 조회 간격 — 무료 플랜(월 100건)을 고객 주문과 나눠 쓰므로 기본은 넉넉히 12시간. 유료면 Render SUPPLIER_TRACKING_RECHECK_HOURS로 줄인다. */
function recheckHours(env = process.env) {
  const n = Number(env.SUPPLIER_TRACKING_RECHECK_HOURS);
  return Number.isFinite(n) && n >= 1 ? n : 12;
}

function toApi(r) {
  return {
    id: r.id,
    supplierName: r.supplier_name,
    supplierLabel: r.supplier_label || null,
    supplierOrderId: r.supplier_order_id || null,
    carrierCode: r.carrier_code,
    carrierName: r.carrier_name || (carriers.findCarrier(r.carrier_code) || {}).name || null,
    trackingNumber: r.tracking_number,
    trackingUrl: carriers.trackingUrl(r.carrier_code, r.carrier_name, r.tracking_number),
    itemsSummary: r.items_summary || null,
    recipientName: r.recipient_name || null,
    status: r.status,
    shippedAt: r.shipped_at || null,
    deliveredAt: r.delivered_at || null,
    trackingCheckedAt: r.tracking_checked_at || null,
    trackingStatus: r.tracking_status || null,
    trackingEvents: Array.isArray(r.tracking_events) ? r.tracking_events : [],
    trackingError: r.tracking_error || null,
    receiptItems: Array.isArray(r.receipt_items) ? r.receipt_items : [],
    receivedAt: r.received_at || null,
    // 입고 처리 때 재고에 더한 품목(있으면 "입고 취소"로 재고까지 되돌릴 수 있다)
    inventoryApplied: (r.metadata && Array.isArray(r.metadata.inventoryApplied) && r.metadata.inventoryApplied) || [],
    createdBy: (r.metadata && r.metadata.createdBy) || null,
    trackingSource: r.tracking_source || null,
    metadata: r.metadata || {},
    createdAt: r.created_at || null,
    updatedAt: r.updated_at || null,
  };
}

/* 조회 결과 → 저장할 칸. 순수 함수(테스트용). */
function patchFromResult(row, r, now) {
  const nowIso = now.toISOString();
  if (r.error) return { tracking_checked_at: nowIso, tracking_error: String(r.error).slice(0, 200) };
  const patch = { tracking_checked_at: nowIso, tracking_error: null, tracking_status: r.statusText || null, tracking_events: r.events || [], updated_at: nowIso };
  const cur = STATUS_RANK[row.status] || 0;
  if (row.status !== "CANCELED") {
    if (r.delivered && cur < STATUS_RANK.DELIVERED) {
      patch.status = "DELIVERED";
      if (!row.delivered_at) patch.delivered_at = nowIso;
    } else if (!r.delivered && (r.events || []).length && cur < STATUS_RANK.IN_TRANSIT) {
      patch.status = "IN_TRANSIT";
    }
  }
  return patch;
}

/* 송장 1건 조회 후 저장. { row } 또는 { error, budgetExhausted?, noMigration? } */
async function trackShipment(row, { db = supabaseAdmin, now = new Date(), fetchImpl } = {}) {
  if (!tracking.isConfigured()) return { error: "스마트택배 키(SWEETTRACKER_API_KEY)가 설정되지 않았습니다" };
  const code = await tracking.resolveSweetCode(row.carrier_code, row.carrier_name, { db, now, fetchImpl });
  const r = code
    ? await tracking.trackWithBudget({ code, invoice: row.tracking_number, db, now, fetchImpl })
    : { error: "스마트택배에서 지원하는 택배사를 찾지 못했습니다" };
  if (r.budgetExhausted) return { error: r.error, budgetExhausted: true };
  const patch = { ...patchFromResult(row, r, now), tracking_source: "sweettracker" };
  const { data, error } = await writeWithOptionalColumns((p) => db.from(TABLE).update(p).eq("id", row.id).select().maybeSingle(), patch);
  if (error) {
    if (isMissingColumnError(error) || isMissingSchemaError(error)) return { error: "배송조회 결과 칸이 없습니다(마이그레이션 049 미실행)", noMigration: true };
    return { error: error.message };
  }
  return { row: data, lookupError: r.error || null };
}

/* [크론] 진행 중인 공급처 송장 자동 조회 — 출고 6시간 뒤부터, 같은 송장은 recheckHours마다, 출고 21일이 지나면 그만. 회차당 최대 10건. */
async function checkSupplierShipments({ db = supabaseAdmin, now = new Date(), fetchImpl } = {}) {
  if (supplierTrackingProvider() !== "sweettracker") return { checked: 0, delivered: 0, skipped: "pickle" };
  if (!tracking.isConfigured()) return { checked: 0, delivered: 0, skipped: "no_key" };
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .in("status", ["SHIPPED", "IN_TRANSIT"])
    .lte("shipped_at", new Date(now.getTime() - 6 * HOUR).toISOString())
    .gte("shipped_at", new Date(now.getTime() - 21 * 24 * HOUR).toISOString())
    .order("tracking_checked_at", { ascending: true, nullsFirst: true })
    .limit(30);
  if (error) return { checked: 0, delivered: 0, skipped: isMissingColumnError(error) || isMissingSchemaError(error) ? "no_migration" : error.message };
  const recheckBefore = now.getTime() - recheckHours() * HOUR;
  let checked = 0;
  let delivered = 0;
  for (const row of data || []) {
    if (checked >= 10) break;
    if (row.tracking_checked_at && new Date(row.tracking_checked_at).getTime() > recheckBefore) continue;
    const r = await trackShipment(row, { db, now, fetchImpl });
    if (r.budgetExhausted || r.noMigration) break;
    checked++;
    if (r.row && r.row.status === "DELIVERED" && row.status !== "DELIVERED") delivered++;
  }
  return { checked, delivered };
}

module.exports = { writeWithOptionalColumns, OPTIONAL_COLUMNS, TABLE, STATUS_RANK, OPEN_STATUSES, toApi, patchFromResult, trackShipment, checkSupplierShipments, recheckHours, supplierTrackingProvider };
