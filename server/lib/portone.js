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

/* 가상계좌는 카드결제와 같은 채널키를 쓰지만, PG사(NHN KCP 등)에 가상계좌 결제수단 자체를
   별도로 심사받아야 실제로 발급이 된다(README "가상계좌 결제" 참고 — 코드만으로는 못 끝나는
   외부 신청·심사). 그 승인이 나기 전까지 결제수단 자체가 고객 화면에 안 뜨게, 관리자가 은행
   하나를 직접 정해 넣는 PORTONE_VIRTUAL_ACCOUNT_BANK 환경변수가 있을 때만 켠다(다른 선택
   기능과 같은 "설정 안 하면 조용히 꺼짐" 원칙). */
function isVirtualAccountConfigured() {
  return isConfigured() && !!process.env.PORTONE_VIRTUAL_ACCOUNT_BANK;
}

/* 포트원 Bank 코드 → 한국어 은행명. 가상계좌 발급 요청(고객 화면)·안내 메일 양쪽에서 같은
   표기를 써야 해서 여기 하나로 모은다 — 전체 목록은 포트원 SDK의 Bank 타입 참고, 실제로
   가상계좌 발급에 흔히 쓰이는 은행만 우선 채워뒀다(필요하면 추가). */
const BANK_LABEL_KO = {
  KOOKMIN: "국민은행", SHINHAN: "신한은행", WOORI: "우리은행", HANA: "하나은행",
  NONGHYUP: "농협은행", IBK: "기업은행", STANDARD_CHARTERED: "SC제일은행",
  CITI: "한국씨티은행", KDB: "산업은행", SUHYUP: "수협은행", KFCC: "새마을금고",
  SHINHYUP: "신협", POST: "우체국", KAKAO: "카카오뱅크", TOSS: "토스뱅크",
  K_BANK: "케이뱅크", DAEGU: "iM뱅크(대구)", BUSAN: "부산은행", KWANGJU: "광주은행",
  JEJU: "제주은행", JEONBUK: "전북은행", KYONGNAM: "경남은행",
};

function bankLabel(bankCode) {
  return BANK_LABEL_KO[bankCode] || bankCode || "";
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

/* 입금 기한이 지나도록 아무도 입금하지 않은 가상계좌를 더 이상 쓸 수 없게 막는다(cancelPayment와
   달리 아직 돈이 오간 적이 없어 "취소·환불"이 아니라 "폐쇄"). 실패해도(이미 폐쇄됐거나 PG가
   지원 안 하는 경우 등) 우리 쪽 주문은 이미 취소 처리했으므로 로그만 남기고 넘어간다. */
async function closeVirtualAccount(paymentId) {
  if (!client) throw new Error("PORTONE_API_SECRET이 설정되지 않았습니다.");
  return client.payment.closeVirtualAccount({ paymentId });
}

module.exports = { isConfigured, isVirtualAccountConfigured, bankLabel, getVerifiedPayment, verifyWebhook, cancelPayment, closeVirtualAccount };
