/* ---------- 반품·교환·주문취소 신청 (관리자) ----------
   server.js에서 옮겨왔다(2026-10-02) — 유형별 처리 규칙(교환은 환불 없음, 주문취소 신청 완료 = 실제 주문 취소,
   반품 완료 = 환불 처리 필수)을 테스트로 고정하기 위해. 고객의 신청 접수(POST /api/returns)는 server.js에 그대로. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction, logInventoryChange } = require("../lib/adminLog");
const { paginationParams } = require("../lib/pagination");
const { applyKstDateRangeFilter } = require("../lib/kst");
const { restoreItemsFromOrder } = require("../lib/inventory");
const { updateWithOptionalColumnFallback, selectWithOptionalColumnFallback } = require("../lib/dbUpdate");
const { hasAreaPermission } = require("../lib/adminGuard");
const { applyOrderCancelSideEffects } = require("../lib/orderCancel");

const router = express.Router();

/* 반품 신청 목록 필터 — orders와 같은 규칙(q는 주문번호·이름·연락처 부분 일치, dateFrom/dateTo는 KST 하루 범위). */
function applyReturnFilters(query, reqQuery, requestUserId) {
  const { q, status, dateFrom, dateTo, assignedTo } = reqQuery;
  if (q) {
    const v = String(q).trim().slice(0, 60).replace(/[%,()]/g, "");
    if (v) query = query.or(`order_no.ilike.%${v}%,contact_name.ilike.%${v}%,contact_tel.ilike.%${v}%`);
  }
  if (status) query = query.eq("status", status);
  if (assignedTo === "me" && requestUserId) query = query.eq("assigned_to", requestUserId);
  else if (assignedTo) query = query.eq("assigned_to", assignedTo);
  query = applyKstDateRangeFilter(query, "created_at", dateFrom, dateTo);
  return query;
}

const RETURN_REQUEST_BASE_COLUMNS = "id, order_no, contact_name, contact_tel, reason, detail, status, restocked, refunded, created_at";
const RETURN_REQUEST_OPTIONAL_COLUMNS = ["request_type", "custom_reason", "assigned_to", "internal_note", "reship_courier", "reship_tracking_no", "reshipped_at"];

router.get("/api/admin/returns", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query);
  const { data, error, count } = await selectWithOptionalColumnFallback(RETURN_REQUEST_BASE_COLUMNS, RETURN_REQUEST_OPTIONAL_COLUMNS, (columns) => {
    let query = supabaseAdmin.from("return_requests").select(columns.join(", "), { count: "exact" }).order("created_at", { ascending: false });
    query = applyReturnFilters(query, req.query, req.user.id);
    return query.range(from, to);
  });

  if (error) return res.status(500).json({ error: "반품 신청 목록을 불러오지 못했습니다." });

  res.json({
    items: data.map((r) => ({
      id: r.id,
      orderNo: r.order_no,
      contactName: r.contact_name,
      contactTel: r.contact_tel,
      reason: r.reason,
      detail: r.detail,
      status: r.status,
      restocked: r.restocked,
      refunded: r.refunded,
      requestType: r.request_type || "return",
      customReason: r.custom_reason || null,
      at: r.created_at,
      assignedTo: r.assigned_to || null,
      internalNote: r.internal_note || null,
      reshipCourier: r.reship_courier || null,
      reshipTrackingNo: r.reship_tracking_no || null,
      reshippedAt: r.reshipped_at || null,
    })),
    page,
    pageSize,
    total: count ?? data.length,
  });
});

/* 반품·교환·주문취소 신청의 상태·담당자·메모 저장(2026-10-02 재설계).
   예전엔 유형과 상관없이 "완료"로 바꾸는 순간 카드 결제를 전액 환불해서 ① 교환을 완료하면 교환 상품도
   보내고 돈도 전부 돌려주는 사고 ② 주문취소 신청을 완료하면 환불만 나가고 주문은 그대로(재고 미복원,
   출고 가능) 남는 사고가 났다. 이제 유형별로 다르게 처리한다:
   · 교환: 상태만 저장 — 절대 환불하지 않는다(재발송은 POST /api/admin/returns/:id/reship)
   · 주문취소 신청: "완료"가 되는 순간 실제 주문을 취소한다(재고 복원·환불·적립금·안내 메일 — 관리자 주문취소와
     같은 applyOrderCancelSideEffects). 이미 출고된 주문이면 거절하고 반품으로 처리하도록 안내
   · 반품: "완료"는 환불 처리(POST /api/admin/refunds — 상품 선택·반품 배송비·적립금 회수 확인)를 거쳐야만 된다 */
const RETURN_STATUSES_BY_TYPE = {
  return: ["접수", "수거중", "처리중", "완료", "반려"],
  exchange: ["접수", "수거중", "재발송", "완료", "반려"],
  cancel: ["접수", "완료", "반려"],
};

router.patch("/api/admin/returns/:id", requireAdmin, async (req, res) => {
  const { status, assignedTo, internalNote, expectedStatus } = req.body || {};
  const statusStr = status !== undefined ? String(status || "").trim() : undefined;
  if (status !== undefined && !statusStr) {
    return res.status(400).json({ error: "status가 필요합니다." });
  }

  const patch = {};
  if (statusStr !== undefined) patch.status = statusStr;
  if (assignedTo !== undefined) patch.assigned_to = assignedTo || null;
  if (internalNote !== undefined) patch.internal_note = String(internalNote || "").trim().slice(0, 2000) || null;
  if (!Object.keys(patch).length) return res.status(400).json({ error: "변경할 값이 없습니다." });

  const { data: prev, error: prevError } = await supabaseAdmin
    .from("return_requests")
    .select("*")
    .eq("id", req.params.id)
    .single();
  if (prevError || !prev) return res.status(404).json({ error: "반품 신청을 찾을 수 없습니다." });
  if (expectedStatus !== undefined && String(expectedStatus) !== String(prev.status)) {
    return res.status(409).json({ error: "다른 관리자가 이 신청을 방금 수정했습니다. 목록을 새로고침해서 최신 내용을 확인한 뒤 다시 저장해 주세요.", code: "STALE", current: { status: prev.status } });
  }

  const requestType = prev.request_type || "return";
  const allowed = RETURN_STATUSES_BY_TYPE[requestType] || RETURN_STATUSES_BY_TYPE.return;
  if (statusStr !== undefined && !allowed.includes(statusStr)) {
    return res.status(400).json({ error: `이 신청 유형에서 쓸 수 없는 상태입니다(${allowed.join("·")}).` });
  }
  const becomesDone = statusStr === "완료" && prev.status !== "완료";

  if (becomesDone && requestType === "return" && !prev.refunded) {
    return res.status(400).json({
      error: "반품 완료는 '환불 처리' 버튼으로 진행해 주세요 — 환불할 상품·반품 배송비·적립금 회수를 확인하는 단계입니다.",
      code: "REFUND_REQUIRED",
    });
  }

  let cancel = null;
  if (becomesDone && requestType === "cancel") {
    const { data: order } = await supabaseAdmin.from("orders").select("*").eq("order_no", prev.order_no).maybeSingle();
    if (!order) return res.status(404).json({ error: "연결된 주문을 찾을 수 없습니다." });
    if (order.status === "배송중" || order.status === "완료") {
      return res.status(409).json({ error: "이미 출고된 주문이라 취소할 수 없습니다. 고객 안내 후 반품으로 접수해 처리해 주세요.", code: "ALREADY_SHIPPED" });
    }
    if (order.status !== "취소") {
      if (order.status !== "입금대기" && !(await hasAreaPermission(req, "refunds"))) {
        return res.status(403).json({ error: "'환불·주문취소' 권한이 없어 입금된 주문을 취소할 수 없습니다. 마스터 관리자에게 문의하세요.", code: "FORBIDDEN_AREA", area: "refunds" });
      }
      const reasonText = [prev.reason, prev.custom_reason].filter(Boolean).join(" — ");
      const cancelReason = `고객 취소 신청${reasonText ? `: ${reasonText}` : ""}`.slice(0, 300);
      // 상태 조건을 걸어 갱신 — 그사이 다른 관리자가 같은 주문을 취소·출고했다면 두 번 처리하지 않는다.
      const { data: saved, error: cancelErr } = await supabaseAdmin
        .from("orders")
        .update({ status: "취소", cancel_reason: cancelReason })
        .eq("order_no", order.order_no)
        .eq("status", order.status)
        .select()
        .maybeSingle();
      if (cancelErr || !saved) {
        return res.status(409).json({ error: "주문 상태가 방금 바뀌었습니다. 새로고침 후 다시 시도해 주세요.", code: "STALE" });
      }
      cancel = await applyOrderCancelSideEffects(saved, order.status, cancelReason);
      logAdminAction(req, "order.cancel_from_request", "order", order.order_no, { returnId: prev.id, reason: cancelReason, refund: cancel });
    } else {
      cancel = { refund: "already_cancelled", ok: true };
    }
    patch.refunded = true;
  }

  const { data: savedReturn, error } = await updateWithOptionalColumnFallback("return_requests", "id", req.params.id, patch);
  if (error || !savedReturn) return res.status(500).json({ error: "저장에 실패했습니다." });
  logAdminAction(req, "return.update", "return", req.params.id, patch);

  res.json({ ok: true, requestType, cancel });
});

/* 반품 승인 시 재고 복원 — return_requests는 주문번호만 갖고 있고 어떤 항목을 반품했는지는
   따로 기록하지 않으므로(전체 반품 전제), 해당 주문의 전체 항목을 복원한다. 부분 반품이면
   관리자가 이 버튼 대신 재고 탭에서 직접 수량을 조정해야 한다. 중복 복원(재고가 두 번 늘어나는
   사고)을 막기 위해 restocked 플래그로 한 번만 허용한다. */
router.post("/api/admin/returns/:id/restock", requireAdmin, async (req, res) => {
  const { data: ret, error: retError } = await supabaseAdmin
    .from("return_requests")
    .select("id, order_no, restocked")
    .eq("id", req.params.id)
    .single();
  if (retError || !ret) return res.status(404).json({ error: "반품 신청을 찾을 수 없습니다." });
  if (ret.restocked) return res.status(400).json({ error: "이미 재고를 복원한 반품입니다." });

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("order_no, items")
    .eq("order_no", ret.order_no)
    .single();
  if (orderError || !order) return res.status(404).json({ error: "연결된 주문을 찾을 수 없습니다." });

  /* lines([{ index, qty }])를 주면 그 상품·수량만 복원한다 — 교환처럼 주문 일부만 돌아오는 경우(2026-10-02).
     안 주면 예전처럼 주문 전체를 복원한다. 반품 환불은 환불 처리(POST /api/admin/refunds)에서 고른 상품만
     같이 복원하므로 이 버튼을 따로 누를 필요가 없다. */
  const lines = Array.isArray(req.body && req.body.lines) ? req.body.lines : null;
  let sourceItems = order.items || [];
  if (lines) {
    const picked = [];
    for (const ln of lines) {
      const idx = Number(ln && ln.index);
      const qty = Math.floor(Number(ln && ln.qty));
      const it = sourceItems[idx];
      if (!it || !Number.isFinite(qty) || qty < 1 || qty > (Number(it.qty) || 0)) {
        return res.status(400).json({ error: "복원할 상품·수량이 올바르지 않습니다." });
      }
      picked.push({ ...it, qty });
    }
    sourceItems = picked;
  }
  const restoreItems = restoreItemsFromOrder(sourceItems);

  if (!restoreItems.length) {
    return res.status(400).json({ error: "이 주문에는 자동으로 복원할 재고 정보가 없습니다(이전 방식으로 만들어진 주문). 재고 탭에서 직접 조정해 주세요." });
  }

  const { error: restoreError } = await supabaseAdmin.rpc("restore_inventory", { p_items: restoreItems });
  if (restoreError) return res.status(500).json({ error: "재고 복원에 실패했습니다." });

  logInventoryChange(
    restoreItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: it.qty, reason: "return_restock", ref: ret.order_no }))
  );
  await supabaseAdmin.from("return_requests").update({ restocked: true }).eq("id", ret.id);
  logAdminAction(req, "return.restock", "return", req.params.id, { orderNo: ret.order_no, items: restoreItems });

  res.json({ ok: true });
});

module.exports = router;
