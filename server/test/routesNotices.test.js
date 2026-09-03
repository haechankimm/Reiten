/* routes/notices.js 통합 테스트 — 실제 Supabase 대신 test-helpers/fakeSupabase.js를 쓴다. */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const { MASTER_ADMIN_EMAIL } = require("../lib/auth");
const noticesRouter = require("../routes/notices");

const MASTER = { id: "master-1", email: MASTER_ADMIN_EMAIL };
const MASTER_TOKEN = fakeAdminToken(MASTER.id, MASTER.email);
const ADMIN_A = { id: "admin-a", email: "a@example.com" };
const TOKEN_A = fakeAdminToken(ADMIN_A.id, ADMIN_A.email);
const ADMIN_B = { id: "admin-b", email: "b@example.com" };
const TOKEN_B = fakeAdminToken(ADMIN_B.id, ADMIN_B.email);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(noticesRouter);
  return app;
}

beforeEach(() => {
  supabaseAdmin.__reset({
    profiles: [
      { id: MASTER.id, role: "admin", created_at: "2026-01-01T00:00:00.000Z" },
      { id: ADMIN_A.id, role: "admin", created_at: "2026-01-01T00:00:00.000Z" },
      { id: ADMIN_B.id, role: "admin", created_at: "2026-01-01T00:00:00.000Z" },
    ],
    notices: [],
  });
});

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("POST /api/admin/notices — 제목·내용 없으면 400", async () => {
  const res = await request(buildApp()).post("/api/admin/notices").set("Authorization", `Bearer ${TOKEN_A}`).send({ title: "" });
  assert.strictEqual(res.status, 400);
});

test("POST → GET — 작성자 이메일이 남고 최신순으로 보인다", async () => {
  const app = buildApp();
  await request(app).post("/api/admin/notices").set("Authorization", `Bearer ${TOKEN_A}`).send({ title: "첫 공지", body: "본문1" });
  const created = await request(app).post("/api/admin/notices").set("Authorization", `Bearer ${TOKEN_B}`).send({ title: "둘째 공지", body: "본문2" });
  assert.strictEqual(created.status, 200);
  assert.strictEqual(created.body.authorEmail, ADMIN_B.email);

  const list = await request(app).get("/api/admin/notices").set("Authorization", `Bearer ${TOKEN_A}`);
  assert.strictEqual(list.body.total, 2);
  assert.strictEqual(list.body.items[0].title, "둘째 공지"); // 최신순
});

test("PATCH/DELETE — 본인 글은 수정·삭제할 수 있다", async () => {
  const app = buildApp();
  const created = await request(app).post("/api/admin/notices").set("Authorization", `Bearer ${TOKEN_A}`).send({ title: "제목", body: "내용" });
  const id = created.body.id;

  const updated = await request(app).patch(`/api/admin/notices/${id}`).set("Authorization", `Bearer ${TOKEN_A}`).send({ title: "수정됨" });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.title, "수정됨");

  const deleted = await request(app).delete(`/api/admin/notices/${id}`).set("Authorization", `Bearer ${TOKEN_A}`);
  assert.strictEqual(deleted.status, 200);
});

test("PATCH/DELETE — 다른 관리자의 글은 못 건드리지만, 마스터는 건드릴 수 있다", async () => {
  const app = buildApp();
  const created = await request(app).post("/api/admin/notices").set("Authorization", `Bearer ${TOKEN_A}`).send({ title: "A의 글", body: "내용" });
  const id = created.body.id;

  const blocked = await request(app).patch(`/api/admin/notices/${id}`).set("Authorization", `Bearer ${TOKEN_B}`).send({ title: "몰래 수정" });
  assert.strictEqual(blocked.status, 404);

  const asMaster = await request(app).delete(`/api/admin/notices/${id}`).set("Authorization", `Bearer ${MASTER_TOKEN}`);
  assert.strictEqual(asMaster.status, 200);
});
