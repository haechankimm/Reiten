/* routes/returns.js — 반품·교환·주문취소 신청의 유형별 처리 규칙(2026-10-02 재설계).
   ① 교환을 "완료"로 바꿔도 환불은 절대 없다 ② 주문취소 신청을 "완료"로 바꾸면 실제 주문이 취소된다(재고 복원)
   ③ 반품 "완료"는 환불 처리를 거쳐야만 된다 ④ 출고된 주문의 취소 신청은 거절 ⑤ 유형별 상태 목록 검증 */
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
const returnsRouter = require("../routes/returns");

const MASTER = { id: "master-1", email: MASTER_ADMIN_EMAIL };
const TOKEN = fakeAdminToken(MASTER.id, MASTER.email);
const auth = { Authorization: `Bearer ${TOKEN}` };

let cancelCalls = [];
const realCancel = portone.cancelPayment;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(returnsRouter);
  return app;
}

function baseOrder(overrides = {}) {
  return {
    order_no: "R1", status: "입금확인", payment_method: "card", payment_id: "pay-1", user_id: null,
    customer: { name: "홍길동", tel: "010-1111-2222", email: "" },
    items: [{ name: "후디", options: "블랙 / M", productId: "hoodie", size: "M", color: "black", qty: 1, unit: 60000, sum: 60000 }],
    subtotal: 60000, shipping: 3500, discount: 0, points_used: 0, points_earned: 0, total: 63500, refunded_amount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  cancelCalls = [];
  portone.cancelPayment = async (paymentId, reason, opts) => { cancelCalls.push({ paymentId, reason, ...(opts || {}) }); };
  supabaseAdmin.__reset({
    profiles: [{ id: MASTER.id, role: "admin" }],
    orders: [baseOrder()],
    inventory: [{ product_id: "hoodie", color: "black", size: "M", qty: 0 }],
    return_requests: [
      { id: "ex1", order_no: "R1", request_type: "exchange", status: "접수", reason: "사이즈", contact_name: "홍길동", contact_tel: "010-1111-2222", refunded: false },
      { id: "cx1", order_no: "R1", request_type: "cancel", status: "접수", reason: "단순변심", contact_name: "홍길동", contact_tel: "010-1111-2222", refunded: false },
      { id: "rt1", order_no: "R1", request_type: "return", status: "접수", reason: "단순변심", contact_name: "홍길동", contact_tel: "010-1111-2222", refunded: false },
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

test("교환 신청을 '완료'로 바꿔도 환불하지 않고 주문도 그대로", async () => {
  const res = await request(buildApp()).patch("/api/admin/returns/ex1").set(auth).send({ status: "완료" });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(cancelCalls.length, 0, "카드 환불 요청이 나가면 안 된다");
  const order = (await supabaseAdmin.from("orders").select("*").eq("order_no", "R1").maybeSingle()).data;
  assert.strictEqual(order.status, "입금확인");
});

test("주문취소 신청을 '완료'로 바꾸면 실제 주문이 취소되고 재고 복원·카드 환불까지", async () => {
  const res = await request(buildApp()).patch("/api/admin/returns/cx1").set(auth).send({ status: "완료" });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.cancel.refund, "card");
  assert.strictEqual(res.body.cancel.ok, true);
  const order = (await supabaseAdmin.from("orders").select("*").eq("order_no", "R1").maybeSingle()).data;
  assert.strictEqual(order.status, "취소");
  assert.match(order.cancel_reason, /고객 취소 신청/);
  const inv = (await supabaseAdmin.from("inventory").select("*")).data[0];
  assert.strictEqual(inv.qty, 1, "재고 복원");
  assert.strictEqual(cancelCalls.length, 1);
  const rr = (await supabaseAdmin.from("return_requests").select("*").eq("id", "cx1").maybeSingle()).data;
  assert.strictEqual(rr.status, "완료");
});

test("이미 출고된 주문의 취소 신청은 완료 처리 거절(반품으로 안내)", async () => {
  supabaseAdmin.__reset({
    profiles: [{ id: MASTER.id, role: "admin" }],
    orders: [baseOrder({ status: "배송중" })],
    return_requests: [{ id: "cx1", order_no: "R1", request_type: "cancel", status: "접수", reason: "단순변심", contact_name: "a", contact_tel: "1", refunded: false }],
  });
  const res = await request(buildApp()).patch("/api/admin/returns/cx1").set(auth).send({ status: "완료" });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.code, "ALREADY_SHIPPED");
  assert.strictEqual(cancelCalls.length, 0);
});

test("반품 '완료'는 환불 처리 없이 바꿀 수 없다(REFUND_REQUIRED)", async () => {
  const res = await request(buildApp()).patch("/api/admin/returns/rt1").set(auth).send({ status: "완료" });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, "REFUND_REQUIRED");
  assert.strictEqual(cancelCalls.length, 0);
});

test("유형에 없는 상태는 거절 — 반품에 '재발송', 취소 신청에 '수거중'", async () => {
  assert.strictEqual((await request(buildApp()).patch("/api/admin/returns/rt1").set(auth).send({ status: "재발송" })).status, 400);
  assert.strictEqual((await request(buildApp()).patch("/api/admin/returns/cx1").set(auth).send({ status: "수거중" })).status, 400);
  assert.strictEqual((await request(buildApp()).patch("/api/admin/returns/ex1").set(auth).send({ status: "재발송" })).status, 200);
});

test("교환 일부 상품만 재고 복원(lines)", async () => {
  const res = await request(buildApp()).post("/api/admin/returns/ex1/restock").set(auth).send({ lines: [{ index: 0, qty: 1 }] });
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await supabaseAdmin.from("inventory").select("*")).data[0].qty, 1);
  const bad = await request(buildApp()).post("/api/admin/returns/cx1/restock").set(auth).send({ lines: [{ index: 0, qty: 5 }] });
  assert.strictEqual(bad.status, 400);
});
