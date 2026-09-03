/* ---------- 알림 발송 실패 아웃박스 ----------
   지금까지 lib/mailer.js의 17개 발송 함수가 전부 Resend의 반환값을 확인하지 않아, 실패해도
   완전히 무음이었다(2026-09 조사 중 발견 — 회원가입 확인 메일이 반복 실패했던 사고를 오래
   못 알아챈 이유도 결국 이거다). 이제 lib/mailer.js·lib/push.js가 실패 시
   logSystemError("notification_failed", {...})로 남기고(server_error_log,
   019_system_error_log.sql 재사용 — 새 테이블 안 만듦), 여기는 그중 알림 종류만 걸러
   보여주는 읽기 전용 조회 라우트다. "해결됨 처리"는 기존
   POST /api/admin/system-errors/:id/resolve를 그대로 재사용(중복 라우트 안 만듦) — 알림벨의
   "시스템 오류" 팝업과 같은 데이터를 type으로만 나눠 보여주는 것뿐이라 처리 방법도 같아야 함. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { paginationParams } = require("../lib/pagination");

const router = express.Router();

router.get("/api/admin/outbox", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query, { defaultSize: 30 });
  const resolved = req.query.resolved === "true";

  const { data, error, count } = await supabaseAdmin
    .from("system_error_log")
    .select("*", { count: "exact" })
    .eq("type", "notification_failed")
    .eq("resolved", resolved)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) return res.status(500).json({ error: "발송 실패 목록을 불러오지 못했습니다." });

  res.json({
    items: data.map((r) => ({
      id: r.id,
      channel: (r.detail && r.detail.channel) || "",
      kind: (r.detail && r.detail.kind) || "",
      to: (r.detail && r.detail.to) || "",
      error: (r.detail && r.detail.error) || "",
      resolved: r.resolved,
      at: r.created_at,
    })),
    page,
    pageSize,
    total: count ?? data.length,
  });
});

module.exports = router;
