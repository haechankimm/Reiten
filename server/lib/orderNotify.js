/* 주문 상태 변화(입금확인·출고)에 따른 메일·알림톡·감사 쿠폰 — 관리자 주문 수정과 0원 주문이 함께 쓴다.
   server.js에서 분리(2026-11-09, 동작 변경 없음). */
const { supabaseAdmin } = require("./supabase");
const { sendCustomerPaymentConfirmed, sendCustomerShipped } = require("./mailer");
const kakao = require("./kakao");

const { previewEarnedPoints, awardPoints } = require("./loyaltyPoints");
const { confirmationEnabled } = require("./purchaseConfirm");
const { issueThanksCouponsIfEligible } = require("./thanksCouponIssue");

/* 상태가 (처음으로) "입금확인"이 되는 순간의 메일·알림톡·첫구매쿠폰, 운송장번호가 처음
   채워지는 순간의 배송시작 메일·알림톡 — 건별 PATCH(/api/admin/orders/:no)와 일괄
   PATCH(/api/admin/orders/bulk) 양쪽이 완전히 똑같은 조건으로 처리해야 해서 하나로 뽑았다. */
async function notifyOrderStatusSideEffects(prev, saved, patch) {
  if (patch.status === "입금확인" && prev?.status !== "입금확인") {
    sendCustomerPaymentConfirmed(saved).catch((err) => {
      console.error("[mailer] 입금 확인 메일 발송 실패:", err.message);
    });
    kakao.sendAlimtalk("PAYMENT_CONFIRMED", saved.customer.tel, { name: saved.customer.name, orderNo: saved.order_no }).catch(() => {});
    issueThanksCouponsIfEligible(saved).catch((err) => console.error("[thanks-coupon] 처리 실패:", err.message));
    /* 카드결제는 finalizeCardOrder가 결제 확정 즉시 적립하므로 여기 다시 안 걸린다(생성 시점에
       이미 "입금확인"으로 저장됨) — 이 분기는 무통장입금이 관리자 확인으로 처음 "입금확인"이
       되는 순간만 탄다. points_earned는 생성 시 0으로 저장돼 있었으므로 여기서 실제 적립액으로
       채워 넣는다(고객이 주문 내역에서 정확한 적립 예정 포인트를 보게 하기 위함). */
    /* 구매확정 기능이 켜져 있으면(043) 여기서는 "적립 예정액"만 기록하고 실제 적립은 구매확정 때 한다
       (lib/purchaseConfirm.js — 결제 직후 적립 → 사용 → 반품하는 악용 방지). 꺼져 있으면 예전처럼 즉시 적립. */
    (async () => {
      if (await confirmationEnabled()) {
        const amount = await previewEarnedPoints(supabaseAdmin, saved.user_id, saved.total);
        if (amount) await supabaseAdmin.from("orders").update({ points_earned: amount }).eq("order_no", saved.order_no);
        return;
      }
      const amount = await awardPoints(supabaseAdmin, saved.user_id, saved.total, saved.order_no);
      if (amount) await supabaseAdmin.from("orders").update({ points_earned: amount }).eq("order_no", saved.order_no);
    })().catch((err) => console.error("[points] 적립 실패:", err.message));
  }
  if (!prev?.tracking_no && saved.tracking_no) {
    sendCustomerShipped(saved).catch((err) => {
      console.error("[mailer] 배송 시작 메일 발송 실패:", err.message);
    });
    kakao
      .sendAlimtalk("SHIPPED", saved.customer.tel, { name: saved.customer.name, orderNo: saved.order_no, trackingNo: saved.tracking_no })
      .catch(() => {});
  }
}

module.exports = { notifyOrderStatusSideEffects };
