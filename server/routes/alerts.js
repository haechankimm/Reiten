/* ---------- 긴급 알림 설정·테스트(마스터 전용) ----------
   Works "정보" 탭의 긴급 알림 패널이 쓴다: 연결 상태 확인, 텔레그램 채팅 ID 찾기, 테스트 알림 보내기. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireMasterAdmin } = require("../lib/auth");
const { sendTelegram, findTelegramChats } = require("../lib/telegram");
const { sendPushToAdmins, configured: pushConfigured } = require("../lib/push");

const router = express.Router();

router.get("/api/admin/alerts/status", requireMasterAdmin, async (req, res) => {
  const { count } = await supabaseAdmin.from("push_subscriptions").select("*", { count: "exact", head: true });
  res.json({
    telegram: { token: !!(process.env.TELEGRAM_BOT_TOKEN || "").trim(), chatId: !!(process.env.TELEGRAM_CHAT_ID || "").trim() },
    push: { configured: pushConfigured, devices: count || 0 },
  });
});

router.get("/api/admin/alerts/telegram-chats", requireMasterAdmin, async (req, res) => {
  res.json(await findTelegramChats());
});

router.post("/api/admin/alerts/test", requireMasterAdmin, async (req, res) => {
  const [telegram, push] = await Promise.all([
    sendTelegram("✅ [REITEN] 테스트 알림입니다. 이 메시지가 보이면 긴급 오류 알림이 정상적으로 연결된 것입니다."),
    sendPushToAdmins({ title: "✅ REITEN 테스트 알림", body: "이 알림이 보이면 폰 푸시가 정상입니다.", tab: "home" }),
  ]);
  res.json({ telegram, push });
});

module.exports = router;
