/* routes/colors.js 통합 테스트 — test-helpers/fakeSupabase.js 사용(routesSettings.test.js 참고). */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const colorsRouter = require("../routes/colors");

const ADMIN = { id: "admin-1", email: "admin@example.com" };
const TOKEN = fakeAdminToken(ADMIN.id, ADMIN.email);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(colorsRouter);
  return app;
}

beforeEach(() => {
  supabaseAdmin.__reset({
    profiles: [{ id: ADMIN.id, role: "admin" }],
    product_colors: [{ key: "black", label: "블랙", label_de: null, hex: "#111111", sort_order: 0 }],
  });
});

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("GET /api/colors — 공개, 인증 없이도 시드된 색상을 반환", async () => {
  const res = await request(buildApp()).get("/api/colors");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.length, 1);
  assert.strictEqual(res.body[0].key, "black");
});

test("GET /api/admin/colors — 인증 없으면 401", async () => {
  const res = await request(buildApp()).get("/api/admin/colors");
  assert.strictEqual(res.status, 401);
});

test("POST /api/admin/colors — hex 형식이 틀리면 400", async () => {
  const res = await request(buildApp())
    .post("/api/admin/colors")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ label: "테스트", hex: "not-a-hex" });
  assert.strictEqual(res.status, 400);
});

test("POST /api/admin/colors — 라벨을 슬러그화해 key를 만들고, 이미 있는 key와 겹치면 접미사를 붙인다", async () => {
  const app = buildApp();
  const first = await request(app)
    .post("/api/admin/colors")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ label: "Sunset", hex: "#f5e6a0" });
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.key, "sunset");

  const second = await request(app)
    .post("/api/admin/colors")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ label: "Sunset", hex: "#112233" });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.key, "sunset-2"); // 같은 라벨이라 key가 겹쳐서 -2가 붙어야 함
});

test("DELETE /api/admin/colors/:key — 사용 중인 상품이 있으면 409로 거부", async () => {
  supabaseAdmin.__reset({
    profiles: [{ id: ADMIN.id, role: "admin" }],
    product_colors: [{ key: "black", label: "블랙", label_de: null, hex: "#111111", sort_order: 0 }],
    products: [{ id: "p1", active: true, colors: ["black"] }],
  });
  const res = await request(buildApp()).delete("/api/admin/colors/black").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(res.status, 409);
});

test("DELETE /api/admin/colors/:key — 사용하는 상품이 없으면 정상 삭제", async () => {
  const res = await request(buildApp()).delete("/api/admin/colors/black").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(res.status, 200);
  const listed = await request(buildApp()).get("/api/colors");
  assert.strictEqual(listed.body.length, 0);
});
