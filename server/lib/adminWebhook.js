/* ---------- 긴급 알림 웹훅 ----------
   "시스템 오류(카드결제 이중실패·환불 실패 등)를 지금 쓰고 있는 사내 메신저로도 흘려보내고
   싶다"는 요청(2026-09) — 새 설정 테이블 없이 기존 admin_settings("정보" 탭)를 재사용한다
   (lib/thanksCoupons.js·lib/loyaltyPoints.js와 같은 패턴: 라벨 이름은 routes/settings.js가
   보호, 값만 자유롭게 수정). 값은 Slack 형식 Incoming Webhook URL — Slack 자신은 물론
   카카오워크(KakaoWork)도 같은 {"text": "..."} 포맷의 Incoming Webhook을 지원해서 그대로
   쓸 수 있다. 설정 안 해두면(값이 비어있으면) 조용히 아무 일도 안 한다(다른 선택 기능과 같은
   원칙) — 실패해도 본작업(시스템 오류 로그 적재 자체)을 막으면 안 되므로 항상 에러를 삼킨다. */
const { supabaseAdmin } = require("./supabase");

const ADMIN_ALERT_WEBHOOK_SETTING_LABEL = "긴급 알림 웹훅 URL";

async function getAdminWebhookUrl() {
  const { data, error } = await supabaseAdmin
    .from("admin_settings")
    .select("value")
    .eq("label", ADMIN_ALERT_WEBHOOK_SETTING_LABEL)
    .maybeSingle();
  if (error || !data) return "";
  return (data.value || "").trim();
}

async function sendAdminWebhookAlert(text) {
  try {
    const url = await getAdminWebhookUrl();
    if (!url || !/^https:\/\//.test(url)) return;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) console.error("[adminWebhook] 응답 실패:", res.status);
  } catch (e) {
    console.error("[adminWebhook] 전송 실패:", e.message);
  }
}

module.exports = { ADMIN_ALERT_WEBHOOK_SETTING_LABEL, sendAdminWebhookAlert };
