/* 주문 취소 후속 처리 — server.js(관리자 주문취소)와 routes/returns.js(고객 주문취소 신청 승인)가 같이 쓴다.
   server.js 안에 있으면 테스트할 수 없어 lib로 옮겼다(2026-10-02). 아래 함수 설명 참고. */
const { supabaseAdmin } = require("./supabase");
const portone = require("./portone");
const kakao = require("./kakao");
const { restoreItemsFromOrder } = require("./inventory");
const { loadPreviousRefunds } = require("./refunds");
const { reversePointsForOrder } = require("./loyaltyPoints");
const { logInventoryChange, logSystemError } = require("./adminLog");
const { isMissingColumnError } = require("./pgErrors");
const { sendAdminRefundFailed, sendCustomerOrderCancelled } = require("./mailer");

/* ---------- 주문 취소 후속 처리(공용) ----------
   주문이 처음으로 "취소"가 되는 순간 필요한 일 — ① 재고 복원 ② 적립금 되돌리기 ③ 결제 환불(카드·입금된 가상계좌)
   또는 가상계좌 폐쇄 ④ 고객 안내 메일·알림톡. 관리자가 주문 상세에서 취소할 때(PATCH /api/admin/orders/:no)와
   고객의 "주문취소 신청"을 승인할 때(PATCH /api/admin/returns/:id, 2026-10-02) 둘 다 이 함수 하나만 부른다 —
   예전엔 취소 신청을 "완료"로 바꾸면 반품 환불 로직을 타서 카드 환불만 나가고 주문은 그대로(재고 미복원,
   출고 가능 상태) 남는 사고가 있었다.
   부분 반품·부분 취소(lib/refunds.js)로 이미 처리한 몫은 빼고 처리한다: 이미 복원한 재고 수량은 다시 복원하지
   않고, PG는 "남은 금액 전액" 취소만 요청하며, 적립금은 이미 돌려준/회수한 만큼을 상쇄한다. */
async function applyOrderCancelSideEffects(saved, prevStatus, cancelReasonStr) {
  let cancelResult = null;
  const { rows: prevRefunds } = await loadPreviousRefunds(supabaseAdmin, saved.order_no);

  const restockedQty = new Map();
  for (const r of prevRefunds) {
    if (!r.restocked) continue;
    for (const ln of r.lines || []) restockedQty.set(ln.index, (restockedQty.get(ln.index) || 0) + (Number(ln.qty) || 0));
  }
  const remainingItems = (saved.items || [])
    .map((it, i) => ({ ...it, qty: (Number(it.qty) || 0) - (restockedQty.get(i) || 0) }))
    .filter((it) => it.qty > 0);
  const restoreItems = restoreItemsFromOrder(remainingItems);
  if (restoreItems.length) {
    const { error: restoreError } = await supabaseAdmin.rpc("restore_inventory", { p_items: restoreItems });
    if (restoreError) {
      console.error("[admin/orders] 취소 시 재고 복원 실패:", saved.order_no, restoreError.message);
    } else {
      logInventoryChange(
        restoreItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: it.qty, reason: "admin_cancel", ref: saved.order_no }))
      );
    }
  }
  // 재고 복원과 같은 원칙 — 이 주문으로 적립된 포인트는 회수하고, 사용한 포인트는 되돌려준다.
  if (saved.points_used || saved.points_earned) {
    try {
      await reversePointsForOrder(supabaseAdmin, saved.order_no);
      // 부분 환불 때 이미 돌려준 사용분(+)·회수한 적립분(−)은 위 전체 되돌리기와 겹치므로 상쇄한다.
      const restored = prevRefunds.reduce((sum, r) => sum + (Number(r.points_restored) || 0), 0);
      const reclaimed = prevRefunds.reduce((sum, r) => sum + (Number(r.points_reclaimed) || 0), 0);
      if (saved.user_id && restored - reclaimed !== 0) {
        await supabaseAdmin.from("loyalty_points_ledger").insert({ user_id: saved.user_id, order_no: saved.order_no, delta: reclaimed - restored, reason: "refund_reversal" });
      }
    } catch (err) {
      console.error("[points] 취소 시 되돌리기 실패:", err.message);
    }
  }

  const alreadyRefunded = Number(saved.refunded_amount) || prevRefunds.reduce((sum, r) => sum + (Number(r.refund_amount) || 0), 0);
  const remainingAmount = Math.max(0, (Number(saved.total) || 0) - alreadyRefunded);
  const wasPaid = prevStatus !== "입금대기";

  if (saved.payment_method === "card" && saved.payment_id) {
    if (remainingAmount <= 0) {
      cancelResult = { refund: "card", ok: true, amount: 0 };
    } else {
      try {
        await portone.cancelPayment(saved.payment_id, cancelReasonStr || "관리자 주문 취소");
        cancelResult = { refund: "card", ok: true, amount: remainingAmount };
      } catch (refundErr) {
        console.error("[admin/orders] ⚠️ 취소 시 환불 실패 — 수동 확인 필요:", saved.order_no, refundErr.message);
        sendAdminRefundFailed({ orderNo: saved.order_no, amount: remainingAmount, error: refundErr.message }).catch((err) =>
          console.error("[mailer] 환불 실패 긴급 알림 메일 발송 실패:", err.message)
        );
        logSystemError("refund_failed", { orderNo: saved.order_no, amount: remainingAmount, error: refundErr.message, source: "order_cancel" });
        cancelResult = { refund: "card", ok: false, amount: remainingAmount };
      }
    }
  } else if (saved.payment_method === "virtual_account" && saved.payment_id && prevStatus === "입금대기") {
    /* 아직 입금 전(입금대기)이었다면 돈이 오간 적이 없으므로 계좌를 "폐쇄"만 하면 된다.
       이미 입금 확인된(입금확인) 뒤의 취소는 실제로 받은 돈을 환불해야 하므로, 카드결제와
       똑같이 cancelPayment로 처리한다 — 포트원 취소 API는 결제수단과 무관하게 이미 결제
       완료된 건이면 동일하게 동작한다(closeVirtualAccount를 여기서 잘못 쓰면 계좌만 닫히고
       환불은 안 나가는, 오히려 더 위험한 상태가 된다). */
    try {
      await portone.closeVirtualAccount(saved.payment_id);
      cancelResult = { refund: "virtual_account_closed", ok: true };
    } catch (closeErr) {
      console.error("[admin/orders] ⚠️ 취소 시 가상계좌 폐쇄 실패 — 수동 확인 필요:", saved.order_no, closeErr.message);
      sendAdminRefundFailed({ orderNo: saved.order_no, amount: saved.total, error: closeErr.message }).catch((err) =>
        console.error("[mailer] 환불 실패 긴급 알림 메일 발송 실패:", err.message)
      );
      logSystemError("virtual_account_close_failed", { orderNo: saved.order_no, amount: saved.total, error: closeErr.message, source: "order_cancel" });
      cancelResult = { refund: "virtual_account_closed", ok: false };
    }
  } else if (saved.payment_method === "virtual_account" && saved.payment_id) {
    try {
      await portone.cancelPayment(saved.payment_id, cancelReasonStr || "관리자 주문 취소");
      cancelResult = { refund: "virtual_account", ok: true, amount: remainingAmount };
    } catch (refundErr) {
      console.error("[admin/orders] ⚠️ 취소 시 환불 실패 — 수동 확인 필요:", saved.order_no, refundErr.message);
      sendAdminRefundFailed({ orderNo: saved.order_no, amount: remainingAmount, error: refundErr.message }).catch((err) =>
        console.error("[mailer] 환불 실패 긴급 알림 메일 발송 실패:", err.message)
      );
      logSystemError("refund_failed", { orderNo: saved.order_no, amount: remainingAmount, error: refundErr.message, source: "order_cancel" });
      cancelResult = { refund: "virtual_account", ok: false, amount: remainingAmount };
    }
  } else if (saved.payment_method === "bank_transfer" || !saved.payment_method) {
    cancelResult = { refund: wasPaid ? "bank_manual" : "none", ok: !wasPaid, amount: wasPaid ? remainingAmount : 0 };
  }

  // 입금된 주문이면 취소로 돌려줄(또는 돌려준) 금액까지 환불액으로 기록해 정산·대시보드가 맞게 한다(043).
  const refundFailed = !!(cancelResult && cancelResult.ok === false && cancelResult.refund !== "bank_manual");
  if (wasPaid && remainingAmount > 0 && !refundFailed) {
    const { error } = await supabaseAdmin.from("orders").update({ refunded_amount: Number(saved.total) || 0 }).eq("order_no", saved.order_no);
    if (error && !isMissingColumnError(error)) console.error("[admin/orders] 환불액 기록 실패:", error.message);
  }

  sendCustomerOrderCancelled(saved, cancelReasonStr).catch((err) =>
    console.error("[mailer] 주문취소 안내 메일 발송 실패:", err.message)
  );
  kakao.sendAlimtalk("ORDER_CANCELLED", saved.customer.tel, { name: saved.customer.name, orderNo: saved.order_no }).catch(() => {});
  return cancelResult;
}

module.exports = { applyOrderCancelSideEffects };
