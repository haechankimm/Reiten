/* 카카오 알림톡 발송 — 발송대행사 "솔라피(SOLAPI)" REST API로 보낸다(2026-11-11 연결).
   설정 전에는 전부 조용히 건너뛰고 알림은 메일로만 나간다(메일 실패가 주문을 막지 않는 것과 같은 원칙).

   켜는 방법(사용자 작업 — README §2-1 참고):
   1) 솔라피 가입 → 발신번호 등록 → 카카오 비즈니스채널(@reiten) 연동 → pfId(채널 ID) 받기
   2) 아래 TEMPLATES의 문구를 "그대로" 알림톡 템플릿으로 등록해 카카오 심사(1~2영업일) → 템플릿마다 templateId 받기
   3) Render 환경변수: SOLAPI_API_KEY, SOLAPI_API_SECRET, KAKAO_PF_ID, KAKAO_SENDER_PHONE(등록한 발신번호),
      그리고 승인된 템플릿마다 KAKAO_TPL_<코드>=templateId (예: KAKAO_TPL_ORDER_RECEIVED=KA01TP...)
   템플릿 ID가 없는 코드는 보내지 않으므로 승인된 것부터 하나씩 켜도 된다.
   문구를 바꾸려면 카카오 재심사가 필요하다 — 여기 문구와 등록 문구가 다르면 발송이 실패한다. */
const crypto = require("crypto");
const { logSystemError } = require("./adminLog");

/* 템플릿 문구(카카오에 등록할 원문) — #{변수}는 sendAlimtalk(code, to, variables)의 variables 키와 같아야 한다. */
const TEMPLATES = {
  ORDER_RECEIVED: {
    label: "무통장입금 주문 접수(입금 안내)",
    text: "[REITEN] 주문이 접수되었습니다.\n#{name}님, 주문해 주셔서 감사합니다.\n\n■ 주문번호: #{orderNo}\n■ 결제금액: #{amount}\n■ 입금계좌: #{account}\n■ 입금기한: 주문 후 #{hours}시간 이내\n\n기한 안에 입금이 확인되지 않으면 주문이 자동으로 취소됩니다.",
  },
  DEPOSIT_REMINDER: {
    label: "미입금 리마인드(자동 취소 전 안내)",
    text: "[REITEN] 아직 입금 전이에요.\n#{name}님, 주문번호 #{orderNo}의 입금이 아직 확인되지 않았습니다.\n\n■ 결제금액: #{amount}\n■ 입금계좌: #{account}\n\n약 #{hours}시간 안에 입금하지 않으면 주문이 자동으로 취소됩니다. 이미 입금하셨다면 이 메시지는 무시해 주세요.",
  },
  PAYMENT_CONFIRMED: {
    label: "입금 확인",
    text: "[REITEN] 입금이 확인되었습니다.\n#{name}님, 주문번호 #{orderNo}의 입금이 확인되어 상품 준비를 시작합니다.\n출고되면 운송장 번호를 다시 안내드리겠습니다.",
  },
  CARD_PAID: {
    label: "카드 결제 완료",
    text: "[REITEN] 결제가 완료되었습니다.\n#{name}님, 주문번호 #{orderNo}의 결제가 완료되어 상품 준비를 시작합니다.\n출고되면 운송장 번호를 다시 안내드리겠습니다.",
  },
  SHIPPED: {
    label: "출고(운송장 안내)",
    text: "[REITEN] 상품이 출고되었습니다.\n#{name}님, 주문번호 #{orderNo}의 상품이 출고되었습니다.\n\n■ 택배사: #{courier}\n■ 운송장번호: #{trackingNo}\n\n배송 조회는 택배사 홈페이지 또는 REITEN 주문조회에서 확인하실 수 있습니다.",
  },
  ORDER_CANCELLED: {
    label: "주문 취소",
    text: "[REITEN] 주문이 취소되었습니다.\n#{name}님, 주문번호 #{orderNo}가 취소되었습니다.\n결제하신 금액이 있다면 결제 수단에 따라 환불이 진행됩니다. 궁금한 점은 카카오톡 채널로 문의해 주세요.",
  },
  REFUND_COMPLETED: {
    label: "환불 완료",
    text: "[REITEN] 환불이 처리되었습니다.\n#{name}님, 주문번호 #{orderNo}의 #{amount} 환불이 처리되었습니다.\n카드 결제는 카드사에 따라 영업일 기준 3~7일 뒤 반영될 수 있습니다.",
  },
};

function templateVars(code) {
  return [...String((TEMPLATES[code] || {}).text || "").matchAll(/#\{(\w+)\}/g)].map((m) => m[1]);
}

function isConfigured() {
  return Boolean(process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET && process.env.KAKAO_PF_ID);
}

function templateIdFor(code) {
  return process.env[`KAKAO_TPL_${code}`] || "";
}

/* 솔라피 인증 헤더 — HMAC-SHA256(date + salt) */
function authHeader(apiKey, apiSecret, now = new Date()) {
  const date = now.toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto.createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

/* 발송 요청 본문 — 순수 함수(테스트용). 템플릿 변수가 빠졌으면 null(카카오가 어차피 거절하므로 보내지 않는다). */
function buildMessage(code, to, variables) {
  const templateId = templateIdFor(code);
  const phone = String(to || "").replace(/\D/g, "");
  if (!templateId || !/^01\d{8,9}$/.test(phone)) return null;
  const vars = {};
  for (const key of templateVars(code)) {
    const v = variables && variables[key];
    if (v === undefined || v === null || v === "") return null;
    vars[`#{${key}}`] = String(v);
  }
  const message = { to: phone, type: "ATA", kakaoOptions: { pfId: process.env.KAKAO_PF_ID, templateId, variables: vars, disableSms: true } };
  if (process.env.KAKAO_SENDER_PHONE) message.from = String(process.env.KAKAO_SENDER_PHONE).replace(/\D/g, "");
  return { message };
}

/* code: TEMPLATES의 키, to: 고객 휴대폰 번호, variables: 템플릿 #{변수}에 넣을 값 */
async function sendAlimtalk(code, to, variables) {
  if (!isConfigured()) return { skipped: "not-configured" };
  const body = buildMessage(code, to, variables);
  if (!body) return { skipped: templateIdFor(code) ? "invalid-input" : "no-template" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`HTTP ${res.status} ${text}`);
    }
    return { ok: true };
  } catch (err) {
    console.error(`[kakao] 알림톡 발송 실패(${code}):`, err.message);
    // 카드번호·전화번호 같은 개인정보는 남기지 않는다 — 코드와 오류만
    logSystemError("notification_failed", { channel: "alimtalk", kind: code, error: err.message });
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isConfigured, sendAlimtalk, buildMessage, authHeader, templateVars, TEMPLATES };
