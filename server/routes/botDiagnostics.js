/* ---------- 에이전트(피클) 전용 읽기 전용 진단 (2026-11-09) ----------
   AI 비서 에이전트가 관리자 로그인·PIN 없이 서버 상태만 읽어 가는 통로. 관리자 세션을 에이전트에게 주면 고객이 쓴 글
   (문의·리뷰·주문 메모)에 숨긴 지시에 속아 환불·취소를 누를 수 있어서(프롬프트 인젝션), 쓰기 기능이 전혀 없는 이 경로만 연다.
   - 인증: 헤더 X-REITEN-BOT-KEY == Render 환경변수 REITEN_BOT_KEY(32자 이상). 키가 없거나 짧으면 경로 자체가 꺼진다(404).
   - 내용: lib/diagnostics.js — 이메일·전화·URL·긴 비밀값을 가린 운영 점검·오류 묶음·결제 이상·주문 건수. 고객 이름·주소·주문 상세 없음.
   - 남용 방지: 틀린 키는 IP당 15분 20회(authLimiter와 같은 기준), 성공한 조회는 활동 로그(admin_audit_log)에 "bot:pickle"로 남는다.
   GET만 있다 — 이 파일에 쓰기 경로를 추가하지 말 것(에이전트 권한은 읽기 전용이 원칙, README 0번 "AI 에이전트" 항목).
   유일한 예외인 공급처 송장 기록(고객 주문·돈과 무관한 독립 표)은 routes/supplierShipments.js에 따로 있다(2026-11-10). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { collectDiagnostics, buildDiagnosticReport } = require("../lib/diagnostics");
const { botLimiter } = require("../lib/rateLimiters");
const { requireBotKey, BOT_ACTOR_ID } = require("../lib/botAuth");

const router = express.Router();

router.get("/api/bot/diagnostics", botLimiter, requireBotKey, async (req, res) => {
  const [data, report] = await Promise.all([collectDiagnostics(), buildDiagnosticReport()]);
  supabaseAdmin
    .from("admin_audit_log")
    .insert({ admin_id: BOT_ACTOR_ID, admin_email: "bot:pickle", action: "bot.diagnostics_read", target_type: "system", target_id: "diagnostics", detail: { ip: req.ip } })
    .then(({ error }) => { if (error) console.error("[bot] 활동 로그 적재 실패:", error.message); });
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, ...data, report });
});

module.exports = router;
