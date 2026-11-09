/* 포트원 결제 웹훅(server.js에서 분리, 2026-11-09 구조 정리 — 동작 변경 없음).
   server.js에서 express.json()보다 먼저 마운트해야 한다(서명 검증에 원본 문자열 필요). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");

const portone = require("../lib/portone");
const { logSystemError, logPaymentAttempt } = require("../lib/adminLog");
const { finalizeCardOrder, finalizeVirtualAccountOrder, markVirtualAccountPaid, paidMethodOf } = require("../lib/orderFinalize");

const router = express.Router();

/* 포트원 웹훅은 서명 검증에 "파싱 전 원본 문자열"이 필요해서, 이 라우트만 아래
   express.json()보다 먼저 등록해 그 미들웨어를 타지 않게 한다(등록 순서대로 매칭되는 Express 특성 이용).
   finalizeCardOrder 등 결제 확정 로직은 lib/orderFinalize.js에 있다.
   결제 완료를 알려주는 이 웹훅은 /api/order(카드 분기)가 이미 검증→주문 생성을 처리하는 것과 별개로,
   고객이 결제 직후 브라우저를 닫아버려 그 확인 요청이 서버에 닿지 못하는 경우를 위한 보조 경로다.
   orders.payment_id로 이미 처리된 건인지 먼저 확인해서 멱등하게 동작한다(포트원이 같은 웹훅을
   여러 번 재전송해도 주문이 중복 생성되지 않음). */
router.post("/api/payments/webhook", express.text({ type: "*/*" }), async (req, res) => {
  if (!portone.isConfigured()) return res.status(503).end();

  let webhook;
  try {
    webhook = await portone.verifyWebhook(req.body, req.headers);
  } catch (e) {
    console.error("[payments/webhook] 서명 검증 실패:", e.message);
    return res.status(400).end();
  }

  /* 가상계좌가 발급된 순간 — 브라우저가 그 사이 닫혀도(카드결제 웹훅과 같은 이유) 이 웹훅이
     주문 생성의 주된 경로가 될 수 있다(프론트의 /api/order 확인 요청은 보조). data에는
     paymentId만 오고 실제 계좌번호·은행 등은 없어(WebhookTransactionDataVirtualAccountIssued
     참고) getVerifiedPayment로 다시 조회해야 한다. */
  if (webhook.type === "Transaction.VirtualAccountIssued") {
    const { paymentId } = webhook.data;
    const { data: existingOrder } = await supabaseAdmin.from("orders").select("order_no").eq("payment_id", paymentId).maybeSingle();
    if (existingOrder) return res.status(200).end(); // /api/order 쪽에서 이미 처리됨

    const { data: pending } = await supabaseAdmin.from("pending_payments").select("*").eq("payment_id", paymentId).maybeSingle();
    if (!pending) return res.status(200).end();

    let verified;
    try {
      verified = await portone.getVerifiedPayment(paymentId);
    } catch (e) {
      console.error("[payments/webhook] 가상계좌 조회 실패:", e.message);
      return res.status(500).end();
    }
    if (verified.status !== "VIRTUAL_ACCOUNT_ISSUED" || verified.amount.total !== pending.total) {
      console.error("[payments/webhook] 가상계좌 금액/상태 불일치:", paymentId);
      return res.status(200).end();
    }
    const result = await finalizeVirtualAccountOrder({ pending, paymentId, verified });
    return res.status(result.ok ? 200 : result.status).end();
  }

  if (webhook.type !== "Transaction.Paid") {
    return res.status(200).end();
  }

  const { paymentId } = webhook.data;

  const { data: existingOrder } = await supabaseAdmin.from("orders").select("*").eq("payment_id", paymentId).maybeSingle();
  if (existingOrder) {
    /* 카드결제는 생성 즉시 "입금확인"이라 여기 다시 걸리면 이미 처리된 것 — 하지만 가상계좌는
       "입금대기"로 만들어뒀다가 이 Paid 웹훅이 와야 비로소 결제가 끝난다(README "무통장입금은
       진짜 실시간 자동 알림이 아님" 제약을 가상계좌만 해결하는 지점). */
    if (existingOrder.status === "입금대기" && existingOrder.payment_method === "virtual_account") {
      const result = await markVirtualAccountPaid(paymentId);
      return res.status(result.ok ? 200 : 500).end();
    }
    /* 입금기한이 지나 취소된 가상계좌 주문에 입금이 들어온 경우 — 돈은 받았는데 주문은 취소 상태라, 조용히 넘어가면
       아무도 모른다(계좌 폐쇄가 실패했을 때 생김). 긴급 알림으로 남겨 환불·복구를 하게 한다(2026-10-28 정기 감사). */
    if (existingOrder.status === "취소") {
      logSystemError("paid_after_cancel", { orderNo: existingOrder.order_no, paymentId, amount: existingOrder.total });
    }
    return res.status(200).end();
  }

  const { data: pending } = await supabaseAdmin.from("pending_payments").select("*").eq("payment_id", paymentId).maybeSingle();
  if (!pending) return res.status(200).end(); // 알 수 없는 결제 건이거나 이미 소비됨

  let verified;
  try {
    verified = await portone.getVerifiedPayment(paymentId);
  } catch (e) {
    console.error("[payments/webhook] 결제 조회 실패:", e.message);
    logPaymentAttempt({ paymentId, status: "error", amount: pending.total, reason: e.message });
    return res.status(500).end(); // 포트원이 재시도하도록 5xx로 응답
  }
  if (verified.status !== "PAID" || verified.amount.total !== pending.total) {
    console.error("[payments/webhook] 금액/상태 불일치:", paymentId);
    logPaymentAttempt({ paymentId, status: "mismatch", amount: pending.total, reason: `status=${verified.status}` });
    return res.status(200).end(); // 재시도해도 결과가 같으므로 200으로 끝내 재전송을 막는다
  }

  const result = await finalizeCardOrder({ pending, paymentId, userId: pending.user_id || null, paymentMethod: paidMethodOf(verified) });
  res.status(result.ok ? 200 : result.status).end();
});

module.exports = router;
