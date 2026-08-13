/* 카카오 알림톡 발송 — 실제 발송은 카카오와 직접 하지 않고, 알림톡을 대행하는 업체
   (예: 알리고, 솔라피, NHN Cloud, 비즈엠 등)의 REST API를 통해 이뤄진다. 그 업체 가입과
   메시지 템플릿의 카카오 사전 심사가 끝나기 전까지는 아래 함수들이 전부 조용히 아무 일도
   하지 않는다(메일 발송이 실패해도 주문 처리를 막지 않는 것과 같은 원칙) — 즉 이 파일은
   "심사가 끝나면 바로 켤 수 있는" 자리만 미리 마련해둔 것이다.

   활성화하는 방법:
   1) 알림톡 발송대행사에 가입하고 발신 프로필(카카오 비즈니스채널)을 등록한다.
   2) 아래 각 함수가 보낼 문구를 그대로 템플릿으로 등록해 카카오 심사를 받는다
      (심사는 보통 1~2영업일, 문구를 승인된 템플릿과 다르게 보내면 반려된다).
   3) 발송대행사가 주는 API 키/발신프로필키를 .env에 KAKAO_ALIMTALK_* 이름으로 채운다.
   4) sendAlimtalk() 안의 TODO 부분을 그 업체의 REST API 호출로 바꾼다(업체마다 요청 형식이 다르다).
   그 전까지는 .env에 아무 것도 없어도 서버가 정상 동작하며, 알림은 이메일로만 나간다. */

function isConfigured() {
  return Boolean(process.env.KAKAO_ALIMTALK_API_KEY && process.env.KAKAO_ALIMTALK_SENDER_KEY);
}

/* templateCode: 카카오에 심사받은 템플릿 코드(예: "ORDER_RECEIVED").
   to: 수신자 휴대폰번호("010-1234-5678" 형식).
   variables: 템플릿의 {{변수}}에 채울 값들. */
async function sendAlimtalk(templateCode, to, variables) {
  if (!isConfigured()) {
    console.warn(`[kakao] 알림톡 미설정 — ${templateCode} 발송을 건너뜁니다(발송대행사 연동 전).`);
    return { skipped: true };
  }
  if (!to) return { skipped: true };

  // TODO: 실제 발송대행사 REST API 호출로 교체.
  // 예시(업체마다 요청 형식이 다르므로 계약한 업체의 문서를 그대로 따를 것):
  //   POST https://<발송대행사>/alimtalk/send
  //   headers: { Authorization: `Bearer ${process.env.KAKAO_ALIMTALK_API_KEY}` }
  //   body: { senderKey: process.env.KAKAO_ALIMTALK_SENDER_KEY, templateCode, to, variables }
  console.warn(`[kakao] sendAlimtalk() 구현이 아직 연결되지 않았습니다 — ${templateCode} → ${to}`);
  return { skipped: true };
}

module.exports = { isConfigured, sendAlimtalk };
