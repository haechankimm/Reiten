/* routes/payments.js 통합 테스트 — 실제 Supabase 대신 test-helpers/fakeSupabase.js를 쓴다. */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const paymentsRouter = require("../routes/payments");

const ADMIN = { id: "admin-1", email: "admin@example.com" };
const TOKEN = fakeAdminToken(ADMIN.id, ADMIN.email);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(paymentsRouter);
  return app;
}

beforeEach(() => {
  supabaseAdmin.__reset({
    profiles: [{ id: ADMIN.id, role: "admin", created_at: "2026-01-01T00:00:00.000Z" }],
    payment_log: [
      { id: "l1", payment_id: "pay_1", order_no: "R2609010001", status: "paid", amount: 30000, method: "card", reason: null, created_at: "2026-09-01T01:00:00.000Z" },
      { id: "l2", payment_id: "pay_2", order_no: null, status: "mismatch", amount: 30000, method: "card", reason: "status=FAILED", created_at: "2026-09-01T02:00:00.000Z" },
      { id: "l3", payment_id: "pay_3", order_no: null, status: "error", amount: null, method: "card", reason: "network timeout", created_at: "2026-09-01T03:00:00.000Z" },
    ],
  });
});

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("GET /api/admin/payment-log — 인증 없으면 401", async () => {
  const res = await request(buildApp()).get("/api/admin/payment-log");
  assert.strictEqual(res.status, 401);
});

test("GET /api/admin/payment-log — 최신순으로 전부 나온다", async () => {
  const res = await request(buildApp()).get("/api/admin/payment-log").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.total, 3);
  assert.strictEqual(res.body.items[0].paymentId, "pay_3"); // 최신순
  assert.strictEqual(res.body.items[0].statusLabel, "조회 오류");
});

test("GET /api/admin/payment-log?status= — 상태로 필터링된다", async () => {
  const res = await request(buildApp()).get("/api/admin/payment-log?status=mismatch").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(res.body.total, 1);
  assert.strictEqual(res.body.items[0].paymentId, "pay_2");
});

test("GET /api/admin/payment-log?q= — 결제ID·주문번호로 검색된다", async () => {
  const app = buildApp();
  const byPaymentId = await request(app).get("/api/admin/payment-log?q=pay_1").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(byPaymentId.body.total, 1);
  const byOrderNo = await request(app).get("/api/admin/payment-log?q=R260901").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(byOrderNo.body.total, 1);
  assert.strictEqual(byOrderNo.body.items[0].orderNo, "R2609010001");
});

test("GET /api/admin/payment-log/export — CSV로 내려받는다", async () => {
  const res = await request(buildApp()).get("/api/admin/payment-log/export").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers["content-type"], /text\/csv/);
  assert.match(res.text, /pay_1/);
  assert.match(res.text, /결제 트랜잭션/);
});
