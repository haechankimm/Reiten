/* routes/refunds.js — 환불 미리보기·실행, 반품 신청 연동, 출고 전 부분 취소, 교환 재발송. */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const { MASTER_ADMIN_EMAIL } = require("../lib/auth");
const portone = require("../lib/portone");
const refundsRouter = require("../routes/refunds");

const MASTER = { id: "master-1", email: MASTER_ADMIN_EMAIL };
const auth = { Authorization: `Bearer ${fakeAdminToken(MASTER.id, MASTER.email)}` };
let cancelCalls = [];
const realCancel = portone.cancelPayment;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(refundsRouter);
  return app;
}

const ITEMS = [
  { name: "후디", options: "블랙 / M", productId: "hoodie", size: "M", color: "black", qty: 2, unit: 50000, sum: 100000 },
  { name: "참", options: "", productId: "charm-heart", size: null, color: null, qty: 1, unit: 0, sum: 0 },
];

beforeEach(() => {
  cancelCalls = [];
  portone.cancelPayment = async (paymentId, reason, opts) => { cancelCalls.push({ paymentId, reason, ...(opts || {}) }); };
  supabaseAdmin.__reset({
    profiles: [{ id: MASTER.id, role: "admin" }],
    orders: [
      { order_no: "B1", status: "완료", payment_method: "bank_transfer", user_id: null, customer: { name: "A", tel: "1", email: "" }, items: ITEMS, subtotal: 100000, shipping: 0, discount: 0, points_used: 0, total: 100000, refunded_amount: 0 },
      { order_no: "C1", status: "입금확인", payment_method: "card", payment_id: "pay-c1", user_id: null, customer: { name: "B", tel: "2", email: "" }, items: ITEMS, subtotal: 100000, shipping: 0, discount: 0, points_used: 0, total: 100000, refunded_amount: 0 },
    ],
    inventory: [{ product_id: "hoodie", color: "black", size: "M", qty: 0 }],
    return_requests: [
      { id: "rt1", order_no: "B1", request_type: "return", status: "수거중", reason: "단순변심", contact_name: "A", contact_tel: "1", refunded: false },
      { id: "ex1", order_no: "B1", request_type: "exchange", status: "수거중", reason: "사이즈", contact_name: "A", contact_tel: "1", refunded: false },
    ],
    order_refunds: [],
    loyalty_points_ledger: [],
  });
});

after(() => {
  portone.cancelPayment = realCancel;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("미리보기 — 무료배송 주문 1개 단순변심 반품이면 왕복 배송비 7,000원 차감", async () => {
  const res = await request(buildApp()).post("/api/admin/refunds/preview").set(auth)
    .send({ orderNo: "B1", kind: "return", fault: "customer", lines: [{ index: 0, qty: 1 }] });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.goodsRefund, 50000);
  assert.strictEqual(res.body.shippingDeduction, 7000);
  assert.strictEqual(res.body.refundCash, 43000);
});

test("반품 환불 실행(무통장) — 반품 신청이 완료·환불됨으로 바뀌고, 고른 수량만 재고 복원, 이력에 남는다", async () => {
  const app = buildApp();
  const res = await request(app).post("/api/admin/refunds").set(auth)
    .send({ orderNo: "B1", returnId: "rt1", kind: "return", fault: "customer", lines: [{ index: 0, qty: 1 }] });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.refund.method, "bank_manual");
  assert.strictEqual(res.body.refund.refund_amount, 43000);
  assert.strictEqual(cancelCalls.length, 0);
  const rr = (await supabaseAdmin.from("return_requests").select("*").eq("id", "rt1").maybeSingle()).data;
  assert.strictEqual(rr.status, "완료");
  assert.strictEqual(rr.refunded, true);
  assert.strictEqual((await supabaseAdmin.from("inventory").select("*")).data[0].qty, 1);

  const hist = await request(app).get("/api/admin/orders/B1/refunds").set(auth);
  assert.strictEqual(hist.body.history.length, 1);
  assert.strictEqual(hist.body.lines[0].remaining, 1);
  assert.strictEqual(hist.body.refundedAmount, 43000);

  const again = await request(app).post("/api/admin/refunds").set(auth).send({ orderNo: "B1", returnId: "rt1", kind: "return", lines: [{ index: 0, qty: 1 }] });
  assert.strictEqual(again.status, 409, "같은 반품 신청은 두 번 환불할 수 없다");
});

test("교환 신청으로는 환불할 수 없다", async () => {
  const res = await request(buildApp()).post("/api/admin/refunds").set(auth)
    .send({ orderNo: "B1", returnId: "ex1", kind: "return", lines: [{ index: 0, qty: 1 }] });
  assert.strictEqual(res.status, 400);
});

test("출고 전 부분 취소(카드) — 그 금액만 PG 취소, 마지막 남은 상품까지 취소하면 주문이 '취소'로", async () => {
  const app = buildApp();
  const first = await request(app).post("/api/admin/refunds").set(auth).send({ orderNo: "C1", kind: "partial_cancel", lines: [{ index: 0, qty: 1 }] });
  assert.strictEqual(first.status, 200);
  assert.strictEqual(cancelCalls[0].amount, 50000);
  assert.strictEqual(cancelCalls[0].currentCancellableAmount, 100000);
  let order = (await supabaseAdmin.from("orders").select("*").eq("order_no", "C1").maybeSingle()).data;
  assert.strictEqual(order.status, "입금확인");
  assert.strictEqual(order.refunded_amount, 50000);

  const second = await request(app).post("/api/admin/refunds").set(auth).send({ orderNo: "C1", kind: "partial_cancel", lines: [{ index: 0, qty: 1 }, { index: 1, qty: 1 }] });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(cancelCalls[1].amount, 50000);
  order = (await supabaseAdmin.from("orders").select("*").eq("order_no", "C1").maybeSingle()).data;
  assert.strictEqual(order.status, "취소");
});

test("부분 취소는 출고 전 주문만", async () => {
  const res = await request(buildApp()).post("/api/admin/refunds").set(auth).send({ orderNo: "B1", kind: "partial_cancel", lines: [{ index: 0, qty: 1 }] });
  assert.strictEqual(res.status, 409);
});

test("교환 재발송 — 운송장 저장·상태 '재발송', 환불 없음 / 반품 신청에는 불가", async () => {
  const ok = await request(buildApp()).post("/api/admin/returns/ex1/reship").set(auth).send({ courier: "cj", trackingNo: "123456789" });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  const rr = (await supabaseAdmin.from("return_requests").select("*").eq("id", "ex1").maybeSingle()).data;
  assert.strictEqual(rr.status, "재발송");
  assert.strictEqual(rr.reship_tracking_no, "123456789");
  assert.strictEqual(cancelCalls.length, 0);
  const bad = await request(buildApp()).post("/api/admin/returns/rt1/reship").set(auth).send({ courier: "cj", trackingNo: "1" });
  assert.strictEqual(bad.status, 400);
});
