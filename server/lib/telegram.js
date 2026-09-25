/* ---------- 텔레그램 긴급 알림 ----------
   메일 발송 실패·환불 실패처럼 치명적인 오류를 메일과 무관한 경로로 폰에 바로 띄우기 위한 채널.
   Render 환경변수 TELEGRAM_BOT_TOKEN(BotFather가 준 토큰)과 TELEGRAM_CHAT_ID(받을 사람, 쉼표로
   여러 명 가능)가 둘 다 있어야 동작하고, 없으면 조용히 아무 것도 하지 않는다. */
const API = "https://api.telegram.org";

function token() { return (process.env.TELEGRAM_BOT_TOKEN || "").trim(); }
function chatIds() { return (process.env.TELEGRAM_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean); }
function telegramConfigured() { return !!(token() && chatIds().length); }

/* 결과를 { ok, sent, error } 로 돌려준다(테스트 버튼이 화면에 보여주기 위함). 실패해도 예외는 안 던진다. */
async function sendTelegram(text) {
  if (!token()) return { ok: false, error: "TELEGRAM_BOT_TOKEN 없음" };
  if (!chatIds().length) return { ok: false, error: "TELEGRAM_CHAT_ID 없음" };
  let sent = 0;
  let lastError = "";
  for (const chatId of chatIds()) {
    try {
      const res = await fetch(`${API}/bot${token()}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) sent++;
      else lastError = body.description || `HTTP ${res.status}`;
    } catch (e) {
      lastError = e.message;
    }
  }
  if (lastError) console.error("[telegram] 발송 실패:", lastError);
  return { ok: sent > 0, sent, error: lastError || undefined };
}

/* 설정 도우미: 봇에게 최근 말을 건 대화방 목록(채팅 ID 찾기용). 토큰만 있으면 된다. */
async function findTelegramChats() {
  if (!token()) return { ok: false, error: "TELEGRAM_BOT_TOKEN 없음" };
  const res = await fetch(`${API}/bot${token()}/getUpdates`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) return { ok: false, error: body.description || `HTTP ${res.status}` };
  const seen = new Map();
  for (const u of body.result || []) {
    const chat = (u.message || u.channel_post || u.my_chat_member || {}).chat;
    if (chat && !seen.has(chat.id)) seen.set(chat.id, { id: String(chat.id), name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "" });
  }
  return { ok: true, chats: [...seen.values()] };
}

module.exports = { sendTelegram, findTelegramChats, telegramConfigured };
