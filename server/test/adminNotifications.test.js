/* routes/adminNotifications.js — 알림 벨(2026-11-11): 비공개 상품의 품절은 세지 않고, 공급처 입고 대기·확인 대기 매입을 센다 */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const router = require("../routes/adminNotifications");

after(() => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

test("품절 조합은 판매 중 상품만, 공급처 입고 대기·확인 대기 매입도 센다", async () => {
  supabaseAdmin.__reset({
    profiles: [{ id: "a1", role: "admin" }],
    products: [{ id: "on", active: true }, { id: "off", active: false }],
    inventory: [{ product_id: "on", color: "black", size: "M", qty: 0 }, { product_id: "off", color: "black", size: "M", qty: 0 }, { product_id: "off", color: "black", size: "L", qty: 0 }],
    orders: [], qna: [], return_requests: [], system_error_log: [],
    supplier_shipments: [{ id: "s1", status: "DELIVERED" }, { id: "s2", status: "RECEIVED" }],
    supplier_invoices: [{ id: "i1", status: "RECORDED" }, { id: "i2", status: "CONFIRMED" }],
  });
  const a = express();
  a.use(router);
  const res = await request(a).get("/api/admin/notifications").set("Authorization", `Bearer ${fakeAdminToken("a1", "a@x.com")}`);
  const by = Object.fromEntries(res.body.items.map((i) => [i.key, i.count]));
  assert.strictEqual(by.outOfStock, 1);
  assert.strictEqual(by.supplierAwaitingReceipt, 1);
  assert.strictEqual(by.invoicesPending, 1);
});
