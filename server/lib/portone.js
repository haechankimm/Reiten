/* 카드결제(포트원 V2) 연동. PORTONE_API_SECRET이 없으면(계정 준비 전) client가 null이라
   isConfigured()가 항상 false를 반환하고, 카드결제 관련 API는 503으로 응답한다 —
   무통장입금 흐름에는 전혀 영향 없다(다른 lib/*.js와 동일한 "선택적 외부 서비스" 패턴). */
const PortOne = require("@portone/server-sdk");

const client = process.env.PORTONE_API_SECRET
  ? PortOne.PortOneClient({ secret: process.env.PORTONE_API_SECRET })
  : null;

function isConfigured() {
  return !!(client && process.env.PORTONE_STORE_ID && process.env.PORTONE_CHANNEL_KEY);
}

/* 결제 건을 포트원 서버에서 다시 조회한다. 브라우저가 보낸 "결제 성공" 응답은 조작될 수 있으므로
   절대 신뢰하지 않고, paymentId만으로 포트원에 직접 물어봐서 실제 상태·금액을 확인한다
   (8번 섹션 "PG 결제를 붙일 때 반드시 지킬 것" 참고). */
async function getVerifiedPayment(paymentId) {
  if (!client) throw new Error("PORTONE_API_SECRET이 설정되지 않았습니다.");
  return client.payment.getPayment({ paymentId });
}

/* 웹훅 요청의 서명을 검증하고 파싱된 이벤트를 반환한다. rawBody는 반드시 파싱 전 원본 문자열이어야 한다. */
async function verifyWebhook(rawBody, headers) {
  if (!process.env.PORTONE_WEBHOOK_SECRET) throw new Error("PORTONE_WEBHOOK_SECRET이 설정되지 않았습니다.");
  return PortOne.Webhook.verify(process.env.PORTONE_WEBHOOK_SECRET, rawBody, headers);
}

/* 결제는 끝났는데(고객 카드에서 돈은 빠져나감) 그사이 재고가 소진돼 주문을 만들 수 없는 경우를 위한 것.
   실패하면 돈만 받고 물건은 못 주는 상태가 되므로, 호출부에서 반드시 성공 여부를 확인해야 한다. */
async function cancelPayment(paymentId, reason) {
  if (!client) throw new Error("PORTONE_API_SECRET이 설정되지 않았습니다.");
  return client.payment.cancelPayment({ paymentId, reason });
}

module.exports = { isConfigured, getVerifiedPayment, verifyWebhook, cancelPayment };
