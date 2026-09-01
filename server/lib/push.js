/* ---------- Works 브라우저 푸시 알림 ----------
   GA4 서비스 계정처럼 VAPID 키 한 쌍(공개/비공개)이 필요한 선택 기능 — 로컬 .env와 Render
   환경변수(VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)에 설정해야 실제로 동작한다. 설정이 없으면
   sendPushToAdmins()가 조용히 아무 것도 하지 않아(다른 선택 기능과 같은 원칙) 사이트 동작에는
   지장이 없다. */
const webpush = require("web-push");
const { supabaseAdmin } = require("./supabase");
const { isMissingSchemaError } = require("./pgErrors");

const configured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (configured) {
  webpush.setVapidDetails("mailto:reiten.customersupport@gmail.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
} else {
  console.warn("[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY이 설정되지 않아 브라우저 푸시 알림이 비활성 상태입니다.");
}

/* 모든 관리자의 모든 구독 기기에 알림을 보낸다(새 주문 접수처럼 관리자 전원이 알아야 할 이벤트용).
   구독이 만료·취소됐으면(410 Gone, 404) 그 행을 지워 다음부터는 시도조차 안 하게 정리한다. */
async function sendPushToAdmins(payload) {
  if (!configured) return;

  const { data: subs, error } = await supabaseAdmin.from("push_subscriptions").select("endpoint, keys");
  if (error) {
    if (!isMissingSchemaError(error)) console.error("[push] 구독 목록 조회 실패:", error.message);
    return; // 테이블 없음(026 미실행)이거나 다른 오류 — 조용히 건너뜀
  }
  if (!subs.length) return;

  const body = JSON.stringify(payload);
  const staleEndpoints = [];
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) staleEndpoints.push(sub.endpoint);
        else console.error("[push] 알림 발송 실패:", err.message);
      }
    })
  );
  if (staleEndpoints.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
  }
}

module.exports = { sendPushToAdmins, configured };
