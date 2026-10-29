/* lib/refunds.js — 부분 반품·부분 취소 환불 금액 계산(순수 함수)과 실행(가짜 DB·가짜 PG). */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { computeRefund, executeRefund } = require("../lib/refunds");
const { supabaseAdmin } = require("../lib/supabase");

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

const FEE = 3500;
function order(overrides = {}) {
  return {
    order_no: "R261002-000001",
    status: "완료",
    payment_method: "card",
    payment_id: "pay-1",
    user_id: "u1",
    items: [
      { name: "후디", options: "블랙 / M", productId: "hoodie", size: "M", color: "black", qty: 1, unit: 60000, sum: 60000 },
      { name: "집업", options: "화이트 / L", productId: "zip", size: "L", color: "white", qty: 1, unit: 60000, sum: 60000 },
    ],
    subtotal: 120000,
    shipping: 0,
    discount: 10000,
    points_used: 5000,
    points_earned: 1050,
    total: 105000,
    refunded_amount: 0,
    ...overrides,
  };
}

test("단순변심 부분 반품(무료배송 주문) — 할인·적립금을 비율대로 빼고 왕복 배송비 차감", () => {
  const r = computeRefund(order(), [], [{ index: 0, qty: 1 }], { kind: "return", fault: "customer", shippingFee: FEE });
  assert.equal(r.goodsRefund, 52500); // (120000-10000-5000) × 0.5
  assert.equal(r.pointsRestore, 2500);
  assert.equal(r.shippingDeduction, 7000);
  assert.equal(r.refundCash, 45500);
  assert.equal(r.isAllRemaining, false);
});

test("판매자 사유 전체 반품 — 차감 없음, 처음 낸 배송비까지 환불해 결제액 전부", () => {
  const o = order({ shipping: FEE, total: 108500 });
  const r = computeRefund(o, [], [{ index: 0, qty: 1 }, { index: 1, qty: 1 }], { kind: "return", fault: "seller", shippingFee: FEE });
  assert.equal(r.shippingDeduction, 0);
  assert.equal(r.shippingRefund, FEE);
  assert.equal(r.refundCash, 108500);
  assert.equal(r.pointsRestore, 5000);
});

test("배송비를 낸 주문의 단순변심 반품은 편도 배송비만 차감, 관리자가 직접 입력한 차감액이 우선", () => {
  const o = order({ shipping: FEE, total: 108500 });
  assert.equal(computeRefund(o, [], [{ index: 1, qty: 1 }], { kind: "return", fault: "customer", shippingFee: FEE }).shippingDeduction, FEE);
  assert.equal(computeRefund(o, [], [{ index: 1, qty: 1 }], { kind: "return", fault: "customer", shippingFee: FEE, shippingDeduction: 0 }).shippingDeduction, 0);
});

test("두 번에 나눠 환불해도 합계가 정확히 맞는다(반올림 오차 없음)", () => {
  const o = order({ items: [
    { name: "A", productId: "a", size: "M", qty: 3, unit: 33333, sum: 99999 },
  ], subtotal: 99999, discount: 1001, points_used: 7, total: 98991 });
  const first = computeRefund(o, [], [{ index: 0, qty: 1 }], { kind: "partial_cancel", shippingFee: FEE });
  const prev = [{ lines: first.lines, goods_amount: first.goodsRefund, points_restored: first.pointsRestore, refund_amount: first.refundCash }];
  const second = computeRefund({ ...o, refunded_amount: first.refundCash }, prev, [{ index: 0, qty: 2 }], { kind: "partial_cancel", shippingFee: FEE });
  assert.equal(second.isAllRemaining, true);
  assert.equal(first.goodsRefund + second.goodsRefund, 99999 - 1001 - 7);
  assert.equal(first.pointsRestore + second.pointsRestore, 7);
});

test("남은 수량보다 많이 고르거나 아무것도 안 고르면 거절", () => {
  const prev = [{ lines: [{ index: 0, qty: 1 }], goods_amount: 1, points_restored: 0, refund_amount: 1 }];
  const over = computeRefund(order(), prev, [{ index: 0, qty: 1 }], { kind: "return" });
  assert.match(over.error, /최대 0개/);
  // 독일어 직원 화면에서도 번역되도록 번역 키·변수를 같이 내려준다
  assert.equal(over.i18n.key, "'{name}'은(는) 최대 {n}개까지 환불할 수 있습니다.");
  assert.equal(over.i18n.vars.n, 0);
  assert.match(computeRefund(order(), [], [], { kind: "return" }).error, /골라/);
  assert.match(computeRefund(order(), [], [{ index: 9, qty: 1 }], { kind: "return" }).error, /존재하지 않는/);
});

test("이미 환불한 금액을 포함해 결제액을 넘게 환불할 수 없다", () => {
  const r = computeRefund(order({ refunded_amount: 100000 }), [], [{ index: 0, qty: 1 }, { index: 1, qty: 1 }], { kind: "return", fault: "seller", shippingFee: FEE });
  assert.equal(r.maxRefundable, 5000);
  assert.equal(r.refundCash, 5000);
});

/* ---------- 실행(executeRefund) ---------- */
let cancelCalls;
const fakePortone = {
  async cancelPayment(paymentId, reason, opts) { cancelCalls.push({ paymentId, reason, ...opts }); },
};

beforeEach(() => {
  cancelCalls = [];
  supabaseAdmin.__reset({ orders: [order()], order_refunds: [], loyalty_points_ledger: [{ user_id: "u1", order_no: "R261002-000001", delta: -5000, reason: "redeem_order" }] });
});

test("executeRefund — 카드 부분 환불은 그 금액만 PG에 취소 요청하고, 적립금 사용분을 돌려주고 기록을 남긴다", async () => {
  const res = await executeRefund({ db: supabaseAdmin, portone: fakePortone }, {
    order: order(), selection: [{ index: 0, qty: 1 }], kind: "return", fault: "customer", shippingFee: FEE, restock: false,
  });
  assert.equal(res.ok, true);
  assert.equal(cancelCalls.length, 1);
  assert.equal(cancelCalls[0].amount, 45500);
  assert.equal(cancelCalls[0].currentCancellableAmount, 105000);
  const ledger = (await supabaseAdmin.from("loyalty_points_ledger").select("*")).data;
  assert.ok(ledger.some((r) => r.delta === 2500 && r.reason === "refund_reversal"), "사용 적립금 비율만큼 반환");
  const rec = (await supabaseAdmin.from("order_refunds").select("*")).data;
  assert.equal(rec.length, 1);
  assert.equal(rec[0].refund_amount, 45500);
  // 구매확정 전(적립 전)이면 적립 예정액만 줄인다
  const saved = (await supabaseAdmin.from("orders").select("*").eq("order_no", "R261002-000001").maybeSingle()).data;
  assert.equal(saved.points_earned, 1050 - 525);
});

test("executeRefund — 이미 적립된 포인트는 비율만큼 회수한다", async () => {
  supabaseAdmin.__reset({ orders: [order()], order_refunds: [], loyalty_points_ledger: [
    { user_id: "u1", order_no: "R261002-000001", delta: 1050, reason: "earn_purchase" },
  ] });
  const res = await executeRefund({ db: supabaseAdmin, portone: fakePortone }, {
    order: order(), selection: [{ index: 1, qty: 1 }], kind: "return", fault: "seller", shippingFee: FEE, restock: false,
  });
  assert.equal(res.ok, true);
  assert.equal(res.refund.points_reclaimed, 525);
});

test("executeRefund — 카드 환불이 실패하면 재고·적립금·기록을 하나도 바꾸지 않는다", async () => {
  const failing = { async cancelPayment() { throw new Error("PG 점검 중"); } };
  const res = await executeRefund({ db: supabaseAdmin, portone: failing }, {
    order: order(), selection: [{ index: 0, qty: 1 }], kind: "return", fault: "customer", shippingFee: FEE,
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /PG 점검 중/);
  assert.equal((await supabaseAdmin.from("order_refunds").select("*")).data.length, 0);
  assert.equal((await supabaseAdmin.from("loyalty_points_ledger").select("*")).data.length, 1);
});

test("executeRefund — 무통장입금은 PG 호출 없이 '직접 송금' 방식으로 기록", async () => {
  const o = order({ payment_method: "bank_transfer", payment_id: null });
  const res = await executeRefund({ db: supabaseAdmin, portone: fakePortone }, {
    order: o, selection: [{ index: 0, qty: 1 }], kind: "return", fault: "customer", shippingFee: FEE, restock: false,
  });
  assert.equal(res.ok, true);
  assert.equal(res.refund.method, "bank_manual");
  assert.equal(cancelCalls.length, 0);
});

test("executeRefund — 입금 전 주문은 환불 대상이 아니다", async () => {
  const res = await executeRefund({ db: supabaseAdmin, portone: fakePortone }, {
    order: order({ status: "입금대기" }), selection: [{ index: 0, qty: 1 }], kind: "partial_cancel", shippingFee: FEE,
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
});
