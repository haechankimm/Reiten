/* 알림센터·시스템 오류 목록 — server.js에서 분리(2026-11-09, 동작 변경 없음). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { SYSTEM_ERROR_LABEL } = require("../lib/adminLog");
const { hasAreaPermission } = require("../lib/adminGuard");

const router = express.Router();

/* ---------- 알림센터 ----------
   "확인이 필요한 것들"을 한눈에 모아 보여주는 용도 — 별도 읽음/안읽음 상태를 DB에 저장하지
   않고, 그때그때 조건에 맞는 건수를 센다(입금대기 주문 = 아직 확인 안 한 신규 주문으로 취급,
   입금확인 등으로 상태를 바꾸면 자연히 카운트에서 빠짐). 5개 쿼리를 병렬로 돌린다.
   시스템 오류(카드결제 이중실패·환불 실패)만 예외 — 별도 사이드바 탭이 없어 tab을
   "systemErrors"로 두고, 클릭하면 works/index.html이 탭 이동 대신 같은 자리에서 목록을
   펼쳐 보여준다(아래 /api/admin/system-errors 참고). system_error_log 테이블이 아직
   없으면(019 미실행) 조회가 실패하는데, 다른 마이그레이션과 같은 원칙으로 조용히 0건 취급한다. */
router.get("/api/admin/notifications", requireAdmin, async (req, res) => {
  // 품절 조합은 "판매 중(공개)" 상품만 센다 — 비공개 상품의 0개 재고까지 세어 알림이 늘 떠 있던 것(2026-11-11 점검)
  const { data: activeProducts } = await supabaseAdmin.from("products").select("id").eq("active", true);
  const activeIds = (activeProducts || []).map((p) => p.id);
  const [orders, inventory, qna, returns, systemErrors, supplierDelivered, invoicesPending] = await Promise.all([
    supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).eq("status", "입금대기"),
    activeIds.length
      ? supabaseAdmin.from("inventory").select("product_id", { count: "exact", head: true }).lte("qty", 0).in("product_id", activeIds)
      : Promise.resolve({ count: 0 }),
    supabaseAdmin.from("qna").select("id", { count: "exact", head: true }).is("answer", null),
    supabaseAdmin.from("return_requests").select("id", { count: "exact", head: true }).eq("status", "접수"),
    supabaseAdmin.from("system_error_log").select("id", { count: "exact", head: true }).eq("resolved", false),
    // 공급처 배송완료인데 아직 입고 처리 안 한 송장(048), 확인 대기 매입(050) — 표가 없으면 0
    supabaseAdmin.from("supplier_shipments").select("id", { count: "exact", head: true }).eq("status", "DELIVERED"),
    supabaseAdmin.from("supplier_invoices").select("id", { count: "exact", head: true }).eq("status", "RECORDED"),
  ]);

  /* 알림 우선순위(severity) — 전부 빨간 배지로 뭉뚱그려 보여주면 정작 급한 것(결제·환불
     사고)이 묻힌다는 지적(2026-09)으로 3단계를 나눈다. "critical"(빨강)은 실제로 돈·데이터가
     어긋난 시스템 오류에만 쓰고, 나머지는 "warning"(주황 — 고객이 기다리는 처리)과
     "info"(중립 — 급하진 않지만 확인은 필요한 것)로 나눠 빨강의 신호력을 지킨다. */
  const items = [
    { key: "pendingOrders", label: "입금 확인 대기 주문", count: orders.count || 0, tab: "orders", severity: "warning" },
    { key: "outOfStock", label: "품절된 재고 조합", count: inventory.count || 0, tab: "inventory", severity: "info" },
    { key: "unansweredQna", label: "답변 대기 Q&A", count: qna.count || 0, tab: "qna", severity: "info" },
    { key: "pendingReturns", label: "처리 대기 반품·교환 신청", count: returns.count || 0, tab: "returns", severity: "warning" },
    { key: "systemErrors", label: "시스템 오류", count: systemErrors.count || 0, tab: "systemErrors", severity: "critical" },
    { key: "supplierAwaitingReceipt", label: "공급처 도착·입고 처리 대기", count: (!supplierDelivered.error && supplierDelivered.count) || 0, tab: "inventory", severity: "info" },
    { key: "invoicesPending", label: "확인 대기 매입", count: (!invoicesPending.error && invoicesPending.count) || 0, tab: "dashboard", severity: "info" },
  ];
  res.json({ items, total: items.reduce((sum, it) => sum + it.count, 0) });
});

/* 알림센터 벨에서 "시스템 오류" 행을 눌렀을 때 펼쳐 보여줄 상세 목록 — 최근 미해결 20건만.
   해결 처리는 DB에서 지우지 않고 resolved=true로만 표시한다(감사 로그와 같은 원칙 — 무슨 일이
   있었는지는 남겨둔다). */
router.get("/api/admin/system-errors", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("system_error_log")
    .select("*")
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return res.status(500).json({ error: "시스템 오류 로그를 불러오지 못했습니다." });
  res.json({
    items: data.map((r) => ({ id: r.id, type: r.type, label: SYSTEM_ERROR_LABEL[r.type] || r.type, detail: r.detail, at: r.created_at })),
  });
});

router.post("/api/admin/system-errors/:id/resolve", requireAdmin, async (req, res) => {
  /* 아웃박스 권한으로 들어온 직원(결제·시스템 오류 권한 없음)은 메일 발송 실패 기록만 해결 처리할 수 있다 — 환불 실패 같은
     긴급 오류를 대표가 보기 전에 지울 수 있었다(2026-10-28 정기 감사). */
  let q = supabaseAdmin.from("system_error_log").update({ resolved: true }).eq("id", req.params.id);
  if (!(await hasAreaPermission(req, "payments"))) q = q.eq("type", "notification_failed");
  const { error } = await q;
  if (error) return res.status(500).json({ error: "처리에 실패했습니다." });
  res.json({ ok: true });
});

module.exports = router;
