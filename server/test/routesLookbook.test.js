/* routes/lookbook.js 통합 테스트 — test-helpers/fakeSupabase.js 사용(routesSettings.test.js 참고). */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const lookbookRouter = require("../routes/lookbook");

const ADMIN = { id: "admin-1", email: "admin@example.com" };
const TOKEN = fakeAdminToken(ADMIN.id, ADMIN.email);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(lookbookRouter);
  return app;
}

beforeEach(() => {
  supabaseAdmin.__reset({
    profiles: [{ id: ADMIN.id, role: "admin" }],
    lookbook: [
      { id: "l1", span: "w8", ratio: "16/10", label: "공개칸", note: "", src: null, active: true, sort_order: 0 },
      { id: "l2", span: "w4", ratio: "3/4", label: "비공개칸", note: "", src: null, active: false, sort_order: 1 },
    ],
  });
});

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("GET /api/lookbook — 공개, active=true인 칸만 반환", async () => {
  const res = await request(buildApp()).get("/api/lookbook");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.length, 1);
  assert.strictEqual(res.body[0].label, "공개칸");
});

test("GET /api/admin/lookbook — 인증 없으면 401, 있으면 비공개 칸까지 전부 반환", async () => {
  const unauth = await request(buildApp()).get("/api/admin/lookbook");
  assert.strictEqual(unauth.status, 401);

  const auth = await request(buildApp()).get("/api/admin/lookbook").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(auth.status, 200);
  assert.strictEqual(auth.body.items.length, 2);
});

test("POST /api/admin/lookbook — span이 유효한 값이 아니면 400", async () => {
  const res = await request(buildApp())
    .post("/api/admin/lookbook")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ span: "w99", ratio: "1/1", label: "테스트" });
  assert.strictEqual(res.status, 400);
});

test("POST 생성 → PATCH로 active 전환 → 공개 목록에 반영된다", async () => {
  const app = buildApp();
  const created = await request(app)
    .post("/api/admin/lookbook")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ span: "w6", ratio: "4/5", label: "새 칸", active: false });
  assert.strictEqual(created.status, 200);
  assert.strictEqual(created.body.active, false);

  const beforePublish = await request(app).get("/api/lookbook");
  assert.strictEqual(beforePublish.body.length, 1); // 아직 기존 공개칸 1개뿐

  const patched = await request(app)
    .patch(`/api/admin/lookbook/${created.body.id}`)
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ active: true });
  assert.strictEqual(patched.status, 200);
  assert.strictEqual(patched.body.active, true);

  const afterPublish = await request(app).get("/api/lookbook");
  assert.strictEqual(afterPublish.body.length, 2);
});

test("DELETE /api/admin/lookbook/:id — 삭제 후 목록에서 사라진다", async () => {
  const app = buildApp();
  const res = await request(app).delete("/api/admin/lookbook/l1").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(res.status, 200);
  const listed = await request(app).get("/api/lookbook");
  assert.strictEqual(listed.body.length, 0);
});
