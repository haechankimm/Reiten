/* ---------- 긴급 알림 설정·테스트(마스터 전용) ----------
   Works "정보" 탭의 긴급 알림 패널이 쓴다: 연결 상태 확인, 텔레그램 채팅 ID 찾기, 테스트 알림 보내기. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireMasterAdmin } = require("../lib/auth");
const { sendTelegram, findTelegramChats } = require("../lib/telegram");
const { sendPushToAdmins, configured: pushConfigured } = require("../lib/push");
const { runOpsCheck } = require("../lib/opsCheck");
const { buildBackup } = require("../lib/backup");
const { logAdminAction } = require("../lib/adminLog");

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

/* 운영 점검(lib/opsCheck.js) — 메일·알림·결제·배송조회 설정, 마이그레이션, 최근 발송 실패·미해결 오류를 한 번에. */
router.get("/api/admin/alerts/ops-check", requireMasterAdmin, async (req, res) => {
  res.json(await runOpsCheck());
});

/* 전체 데이터 백업 파일(lib/backup.js — 매주 자동 메일과 같은 파일)을 지금 바로 받기. 개인정보가 있어 마스터 전용. */
router.get("/api/admin/alerts/backup", requireMasterAdmin, async (req, res) => {
  const { filename, buffer, summary } = await buildBackup();
  logAdminAction(req, "backup.full_download", "backup", filename, summary);
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

module.exports = router;
