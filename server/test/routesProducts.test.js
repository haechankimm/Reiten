/* routes/products.js의 신규 일괄 가격 수정(bulk-price)만 다룬다 — 기존 bulk-active/bulk-color/
   생성·수정·삭제 라우트는 이 세션 이전부터 통합 테스트가 없었고(순수 함수 검증만
   test/products.test.js에 있음), 이번 작업 범위는 새로 추가한 것만이라 거기까지 백필하지
   않는다. SUPABASE_URL=fake는 반드시 lib/supabase.js를 처음 require하기 전에 설정해야 한다. */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const productsRouter = require("../routes/products");

const ADMIN = { id: "admin-1", email: "admin@example.com" };
const TOKEN = fakeAdminToken(ADMIN.id, ADMIN.email);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(productsRouter);
  return app;
}

beforeEach(() => {
  supabaseAdmin.__reset({
    profiles: [{ id: ADMIN.id, role: "admin", created_at: "2026-01-01T00:00:00.000Z" }],
    products: [
      { id: "p1", name_ko: "후디A", type: "hoodie", category: "hoodie", price: 10000, colors: [], sizes: [], active: true, created_at: "2026-01-01T00:00:00.000Z" },
      { id: "p2", name_ko: "후디B", type: "hoodie", category: "hoodie", price: 20000, colors: [], sizes: [], active: true, created_at: "2026-01-01T00:00:00.000Z" },
    ],
  });
});

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("PATCH /api/admin/products/bulk-price — mode=set은 선택한 전부를 같은 값으로 바꾼다", async () => {
  const res = await request(buildApp())
    .patch("/api/admin/products/bulk-price")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ ids: ["p1", "p2"], mode: "set", value: 15000 });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.count, 2);

  const p1 = await supabaseAdmin.from("products").select("price").eq("id", "p1").maybeSingle();
  const p2 = await supabaseAdmin.from("products").select("price").eq("id", "p2").maybeSingle();
  assert.strictEqual(p1.data.price, 15000);
  assert.strictEqual(p2.data.price, 15000);
});

test("PATCH /api/admin/products/bulk-price — mode=percent는 상품마다 현재가 기준으로 다르게 계산된다", async () => {
  const res = await request(buildApp())
    .patch("/api/admin/products/bulk-price")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ ids: ["p1", "p2"], mode: "percent", value: 10 });
  assert.strictEqual(res.status, 200);

  const p1 = await supabaseAdmin.from("products").select("price").eq("id", "p1").maybeSingle();
  const p2 = await supabaseAdmin.from("products").select("price").eq("id", "p2").maybeSingle();
  assert.strictEqual(p1.data.price, 11000); // 10000 * 1.1
  assert.strictEqual(p2.data.price, 22000); // 20000 * 1.1
});

test("PATCH /api/admin/products/bulk-price — mode=fixed는 음수가 되면 1원으로 clamp된다", async () => {
  const res = await request(buildApp())
    .patch("/api/admin/products/bulk-price")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ ids: ["p1"], mode: "fixed", value: -50000 });
  assert.strictEqual(res.status, 200);

  const p1 = await supabaseAdmin.from("products").select("price").eq("id", "p1").maybeSingle();
  assert.strictEqual(p1.data.price, 1);
});

test("PATCH /api/admin/products/bulk-price — mode이 이상하면 400", async () => {
  const res = await request(buildApp())
    .patch("/api/admin/products/bulk-price")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ ids: ["p1"], mode: "unknown", value: 1 });
  assert.strictEqual(res.status, 400);
});

test("PATCH /api/admin/products/bulk-price — ids가 없으면 400", async () => {
  const res = await request(buildApp())
    .patch("/api/admin/products/bulk-price")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ mode: "set", value: 1000 });
  assert.strictEqual(res.status, 400);
});
