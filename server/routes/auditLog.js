/* 관리자 활동 로그 조회 — server.js에서 분리(2026-11-09, 동작 변경 없음). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { paginationParams } = require("../lib/pagination");
const { applyKstDateRangeFilter } = require("../lib/kst");

const router = express.Router();

router.get("/api/admin/audit-log", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query);
  const { adminEmail, action, targetType, targetId, dateFrom, dateTo } = req.query;

  let query = supabaseAdmin.from("admin_audit_log").select("*", { count: "exact" }).order("at", { ascending: false });
  /* 직원 권한·PIN·관리자 계정 관리 기록은 마스터만 본다(2026-11-11) — 직원에게 "활동 로그" 권한을 줘도
     누가 누구의 권한을 바꿨는지·PIN 초기화·관리자 초대/해제는 보이지 않게. 화면이 아니라 서버에서 거른다. */
  if (!req.isMasterAdmin) query = query.not("action", "like", "staff.%").not("action", "like", "admin.%");
  if (adminEmail) query = query.ilike("admin_email", `%${adminEmail}%`);
  if (action) query = query.eq("action", action);
  /* 주문 상세 화면의 "변경 이력" 타임라인용 — targetType+targetId(예: order/R260830-000003)로
     좁히면 그 주문 하나에 대한 변경만 뽑을 수 있다. 새 테이블 없이 기존 감사로그를 재사용. */
  if (targetType) query = query.eq("target_type", targetType);
  if (targetId) query = query.eq("target_id", targetId);
  query = applyKstDateRangeFilter(query, "at", dateFrom, dateTo);

  const { data, error, count } = await query.range(from, to);

  if (error) return res.status(500).json({ error: "감사 로그를 불러오지 못했습니다." });
  res.json({
    items: data.map((r) => ({
      id: r.id,
      adminEmail: r.admin_email,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      detail: r.detail,
      at: r.at,
    })),
    page,
    pageSize,
    total: count ?? data.length,
  });
});

module.exports = router;
