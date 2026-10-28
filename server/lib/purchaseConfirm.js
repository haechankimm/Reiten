/* ---------- 배송완료 자동 처리 + 구매확정 + 적립금 지급 시점 (2026-10-02) ----------
   흐름: 출고(운송장 입력) → [배송조회 크론] 배송완료 확인 시 주문 "완료" + delivered_at → 배송완료 7일 뒤
   [구매확정 크론] 자동 구매확정(confirmed_at) → 그때 적립금 지급. 고객이 주문조회·내 주문에서 먼저
   "구매확정"을 누를 수도 있다. 배송조회 키가 없어 delivered_at이 비어 있으면 출고 14일 뒤 자동 구매확정.
   반품·교환 신청이 처리 중인 주문은 자동 구매확정하지 않는다.

   적립금을 결제 확인 즉시가 아니라 구매확정 때 주는 이유: 결제 직후 적립 → 그 포인트를 다른 주문에 사용 →
   첫 주문은 반품하는 식의 악용을 막고, 반품·부분 취소 때 회수할 포인트 자체가 아직 없게 하기 위해서다.
   마이그레이션 043(confirmed_at 컬럼)이 없으면 이 기능 전체가 꺼지고 예전처럼 결제 확인 즉시 적립한다. */
const { supabaseAdmin } = require("./supabase");
const { creditPoints } = require("./loyaltyPoints");
const tracking = require("./tracking");

const DAY_MS = 86400000;
const CONFIRM_AFTER_DELIVERY_DAYS = 7;
const CONFIRM_AFTER_SHIP_DAYS = 14;
const TRACKING_RECHECK_HOURS = 3;
const TRACKING_MIN_AGE_HOURS = 12;

let capability = null; // { value, at }

/* confirmed_at 컬럼이 있는지(043 실행 여부) — 10분 캐시. 적립 시점(즉시/구매확정)을 이 값으로 정한다. */
async function confirmationEnabled(db = supabaseAdmin) {
  if (capability && Date.now() - capability.at < 10 * 60 * 1000) return capability.value;
  const { error } = await db.from("orders").select("confirmed_at").limit(1);
  capability = { value: !error, at: Date.now() };
  return capability.value;
}

function _resetCapability(value) {
  capability = value === undefined ? null : { value, at: Date.now() };
}

/* 자동 구매확정 예정 시각(순수 함수) — 배송완료 기준 7일, 배송완료 기록이 없으면 출고 기준 14일. */
function autoConfirmAt(order) {
  if (order.delivered_at) return new Date(new Date(order.delivered_at).getTime() + CONFIRM_AFTER_DELIVERY_DAYS * DAY_MS);
  if (order.shipped_at) return new Date(new Date(order.shipped_at).getTime() + CONFIRM_AFTER_SHIP_DAYS * DAY_MS);
  return null;
}

/* 고객이 직접 구매확정할 수 있는 상태인지(순수 함수) */
function canConfirm(order) {
  return !!order && (order.status === "배송중" || order.status === "완료") && !order.confirmed_at;
}

async function hasOpenReturnRequest(db, orderNo) {
  const { data } = await db.from("return_requests").select("id, status, request_type").eq("order_no", orderNo);
  return (data || []).some((r) => (r.request_type || "return") !== "cancel" && r.status !== "완료" && r.status !== "반려");
}

/* 구매확정 — confirmed_at이 비어 있을 때만 갱신(조건부)이라 고객 버튼·크론이 겹쳐도 적립은 한 번뿐이다
   (award_points 자체도 주문당 한 번만 들어가는 유니크 인덱스가 있음). */
async function confirmOrder(order, { db = supabaseAdmin, now = new Date() } = {}) {
  const at = now.toISOString();
  const { data, error } = await db
    .from("orders")
    .update({ confirmed_at: at })
    .eq("order_no", order.order_no)
    .is("confirmed_at", null)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, already: true };
  let pointsCredited = 0;
  const earned = Number(data.points_earned) || 0;
  if (data.user_id && earned > 0) {
    await creditPoints(db, data.user_id, earned, data.order_no);
    pointsCredited = earned;
  }
  return { ok: true, confirmedAt: at, pointsCredited };
}

/* [크론] 배송중 주문의 배송조회 — 키가 없거나 043 전이면 아무것도 안 한다. 한 번에 최대 40건. */
async function checkDeliveries({ db = supabaseAdmin, now = new Date(), fetchImpl } = {}) {
  if (!tracking.isConfigured()) return { checked: 0, delivered: 0, skipped: "no_key" };
  if (!(await confirmationEnabled(db))) return { checked: 0, delivered: 0, skipped: "no_migration" };
  const minShipped = new Date(now.getTime() - TRACKING_MIN_AGE_HOURS * 3600 * 1000).toISOString();
  /* 오래 확인 안 한 것부터(한 번도 안 본 것 먼저) 최근 30일 출고분만 — 순서 없이 80건을 잘라 오면 배송완료가 영영
     안 잡히는 주문(운송장 오타·분실)이 자리를 차지해 새 출고분을 못 보는 일이 생겼다(2026-10-28 정기 감사). */
  const maxAge = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const { data: orders, error } = await db
    .from("orders")
    .select("order_no, status, courier, tracking_no, shipped_at, tracking_checked_at")
    .eq("status", "배송중")
    .is("delivered_at", null)
    .is("confirmed_at", null)
    .not("tracking_no", "is", null)
    .lte("shipped_at", minShipped)
    .gte("shipped_at", maxAge)
    .order("tracking_checked_at", { ascending: true, nullsFirst: true })
    .limit(80);
  if (error || !orders) return { checked: 0, delivered: 0, error: error && error.message };

  const recheckBefore = now.getTime() - TRACKING_RECHECK_HOURS * 3600 * 1000;
  let checked = 0;
  let delivered = 0;
  for (const o of orders) {
    if (checked >= 40) break;
    if (!o.tracking_no || !tracking.COURIER_CODES[o.courier]) continue;
    if (o.tracking_checked_at && new Date(o.tracking_checked_at).getTime() > recheckBefore) continue;
    checked++;
    const r = await tracking.fetchTracking(o.courier, o.tracking_no, fetchImpl ? { fetchImpl } : undefined);
    const patch = { tracking_checked_at: now.toISOString() };
    if (!r.error) patch.tracking_status = r.statusText || null;
    if (r.delivered) {
      patch.status = "완료";
      patch.delivered_at = now.toISOString();
      delivered++;
    }
    await db.from("orders").update(patch).eq("order_no", o.order_no).eq("status", "배송중");
  }
  return { checked, delivered };
}

/* [크론] 자동 구매확정 — 배송완료 7일(또는 출고 14일) 지난 주문 중 반품·교환 처리 중이 아닌 것. */
async function autoConfirmOrders({ db = supabaseAdmin, now = new Date() } = {}) {
  if (!(await confirmationEnabled(db))) return { confirmed: 0, skipped: "no_migration" };
  /* 기한이 지난 것만 DB에서 바로 골라 온다(배송완료 7일 / 배송완료 기록 없으면 출고 14일). 예전엔 조건 없이 200건을
     잘라 와서 JS로 걸렀는데, 출고·배송완료 기록이 없는 옛 주문(041·043 이전)이 200건을 넘게 쌓이면 새 주문이 영영
     자동 구매확정되지 않고 적립금도 안 들어갔다(2026-10-28 정기 감사). */
  const deliveredDue = new Date(now.getTime() - CONFIRM_AFTER_DELIVERY_DAYS * DAY_MS).toISOString();
  const shippedDue = new Date(now.getTime() - CONFIRM_AFTER_SHIP_DAYS * DAY_MS).toISOString();
  const cols = "order_no, status, user_id, points_earned, shipped_at, delivered_at, confirmed_at";
  const [a, b] = await Promise.all([
    db.from("orders").select(cols).in("status", ["배송중", "완료"]).is("confirmed_at", null)
      .lte("delivered_at", deliveredDue).order("delivered_at", { ascending: true }).limit(200),
    db.from("orders").select(cols).in("status", ["배송중", "완료"]).is("confirmed_at", null)
      .is("delivered_at", null).lte("shipped_at", shippedDue).order("shipped_at", { ascending: true }).limit(200),
  ]);
  const error = a.error || b.error;
  const orders = [...(a.data || []), ...(b.data || [])];
  if (error) return { confirmed: 0, error: error.message };
  let confirmed = 0;
  for (const o of orders) {
    const due = autoConfirmAt(o);
    if (!due || due > now) continue;
    if (await hasOpenReturnRequest(db, o.order_no)) continue;
    const r = await confirmOrder(o, { db, now });
    if (r.ok) confirmed++;
  }
  return { confirmed };
}

module.exports = {
  CONFIRM_AFTER_DELIVERY_DAYS, CONFIRM_AFTER_SHIP_DAYS,
  confirmationEnabled, _resetCapability, autoConfirmAt, canConfirm, confirmOrder, checkDeliveries, autoConfirmOrders, hasOpenReturnRequest,
};
