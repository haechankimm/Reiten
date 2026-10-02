process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const accountRouter = require("../routes/account");

const CUST = { id: "cust-1", email: "c@example.com" };
const ADMIN = { id: "admin-1", email: "a@example.com" };
const tok = (u) => `Bearer ${fakeAdminToken(u.id, u.email)}`;

function app() {
  const a = express();
  a.use(express.json());
  a.use(accountRouter);
  return a;
}

function seed(extra = {}) {
  supabaseAdmin.__reset({
    profiles: [{ id: CUST.id, role: "customer" }, { id: ADMIN.id, role: "admin" }],
    authUsers: [{ id: CUST.id, email: CUST.email }, { id: ADMIN.id, email: ADMIN.email }],
    orders: [{ order_no: "R1", user_id: CUST.id, status: "완료", customer: { name: "홍" } }],
    loyalty_points_ledger: [{ id: "l1", user_id: CUST.id, delta: 100 }],
    restock_subscriptions: [{ id: "s1", email: CUST.email }],
    ...extra,
  });
}
beforeEach(() => seed());
after(() => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

test("확인 문구가 없으면 400", async () => {
  const r = await request(app()).delete("/api/my/account").set("Authorization", tok(CUST)).send({});
  assert.strictEqual(r.status, 400);
});

test("관리자 계정은 셀프 탈퇴 불가", async () => {
  const r = await request(app()).delete("/api/my/account").set("Authorization", tok(ADMIN)).send({ confirm: "탈퇴" });
  assert.strictEqual(r.status, 400);
});

test("진행 중 주문이 있으면 409", async () => {
  seed({ orders: [{ order_no: "R2", user_id: CUST.id, status: "배송중", customer: {} }] });
  const r = await request(app()).delete("/api/my/account").set("Authorization", tok(CUST)).send({ confirm: "탈퇴" });
  assert.strictEqual(r.status, 409);
});

test("탈퇴 성공 — 주문은 남고 연결만 끊김, 적립금·품절알림 삭제, 계정 삭제", async () => {
  const r = await request(app()).delete("/api/my/account").set("Authorization", tok(CUST)).send({ confirm: "탈퇴" });
  assert.strictEqual(r.status, 200);
  const { data: orders } = await supabaseAdmin.from("orders").select("*");
  assert.strictEqual(orders.length, 1);
  assert.strictEqual(orders[0].user_id, null);
  const { data: ledger } = await supabaseAdmin.from("loyalty_points_ledger").select("*");
  assert.strictEqual(ledger.length, 0);
  const { data: subs } = await supabaseAdmin.from("restock_subscriptions").select("*");
  assert.strictEqual(subs.length, 0);
  const { data: users } = await supabaseAdmin.auth.admin.listUsers();
  assert.ok(!users.users.some((u) => u.id === CUST.id));
});
