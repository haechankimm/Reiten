/* ---------- 환불(부분 반품·부분 취소)·교환 재발송 (2026-10-02) ----------
   금액 계산·실행은 lib/refunds.js 한 곳에서 한다(운영 규칙 2). 이 파일은 Works 화면이 부르는 HTTP 입구만.
   · POST /api/admin/refunds/preview — 고른 상품·사유로 환불 금액 미리보기(아무것도 바꾸지 않음)
   · POST /api/admin/refunds         — 실제 환불(카드면 PG 부분 취소, 무통장은 "직접 송금" 기록) + 재고·적립금 정리
   · GET  /api/admin/orders/:no/refunds — 주문 상세의 환불 이력·남은 수량
   · POST /api/admin/returns/:id/reship — 교환 상품 재발송(운송장 저장 + 고객 안내, 환불 없음)
   /api/admin/refunds* 는 adminGuard의 "refunds"(환불·주문취소) 권한 영역이다 — 돈이 나가는 처리라 별도 권한. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction, logInventoryChange, logSystemError } = require("../lib/adminLog");
const portone = require("../lib/portone");
const kakao = require("../lib/kakao");
const { computeRefund, executeRefund, loadPreviousRefunds, refundedQtyByIndex } = require("../lib/refunds");
const { updateWithOptionalColumnFallback } = require("../lib/dbUpdate");
const { sendCustomerRefundIssued, sendCustomerExchangeShipped, sendAdminRefundFailed } = require("../lib/mailer");
const { SITE, COURIERS } = require("../../소스 코드/assets/js/data.js");

const router = express.Router();

async function loadOrder(orderNo) {
  const { data } = await supabaseAdmin.from("orders").select("*").eq("order_no", String(orderNo || "").trim()).maybeSingle();
  return data || null;
}

function refundableLines(order, previousRefunds) {
  const done = refundedQtyByIndex(previousRefunds);
  return (order.items || []).map((it, index) => ({
    index,
    name: it.name,
    options: it.options || "",
    qty: Number(it.qty) || 0,
    unit: Number(it.unit) || 0,
    remaining: Math.max(0, (Number(it.qty) || 0) - (done.get(index) || 0)),
  }));
}

/* 환불이 가능한 주문 상태인지 — 부분 취소는 "입금확인"(출고 전)만, 반품은 결제된 주문(취소 제외)만. */
function kindAllowedForStatus(kind, status) {
  if (kind === "partial_cancel") return status === "입금확인";
  return status !== "입금대기" && status !== "취소";
}

router.get("/api/admin/orders/:no/refunds", requireAdmin, async (req, res) => {
  const order = await loadOrder(req.params.no);
  if (!order) return res.status(404).json({ error: "존재하지 않는 주문입니다." });
  const { rows, tableMissing } = await loadPreviousRefunds(supabaseAdmin, order.order_no);
  res.json({
    lines: refundableLines(order, rows),
    history: rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
    refundedAmount: Number(order.refunded_amount) || rows.reduce((s, r) => s + (Number(r.refund_amount) || 0), 0),
    total: order.total,
    shipping: order.shipping,
    paymentMethod: order.payment_method || null,
    status: order.status,
    migrationMissing: tableMissing,
  });
});

router.post("/api/admin/refunds/preview", requireAdmin, async (req, res) => {
  const { orderNo, lines, kind, fault, shippingDeduction } = req.body || {};
  const order = await loadOrder(orderNo);
  if (!order) return res.status(404).json({ error: "존재하지 않는 주문입니다." });
  if (!kindAllowedForStatus(kind, order.status)) {
    return res.status(409).json({ error: kind === "partial_cancel" ? "부분 취소는 출고 전(입금확인) 주문만 할 수 있습니다." : "결제가 확인된 주문만 환불할 수 있습니다." });
  }
  const { rows } = await loadPreviousRefunds(supabaseAdmin, order.order_no);
  const calc = computeRefund(order, rows, lines, { kind, fault, shippingDeduction, shippingFee: SITE.shipping.fee });
  if (calc.error) return res.status(400).json({ error: calc.error });
  res.json({ ...calc, paymentMethod: order.payment_method || null, hasAccount: !!order.user_id, pointsEarned: Number(order.points_earned) || 0 });
});

router.post("/api/admin/refunds", requireAdmin, async (req, res) => {
  const { orderNo, returnId, lines, kind, fault, shippingDeduction, amount, restock, reason } = req.body || {};
  const order = await loadOrder(orderNo);
  if (!order) return res.status(404).json({ error: "존재하지 않는 주문입니다." });
  const refundKind = kind === "partial_cancel" ? "partial_cancel" : "return";
  if (!kindAllowedForStatus(refundKind, order.status)) {
    return res.status(409).json({ error: refundKind === "partial_cancel" ? "부분 취소는 출고 전(입금확인) 주문만 할 수 있습니다." : "결제가 확인된 주문만 환불할 수 있습니다." });
  }

  let returnRequest = null;
  if (returnId) {
    const { data } = await supabaseAdmin.from("return_requests").select("*").eq("id", returnId).maybeSingle();
    if (!data || data.order_no !== order.order_no) return res.status(404).json({ error: "반품 신청을 찾을 수 없습니다." });
    if ((data.request_type || "return") !== "return") return res.status(400).json({ error: "교환·주문취소 신청은 이 환불 처리 대상이 아닙니다." });
    if (data.refunded) return res.status(409).json({ error: "이미 환불 처리한 반품 신청입니다." });
    returnRequest = data;
  }

  const reasonText = String(reason || "").trim().slice(0, 200) || (refundKind === "return" ? "반품 환불" : "부분 취소");
  const result = await executeRefund(
    { db: supabaseAdmin, portone, logInventoryChange },
    {
      order, selection: lines, kind: refundKind, fault, shippingDeduction, amountOverride: amount,
      restock: restock !== false, reason: reasonText, returnRequestId: returnRequest ? returnRequest.id : null,
      adminEmail: req.user.email || null, shippingFee: SITE.shipping.fee,
    }
  );
  if (!result.ok) {
    if (result.cardError) {
      logSystemError("refund_failed", { orderNo: order.order_no, error: result.cardError, source: refundKind });
      sendAdminRefundFailed({ orderNo: order.order_no, amount: null, error: result.cardError }).catch(() => {});
    }
    return res.status(result.status || 500).json({ error: result.error });
  }
  const refund = result.refund;

  if (returnRequest) {
    await updateWithOptionalColumnFallback("return_requests", "id", returnRequest.id, { status: "완료", refunded: true, restocked: !!refund.restocked || !!returnRequest.restocked }, []);
  }
  // 출고 전 부분 취소로 남은 상품까지 전부 취소됐다면 주문 자체를 "취소"로 — 돈·재고·적립금은 위에서 이미 정리됐다.
  if (refundKind === "partial_cancel" && refund.isAllRemaining) {
    await supabaseAdmin.from("orders").update({ status: "취소", cancel_reason: "전체 상품 부분 취소" }).eq("order_no", order.order_no).eq("status", order.status);
  }

  sendCustomerRefundIssued(order, refund).catch((err) => console.error("[mailer] 환불 안내 메일 발송 실패:", err.message));
  if (refund.refund_amount > 0 && order.customer) {
    kakao.sendAlimtalk("REFUND_COMPLETED", order.customer.tel, { name: order.customer.name, orderNo: order.order_no, amount: refund.refund_amount }).catch(() => {});
  }
  logAdminAction(req, refundKind === "return" ? "order.return_refund" : "order.partial_cancel", "order", order.order_no, {
    amount: refund.refund_amount, method: refund.method, lines: refund.lines.map((l) => `${l.name}×${l.qty}`),
    shippingDeduction: refund.shipping_deduction, pointsRestored: refund.points_restored, pointsReclaimed: refund.points_reclaimed,
    returnId: returnRequest ? returnRequest.id : null,
  });
  res.json({ ok: true, refund });
});

/* 교환 상품 재발송 — 운송장을 저장하고 상태를 "재발송"으로, 고객에게 안내 메일. 환불은 절대 없다.
   reship_* 컬럼(043)이 아직 없으면 운송장 정보를 내부 메모 끝에 붙여 남긴다(정보가 사라지지 않게). */
router.post("/api/admin/returns/:id/reship", requireAdmin, async (req, res) => {
  const courier = String((req.body || {}).courier || "").trim();
  const trackingNo = String((req.body || {}).trackingNo || "").trim().slice(0, 60);
  if (!COURIERS.some((c) => c.key === courier)) return res.status(400).json({ error: "택배사를 선택해 주세요." });
  if (!trackingNo) return res.status(400).json({ error: "운송장번호를 입력해 주세요." });

  const { data: rr } = await supabaseAdmin.from("return_requests").select("*").eq("id", req.params.id).maybeSingle();
  if (!rr) return res.status(404).json({ error: "신청을 찾을 수 없습니다." });
  if ((rr.request_type || "return") !== "exchange") return res.status(400).json({ error: "교환 신청에서만 재발송할 수 있습니다." });

  const reshipNote = `[재발송] ${COURIERS.find((c) => c.key === courier).label} ${trackingNo}`;
  let { data: saved, error } = await supabaseAdmin
    .from("return_requests")
    .update({ status: "재발송", reship_courier: courier, reship_tracking_no: trackingNo, reshipped_at: new Date().toISOString() })
    .eq("id", rr.id)
    .select()
    .maybeSingle();
  if (error) {
    ({ data: saved, error } = await updateWithOptionalColumnFallback("return_requests", "id", rr.id, {
      status: "재발송",
      internal_note: [rr.internal_note, reshipNote].filter(Boolean).join("\n").slice(0, 2000),
    }));
  }
  if (error || !saved) return res.status(500).json({ error: "저장에 실패했습니다." });

  const order = await loadOrder(rr.order_no);
  if (order) {
    sendCustomerExchangeShipped(order, { courier, trackingNo }).catch((err) => console.error("[mailer] 교환 발송 안내 메일 실패:", err.message));
  }
  logAdminAction(req, "return.reship", "return", rr.id, { orderNo: rr.order_no, courier, trackingNo });
  res.json({ ok: true, item: { id: saved.id, status: saved.status, reshipCourier: courier, reshipTrackingNo: trackingNo } });
});

module.exports = router;
