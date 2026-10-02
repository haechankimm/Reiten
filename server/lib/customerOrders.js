/* 고객 화면(비회원 주문조회·회원 내 주문)에 내려주는 주문 모양 — 두 API가 같은 함수를 쓴다(2026-10-02).
   예전엔 상품 합계·배송비·총액만 내려서 쿠폰·적립금 할인이 있는 주문은 "합계 + 배송비 ≠ 총 결제금액"으로
   보였고, 입금대기 주문의 입금 계좌·가상계좌 정보, 환불액, 구매확정 상태도 볼 수 없었다.
   고객 이름·연락처·주소(customer)와 관리자 메모는 일부러 넣지 않는다(조회는 주문번호+연락처만으로 열리므로). */
const { canConfirm, autoConfirmAt } = require("./purchaseConfirm");

function toCustomerOrderDto(o) {
  const due = autoConfirmAt(o);
  return {
    no: o.order_no,
    at: o.created_at,
    items: o.items,
    subtotal: o.subtotal,
    shipping: o.shipping,
    total: o.total,
    status: o.status,
    courier: o.courier || null,
    trackingNo: o.tracking_no || null,
    discount: o.discount || 0,
    couponCode: o.coupon_code || null,
    pointsUsed: o.points_used || 0,
    pointsEarned: o.points_earned || 0,
    paymentMethod: o.payment_method || "bank_transfer",
    refundedAmount: o.refunded_amount || 0,
    shippedAt: o.shipped_at || null,
    deliveredAt: o.delivered_at || null,
    confirmedAt: o.confirmed_at || null,
    canConfirm: "confirmed_at" in o ? canConfirm(o) : false,
    autoConfirmAt: "confirmed_at" in o && !o.confirmed_at && due ? due.toISOString() : null,
    virtualAccount:
      o.payment_method === "virtual_account" && o.status === "입금대기" && o.virtual_account_number
        ? { bank: o.virtual_account_bank, accountNumber: o.virtual_account_number, holder: o.virtual_account_holder, dueAt: o.virtual_account_due_at }
        : null,
  };
}

module.exports = { toCustomerOrderDto };
