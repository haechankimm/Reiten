/* routes/settings.js 통합 테스트 — 실제 Supabase 대신 test-helpers/fakeSupabase.js를 쓴다.
   SUPABASE_URL=fake는 반드시 lib/supabase.js를 처음 require하기 전에 설정해야 한다(모듈이
   그 값을 보고 실제 클라이언트 대신 가짜 클라이언트를 한 번만 만들기 때문). */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const settingsRouter = require("../routes/settings");

const ADMIN = { id: "admin-1", email: "admin@example.com" };
const TOKEN = fakeAdminToken(ADMIN.id, ADMIN.email);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(settingsRouter);
  return app;
}

beforeEach(() => {
  supabaseAdmin.__reset({ profiles: [{ id: ADMIN.id, role: "admin" }] });
});

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("GET /api/admin/settings — 인증 없으면 401", async () => {
  const res = await request(buildApp()).get("/api/admin/settings");
  assert.strictEqual(res.status, 401);
});

test("POST /api/admin/settings — 이름 없으면 400", async () => {
  const res = await request(buildApp())
    .post("/api/admin/settings")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ value: "값만 있음" });
  assert.strictEqual(res.status, 400);
});

test("POST → GET → PATCH → DELETE 전체 흐름이 실제로 반영된다", async () => {
  const app = buildApp();

  const created = await request(app)
    .post("/api/admin/settings")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ label: "Supabase 링크", value: "https://supabase.com", note: "운영 대시보드" });
  assert.strictEqual(created.status, 200);
  assert.strictEqual(created.body.label, "Supabase 링크");
  assert.ok(created.body.id);

  const listed = await request(app).get("/api/admin/settings").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(listed.status, 200);
  assert.strictEqual(listed.body.length, 1);

  const updated = await request(app)
    .patch(`/api/admin/settings/${created.body.id}`)
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ value: "https://supabase.com/dashboard" });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.value, "https://supabase.com/dashboard");

  const deleted = await request(app).delete(`/api/admin/settings/${created.body.id}`).set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(deleted.status, 200);

  const listedAfter = await request(app).get("/api/admin/settings").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(listedAfter.body.length, 0);
});

test("PATCH /api/admin/settings/:id — 존재하지 않는 id면 404", async () => {
  const res = await request(buildApp())
    .patch("/api/admin/settings/00000000-0000-0000-0000-000000000000")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ value: "x" });
  assert.strictEqual(res.status, 404);
});
