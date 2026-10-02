/* ---------- 부분 반품·부분 취소 환불 계산 + 실행 ----------
   2026-10-02 사용자 요청(반품 환불이 항상 배송비 포함 전액이던 문제, 교환 "완료"가 전액 환불을
   내보내던 문제, 반품 시 적립금이 회수되지 않던 문제)으로 새로 만든 공용 모듈. 반품 환불(Works
   반품 탭)과 부분 취소(Works 주문 상세)가 이 파일 하나로 금액을 계산하고 실행한다 — 화면은 미리보기
   (computeRefund 결과)를 보여주고, 실행(executeRefund)은 같은 계산을 서버에서 다시 한다(화면 값 신뢰 X).

   금액 규칙(소규모 의류몰에서 흔한 방식):
   · 상품 환불액 = (상품 합계 − 쿠폰 할인 − 적립금 사용) × (고른 상품 금액 ÷ 상품 합계) — 할인을 비율대로 나눠 뺀다
   · 적립금 사용분도 같은 비율로 적립금으로 돌려준다(현금으로 바꿔주지 않음)
   · 고객 사유(단순변심) 반품은 반품 배송비를 뺀다 — 처음에 배송비를 냈으면 편도(3,500원), 무료배송이었으면
     왕복(7,000원, 무료배송 혜택이 사라지므로). 판매자 사유(불량·오배송)는 차감 없음, 전부 반품이면 처음 낸 배송비도 환불
   · 마지막 남은 수량까지 환불하는 경우엔 비율 반올림 오차가 남지 않게 "남은 금액 전부"로 맞춘다
   · 이미 환불한 금액을 포함해 결제 금액(total)을 넘게 환불할 수 없다 */
const { isMissingSchemaError, isMissingColumnError } = require("./pgErrors");

const REFUND_KINDS = ["return", "partial_cancel"];
const FAULTS = ["customer", "seller"];

function refundedQtyByIndex(previousRefunds) {
  const map = new Map();
  for (const r of previousRefunds || []) {
    for (const ln of r.lines || []) {
      map.set(ln.index, (map.get(ln.index) || 0) + (Number(ln.qty) || 0));
    }
  }
  return map;
}

function sumOf(rows, key) {
  return (rows || []).reduce((s, r) => s + (Number(r[key]) || 0), 0);
}

/* order: orders 행(items/subtotal/shipping/discount/points_used/total/refunded_amount)
   previousRefunds: order_refunds 행 목록(lines, goods_amount, points_restored, refund_amount)
   selection: [{ index, qty }] — order.items 배열의 위치와 수량
   opts: { kind, fault, shippingFee, shippingDeduction(관리자가 직접 입력한 값, 없으면 기본값) }
   반환: { error } 또는 계산 결과(아무것도 실행하지 않는 순수 함수) */
function computeRefund(order, previousRefunds, selection, opts = {}) {
  const kind = REFUND_KINDS.includes(opts.kind) ? opts.kind : "return";
  const fault = FAULTS.includes(opts.fault) ? opts.fault : "customer";
  const items = Array.isArray(order && order.items) ? order.items : [];
  if (!items.length) return { error: "주문 상품 정보를 찾을 수 없습니다." };
  if (!Array.isArray(selection) || !selection.length) return { error: "환불할 상품과 수량을 골라 주세요." };

  const already = refundedQtyByIndex(previousRefunds);
  const merged = new Map();
  for (const s of selection) {
    const index = Number(s && s.index);
    const qty = Math.floor(Number(s && s.qty));
    if (!Number.isInteger(index) || index < 0 || index >= items.length) return { error: "존재하지 않는 주문 상품입니다." };
    if (!Number.isFinite(qty) || qty < 1) continue;
    merged.set(index, (merged.get(index) || 0) + qty);
  }
  if (!merged.size) return { error: "환불할 상품과 수량을 골라 주세요." };

  const lines = [];
  for (const [index, qty] of merged) {
    const it = items[index];
    const remaining = (Number(it.qty) || 0) - (already.get(index) || 0);
    if (qty > remaining) {
      const n = Math.max(0, remaining);
      return { error: `'${it.name}'은(는) 최대 ${n}개까지 환불할 수 있습니다.`, i18n: { key: "'{name}'은(는) 최대 {n}개까지 환불할 수 있습니다.", vars: { name: it.name, n } } };
    }
    const unit = Number(it.unit) || (Number(it.sum) || 0) / Math.max(1, Number(it.qty) || 1);
    lines.push({
      index, qty, unit, amount: Math.round(unit * qty),
      name: it.name || "", options: it.options || "",
      productId: it.productId || null, size: it.size || null, color: it.color || null,
    });
  }
  lines.sort((a, b) => a.index - b.index);

  const subtotal = Number(order.subtotal) || items.reduce((s, it) => s + (Number(it.sum) || 0), 0);
  const discount = Number(order.discount) || 0;
  const pointsUsed = Number(order.points_used) || 0;
  const shipping = Number(order.shipping) || 0;
  const total = Number(order.total) || 0;
  const refundedSoFar = Number(order.refunded_amount) || sumOf(previousRefunds, "refund_amount");

  const selectedSum = lines.reduce((s, ln) => s + ln.amount, 0);
  const isAllRemaining = items.every((it, i) => {
    const left = (Number(it.qty) || 0) - (already.get(i) || 0) - (merged.get(i) || 0);
    return left <= 0;
  });

  const cashGoodsTotal = Math.max(0, subtotal - discount - pointsUsed);
  const ratio = subtotal > 0 ? selectedSum / subtotal : 0;
  const goodsRefund = isAllRemaining
    ? Math.max(0, cashGoodsTotal - sumOf(previousRefunds, "goods_amount"))
    : Math.min(cashGoodsTotal, Math.round(cashGoodsTotal * ratio));
  const pointsRestore = isAllRemaining
    ? Math.max(0, pointsUsed - sumOf(previousRefunds, "points_restored"))
    : Math.min(pointsUsed, Math.round(pointsUsed * ratio));

  const shippingFee = Number(opts.shippingFee) || 0;
  let defaultDeduction = 0;
  let shippingRefund = 0;
  if (kind === "return" && fault === "customer") {
    defaultDeduction = shipping > 0 ? shippingFee : shippingFee * 2;
  } else if (isAllRemaining && !(previousRefunds || []).some((r) => (r.shipping_refund || 0) > 0)) {
    // 판매자 사유로 전부 반품하거나, 출고 전 마지막 남은 상품까지 부분 취소하면 처음 낸 배송비도 돌려준다.
    shippingRefund = shipping;
  }
  const rawDeduction = opts.shippingDeduction;
  const shippingDeduction = rawDeduction === undefined || rawDeduction === null || rawDeduction === ""
    ? defaultDeduction
    : Math.max(0, Math.floor(Number(rawDeduction)) || 0);

  const maxRefundable = Math.max(0, total - refundedSoFar);
  const refundCash = Math.min(maxRefundable, Math.max(0, goodsRefund + shippingRefund - shippingDeduction));

  return {
    kind, fault, lines, selectedSum, ratio, isAllRemaining,
    goodsRefund, pointsRestore, shippingRefund, shippingDeduction, defaultDeduction,
    refundCash, maxRefundable, refundedSoFar,
  };
}

/* 이 주문으로 실제로 적립(earn_purchase)된 포인트 중 아직 회수하지 않은 양 — 구매확정 전이면 0. */
async function creditedEarnRemaining(db, order, previousRefunds) {
  if (!order.user_id) return 0;
  const { data, error } = await db.from("loyalty_points_ledger").select("delta").eq("order_no", order.order_no).eq("reason", "earn_purchase");
  if (error) return 0;
  const credited = (data || []).reduce((s, r) => s + (Number(r.delta) || 0), 0);
  return Math.max(0, credited - sumOf(previousRefunds, "points_reclaimed"));
}

async function loadPreviousRefunds(db, orderNo) {
  const { data, error } = await db.from("order_refunds").select("*").eq("order_no", orderNo);
  if (error) return { rows: [], tableMissing: isMissingSchemaError(error) || isMissingColumnError(error) };
  return { rows: data || [], tableMissing: false };
}

/* 실제 실행 — 순서가 중요하다: ① 카드 환불(외부 PG) → 실패하면 아무것도 바꾸지 않고 끝(관리자가 다시 시도 가능)
   ② 성공(또는 무통장처럼 수동 환불)이면 재고 복원·적립금 정리·기록. deps로 db/portone/로그 함수를 받는다(테스트 주입용). */
async function executeRefund(deps, params) {
  const { db, portone, logInventoryChange = () => {}, now = () => new Date() } = deps;
  const { order, selection, kind, fault, shippingDeduction, amountOverride, restock = true, reason, returnRequestId = null, adminEmail = null, shippingFee } = params;

  const { rows: previousRefunds, tableMissing } = await loadPreviousRefunds(db, order.order_no);
  const calc = computeRefund(order, previousRefunds, selection, { kind, fault, shippingDeduction, shippingFee });
  if (calc.error) return { ok: false, status: 400, error: calc.error, i18n: calc.i18n };

  let refundCash = calc.refundCash;
  if (amountOverride !== undefined && amountOverride !== null && amountOverride !== "") {
    const v = Math.floor(Number(amountOverride));
    if (!Number.isFinite(v) || v < 0) return { ok: false, status: 400, error: "환불 금액이 올바르지 않습니다." };
    if (v > calc.maxRefundable) {
      const amount = calc.maxRefundable.toLocaleString("ko-KR");
      return { ok: false, status: 400, error: `환불 가능한 최대 금액(${amount}원)을 넘었습니다.`, i18n: { key: "환불 가능한 최대 금액({amount}원)을 넘었습니다.", vars: { amount } } };
    }
    refundCash = v;
  }

  // ① 결제 환불
  let method = "none";
  let paymentCancelled = false;
  const paid = order.status !== "입금대기" && order.status !== "취소";
  if (!paid) return { ok: false, status: 409, error: "결제가 확인된 주문만 환불할 수 있습니다." };
  if (refundCash > 0) {
    if (order.payment_method === "card" && order.payment_id) {
      method = "card";
      try {
        await portone.cancelPayment(order.payment_id, reason || (kind === "return" ? "반품 환불" : "부분 취소"), {
          amount: refundCash,
          currentCancellableAmount: Math.max(0, (Number(order.total) || 0) - calc.refundedSoFar),
        });
        paymentCancelled = true;
      } catch (e) {
        const reason = e.message || "PG 오류";
        return { ok: false, status: 502, error: `카드 환불에 실패했습니다: ${reason}`, i18n: { key: "카드 환불에 실패했습니다: {reason}", vars: { reason } }, method, cardError: e.message || String(e) };
      }
    } else if (order.payment_method === "virtual_account") {
      method = "virtual_account_manual";
    } else {
      method = "bank_manual";
    }
  }

  // ② 재고 복원(실물 상품만)
  let restocked = false;
  if (restock) {
    const restoreItems = calc.lines
      .filter((ln) => ln.productId && ln.size && !String(ln.productId).startsWith("charm-"))
      .map((ln) => ({ productId: ln.productId, color: ln.color || "", size: ln.size, qty: ln.qty }));
    if (restoreItems.length) {
      const { error } = await db.rpc("restore_inventory", { p_items: restoreItems });
      if (!error) {
        restocked = true;
        logInventoryChange(restoreItems.map((it) => ({ ...it, delta: it.qty, reason: kind === "return" ? "return_restock" : "partial_cancel", ref: order.order_no })));
      }
    }
  }

  // ③ 적립금 — 사용분은 비율만큼 돌려주고, 이미 적립된 포인트는 비율만큼 회수(구매확정 전이면 적립 예정액만 줄인다)
  let pointsRestored = 0;
  let pointsReclaimed = 0;
  let pendingEarnReduced = 0;
  if (order.user_id) {
    if (calc.pointsRestore > 0) {
      const { error } = await db.from("loyalty_points_ledger").insert({ user_id: order.user_id, order_no: order.order_no, delta: calc.pointsRestore, reason: "refund_reversal" });
      if (!error) pointsRestored = calc.pointsRestore;
    }
    const earned = Number(order.points_earned) || 0;
    const creditedLeft = await creditedEarnRemaining(db, order, previousRefunds);
    if (creditedLeft > 0) {
      const reclaim = calc.isAllRemaining ? creditedLeft : Math.min(creditedLeft, Math.round(earned * calc.ratio));
      if (reclaim > 0) {
        const { error } = await db.from("loyalty_points_ledger").insert({ user_id: order.user_id, order_no: order.order_no, delta: -reclaim, reason: "refund_reversal" });
        if (!error) pointsReclaimed = reclaim;
      }
    } else if (earned > 0) {
      pendingEarnReduced = calc.isAllRemaining ? earned : Math.min(earned, Math.round(earned * calc.ratio));
      if (pendingEarnReduced > 0) {
        await db.from("orders").update({ points_earned: earned - pendingEarnReduced }).eq("order_no", order.order_no);
      }
    }
  }

  // ④ 기록 — order_refunds(043)와 orders.refunded_amount. 테이블이 없으면 기록만 건너뛴다(환불 자체는 이미 끝남).
  const record = {
    order_no: order.order_no,
    kind,
    return_request_id: returnRequestId,
    lines: calc.lines.map(({ index, qty, unit, name, options, productId, size, color }) => ({ index, qty, unit, name, options, productId, size, color })),
    goods_amount: calc.goodsRefund,
    shipping_refund: calc.shippingRefund,
    shipping_deduction: calc.shippingDeduction,
    refund_amount: refundCash,
    points_restored: pointsRestored,
    points_reclaimed: pointsReclaimed,
    method,
    payment_cancelled: paymentCancelled,
    restocked,
    fault: calc.fault,
    admin_email: adminEmail,
    note: reason || null,
    created_at: now().toISOString(),
  };
  if (!tableMissing) {
    const { error } = await db.from("order_refunds").insert(record);
    if (error) console.error("[refunds] 환불 기록 저장 실패:", error.message);
  }
  if (refundCash > 0) {
    const { error } = await db.from("orders").update({ refunded_amount: calc.refundedSoFar + refundCash }).eq("order_no", order.order_no);
    if (error && !isMissingColumnError(error)) console.error("[refunds] 주문 환불액 갱신 실패:", error.message);
  }

  return {
    ok: true,
    refund: { ...record, isAllRemaining: calc.isAllRemaining, pendingEarnReduced, recordSaved: !tableMissing },
  };
}

module.exports = { computeRefund, executeRefund, loadPreviousRefunds, refundedQtyByIndex, REFUND_KINDS, FAULTS };
