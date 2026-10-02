/* ---------- 사진 리뷰 적립금 (2026-10-02) ----------
   사진이 있는 리뷰를 관리자가 "승인"하는 순간, 그 리뷰가 회원 주문(orders.user_id)으로 작성된 경우 적립금을
   준다(리뷰 하나당 한 번 — loyalty_points_ledger.ref에 리뷰 id, 043의 유니크 인덱스). 비회원 주문은 적립할 계정이
   없어 제외. 금액은 Works "정보" 탭의 "사진 리뷰 적립금(원)" 값(없으면 1,000원, 0이면 끔).
   승인을 취소(숨김)해도 이미 준 적립금은 회수하지 않는다(악용이면 관리자가 적립금을 직접 조정). */
const { isMissingSchemaError } = require("./pgErrors");

const REVIEW_PHOTO_POINTS_SETTING_LABEL = "사진 리뷰 적립금(원)";
const REVIEW_PHOTO_POINTS_DEFAULT = 1000;

async function getReviewPhotoPoints(db) {
  const { data } = await db.from("admin_settings").select("value").eq("label", REVIEW_PHOTO_POINTS_SETTING_LABEL).maybeSingle();
  if (!data || data.value === undefined || data.value === null || String(data.value).trim() === "") return REVIEW_PHOTO_POINTS_DEFAULT;
  const n = Math.floor(Number(String(data.value).replace(/[^0-9]/g, "")));
  return Number.isFinite(n) ? Math.min(100000, Math.max(0, n)) : REVIEW_PHOTO_POINTS_DEFAULT;
}

async function rewardPhotoReview(db, review) {
  if (!review || !review.photo_url || !review.order_no) return { awarded: 0, reason: "no_photo_or_order" };
  const { data: order } = await db.from("orders").select("order_no, user_id, status").eq("order_no", review.order_no).maybeSingle();
  if (!order || !order.user_id) return { awarded: 0, reason: "guest_order" };
  if (order.status === "취소") return { awarded: 0, reason: "cancelled_order" };
  const amount = await getReviewPhotoPoints(db);
  if (!amount) return { awarded: 0, reason: "disabled" };
  // 같은 리뷰로 두 번 적립하지 않게 먼저 확인(유니크 인덱스가 최종 방어)
  const { data: existing } = await db.from("loyalty_points_ledger").select("id").eq("reason", "earn_review").eq("ref", review.id);
  if (existing && existing.length) return { awarded: 0, reason: "already" };
  const { error } = await db.from("loyalty_points_ledger").insert({ user_id: order.user_id, order_no: review.order_no, delta: amount, reason: "earn_review", ref: review.id });
  if (error) {
    if (error.code === "23505") return { awarded: 0, reason: "already" };
    if (!isMissingSchemaError(error)) console.error("[review-reward] 적립 실패(043 미실행일 수 있음):", error.message);
    return { awarded: 0, reason: "error" };
  }
  return { awarded: amount, userId: order.user_id };
}

module.exports = { REVIEW_PHOTO_POINTS_SETTING_LABEL, REVIEW_PHOTO_POINTS_DEFAULT, getReviewPhotoPoints, rewardPhotoReview };
