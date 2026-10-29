/* ---------- 정산 리포트 다운로드·재발송 · 아침 요약 테스트 (2026-10-02) ----------
   매달 1일 정산 리포트 메일이 실패해도(예: 2026-10-01 Resend 도메인 문제) Works에서 바로 엑셀을 받거나 다시
   보낼 수 있게 한다. 리포트 생성은 lib/settlement.js(크론과 같은 함수). /api/admin/reports* 는 adminGuard의
   "대시보드" 권한 영역이다. */
const express = require("express");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { buildSettlement } = require("../lib/settlement");
const { sendAdminSettlementReport } = require("../lib/mailer");
const { sendMorningBriefing, collectBriefingCounts } = require("../lib/briefing");

const router = express.Router();

router.get("/api/admin/reports/settlement", requireAdmin, async (req, res) => {
  const report = await buildSettlement(String(req.query.month || ""));
  if (report.error) return res.status(400).json({ error: report.error });
  logAdminAction(req, "report.settlement_download", "report", report.monthKey);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="reiten-settlement-${report.monthKey}.xlsx"`);
  res.send(report.buffer);
});

router.post("/api/admin/reports/settlement/send", requireAdmin, async (req, res) => {
  const report = await buildSettlement(String((req.body || {}).month || ""));
  if (report.error) return res.status(400).json({ error: report.error });
  await sendAdminSettlementReport({ monthLabel: report.monthLabel, summary: report.summary, buffer: report.buffer });
  logAdminAction(req, "report.settlement_send", "report", report.monthKey);
  res.json({ ok: true, monthKey: report.monthKey, summary: report.summary });
});

/* 아침 요약을 지금 바로 한 번 받아보기(알림 연결 확인용) + 지금 건수 */
router.get("/api/admin/reports/briefing", requireAdmin, async (req, res) => {
  res.json(await collectBriefingCounts());
});
router.post("/api/admin/reports/briefing/test", requireAdmin, async (req, res) => {
  res.json(await sendMorningBriefing({ force: true }));
});

module.exports = router;
