/* 적립금(포인트) — 034_loyalty_points.sql. 잔액은 저장하지 않고 loyalty_points_ledger를
   SUM해서 매번 계산한다(파일 상단 마이그레이션 주석 참고). 회원(로그인한 user_id가 있는 주문)
   에게만 적용되고, 비회원 주문은 조용히 0으로 취급한다 — coupons.js와 같은 "선택적 기능,
   미실행/미로그인 시 조용히 저하" 원칙. */
const { isMissingSchemaError } = require("./pgErrors");

/* 적립률은 새 설정 테이블 없이 기존 admin_settings(Works "정보" 탭, 첫 구매/재구매 감사쿠폰과
   같은 자리)를 재사용한다 — lib/thanksCoupons.js와 같은 이유(라벨 이름은 routes/settings.js가
   보호, 값만 자유롭게 수정). */
const LOYALTY_POINTS_RATE_SETTING_LABEL = "적립금 적립률(%)";
const LOYALTY_POINTS_DEFAULT_PERCENT = 1;

function calcEarnedPoints(total, percent) {
  const amount = Math.floor((Number(total) * Number(percent)) / 100);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

async function getPointsBalance(db, userId) {
  if (!userId) return 0;
  const { data, error } = await db.from("loyalty_points_ledger").select("delta").eq("user_id", userId);
  if (error) {
    if (!isMissingSchemaError(error)) console.error("[points] 잔액 조회 실패:", error.message);
    return 0;
  }
  return (data || []).reduce((s, r) => s + r.delta, 0);
}

/* 클라이언트가 보낸 pointsToUse는 신뢰하지 않는다(priceItem의 unit/sum과 같은 원칙) —
   ①정수 ②0 이상 ③현재 잔액 이하 ④상품 합계(subtotal) 이하로 다시 계산한다. 배송비까지
   포인트로 낼 수는 없게 subtotal을 상한으로 둔다(쿠폰 discount와 같은 자리에서 적용됨). */
async function resolvePointsToUse(db, userId, rawPoints, subtotal) {
  if (!userId) return 0;
  const requested = Math.floor(Number(rawPoints));
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  const balance = await getPointsBalance(db, userId);
  return Math.max(0, Math.min(requested, balance, subtotal));
}

/* 실제 차감 — 034_loyalty_points.sql의 redeem_points()가 advisory lock으로 동시 주문 간
   경쟁 상태를 막는다(claimCouponUsage와 같은 이유). 마이그레이션 미실행이면 조용히 통과시킨다
   (이 경우 resolvePointsToUse가 애초에 0을 반환해 pointsToUse 자체가 0이었을 것이므로 실질적
   영향 없음 — 함수 없음 오류가 나는 건 이론상만 대비). */
async function claimPointsUsage(db, userId, amount, orderNo) {
  if (!userId || !amount) return true;
  const { data, error } = await db.rpc("redeem_points", { p_user_id: userId, p_amount: amount, p_order_no: orderNo });
  if (error) {
    if (isMissingSchemaError(error)) return true;
    console.error("[points] 사용 처리 실패:", error.message);
    return true; // fail-open — claimCouponUsage와 같은 원칙(카드결제는 이미 결제된 뒤일 수 있음)
  }
  const row = Array.isArray(data) ? data[0] : data;
  return !!(row && row.ok);
}

/* 몇 포인트를 적립할지만 미리 계산한다(주문 저장 전에 orders.points_earned에 같이 넣어두려는
   호출부(finalizeCardOrder)를 위해 실제 적립(creditPoints)과 분리했다 — 설정값 조회를
   두 번 하지 않도록). 비회원(userId 없음)이면 0. */
async function previewEarnedPoints(db, userId, total) {
  if (!userId) return 0;
  const { data: setting } = await db
    .from("admin_settings")
    .select("value")
    .eq("label", LOYALTY_POINTS_RATE_SETTING_LABEL)
    .maybeSingle();
  const parsed = Math.floor(Number(setting && setting.value));
  const percent = Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : LOYALTY_POINTS_DEFAULT_PERCENT;
  return calcEarnedPoints(total, percent);
}

/* 실제 적립 — amount는 previewEarnedPoints()가 미리 계산해준 값을 그대로 받는다(중복 설정
   조회 방지). 주문 저장이 이미 끝난 뒤(order_no가 orders에 실재하는 시점)에만 불러야 한다 —
   claimPointsUsage(사용)와 반대로 이건 순서 제약이 없지만, issueThanksCouponsIfEligible과
   같은 호출 지점(카드결제 확정, 무통장입금 관리자 확인)에 맞춰 그렇게 쓰고 있다. */
async function creditPoints(db, userId, amount, orderNo) {
  if (!userId || !amount) return;
  const { error } = await db.rpc("award_points", { p_user_id: userId, p_amount: amount, p_order_no: orderNo, p_reason: "earn_purchase" });
  if (error && !isMissingSchemaError(error)) console.error("[points] 적립 실패:", error.message);
}

/* previewEarnedPoints + creditPoints를 한 번에 — 저장 전에 points_earned를 미리 알 필요가
   없는 호출부(관리자의 무통장입금 "입금확인" 처리 등, 주문은 이미 있고 나중에 적립만 하면 됨)
   전용 편의 함수. */
async function awardPoints(db, userId, total, orderNo) {
  const amount = await previewEarnedPoints(db, userId, total);
  await creditPoints(db, userId, amount, orderNo);
  return amount;
}

/* 주문취소 시 되돌리기 — 이 주문으로 적립된 포인트는 회수, 이 주문에서 쓴 포인트는 환급.
   admin_uncancel(취소를 다시 취소)까지는 다루지 않는다 — 극히 드문 경로라 지금은 관리자가
   Works에서 육안으로 확인 후 필요하면 "관리자 수동 조정"으로 직접 맞추는 걸로 충분하다고 판단. */
async function reversePointsForOrder(db, orderNo) {
  const { error } = await db.rpc("reverse_points_for_order", { p_order_no: orderNo });
  if (error && !isMissingSchemaError(error)) console.error("[points] 주문취소 시 되돌리기 실패:", error.message);
}

module.exports = {
  LOYALTY_POINTS_RATE_SETTING_LABEL,
  LOYALTY_POINTS_DEFAULT_PERCENT,
  calcEarnedPoints,
  getPointsBalance,
  resolvePointsToUse,
  claimPointsUsage,
  previewEarnedPoints,
  creditPoints,
  awardPoints,
  reversePointsForOrder,
};
