/* 현금영수증 신청·발급 표시(2026-11-11) — lib/cashReceipt.js + POST /api/admin/orders/:no/cash-receipt */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { normalizeCashReceipt, maskCashReceiptNumber } = require("../lib/cashReceipt");

after(() => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

test("신청 안 함·휴대폰·사업자번호 검사", () => {
  assert.deepStrictEqual(normalizeCashReceipt(undefined), { value: null });
  assert.deepStrictEqual(normalizeCashReceipt({ type: "none" }), { value: null });
  assert.deepStrictEqual(normalizeCashReceipt({ type: "personal", number: "010-1234-5678" }), { value: { type: "personal", number: "01012345678" } });
  assert.ok(normalizeCashReceipt({ type: "personal", number: "02-123-4567" }).error);
  assert.deepStrictEqual(normalizeCashReceipt({ type: "business", number: "154-44-01222" }), { value: { type: "business", number: "1544401222" } });
  assert.ok(normalizeCashReceipt({ type: "business", number: "12345" }).error);
  assert.ok(normalizeCashReceipt({ type: "hack", number: "01012345678" }).error);
  assert.strictEqual(maskCashReceiptNumber("01012345678"), "010****5678");
});

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => { req.adminVerified = true; req.isMasterAdmin = true; req.user = { id: "u", email: "x@x" }; next(); });
  a.use(require("../routes/adminOrders"));
  return a;
}

test("발급 완료 표시·취소, 신청 안 한 주문은 400", async () => {
  supabaseAdmin.__reset({ orders: [
    { id: 1, order_no: "R1", status: "입금확인", customer: { name: "a", cashReceipt: { type: "personal", number: "01012345678" } } },
    { id: 2, order_no: "R2", status: "입금확인", customer: { name: "b" } },
  ] });
  const on = await request(app()).post("/api/admin/orders/R1/cash-receipt").send({ issued: true });
  assert.strictEqual(on.status, 200);
  assert.ok(on.body.cashReceipt.issuedAt);
  const off = await request(app()).post("/api/admin/orders/R1/cash-receipt").send({ issued: false });
  assert.strictEqual(off.body.cashReceipt.issuedAt, null);
  const none = await request(app()).post("/api/admin/orders/R2/cash-receipt").send({ issued: true });
  assert.strictEqual(none.status, 400);
});
