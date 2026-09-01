/* routes/admins.js 통합 테스트 — 실제 Supabase 대신 test-helpers/fakeSupabase.js를 쓴다.
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
const { MASTER_ADMIN_EMAIL } = require("../lib/auth");
const adminsRouter = require("../routes/admins");
const membersRouter = require("../routes/members");

const MASTER = { id: "master-1", email: MASTER_ADMIN_EMAIL };
const MASTER_TOKEN = fakeAdminToken(MASTER.id, MASTER.email);
const ADMIN = { id: "admin-1", email: "admin@example.com" };
const TOKEN = fakeAdminToken(ADMIN.id, ADMIN.email);
const EXISTING_CUSTOMER = { id: "cust-1", email: "existing@example.com" };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(adminsRouter);
  app.use(membersRouter);
  return app;
}

function seedDefault(extra = {}) {
  supabaseAdmin.__reset({
    profiles: [
      { id: MASTER.id, role: "admin", created_at: "2026-01-01T00:00:00.000Z" },
      { id: ADMIN.id, role: "admin", created_at: "2026-01-01T00:00:00.000Z" },
      { id: EXISTING_CUSTOMER.id, name: "홍길동", role: "customer", created_at: "2026-02-01T00:00:00.000Z" },
    ],
    authUsers: [
      { id: MASTER.id, email: MASTER.email, email_confirmed_at: "2026-01-01T00:00:00.000Z" },
      { id: ADMIN.id, email: ADMIN.email, email_confirmed_at: "2026-01-01T00:00:00.000Z" },
      { id: EXISTING_CUSTOMER.id, email: EXISTING_CUSTOMER.email, email_confirmed_at: "2026-02-01T00:00:00.000Z" },
    ],
    ...extra,
  });
}

beforeEach(() => seedDefault());

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("GET /api/admin/admins — 마스터가 아닌 일반 관리자도 목록은 볼 수 있다", async () => {
  const res = await request(buildApp()).get("/api/admin/admins").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.items.length, 2);
});

test("POST /api/admin/admins — 마스터 관리자가 아니면 403(다른 관리자는 새 관리자를 초대할 수 없다)", async () => {
  const res = await request(buildApp())
    .post("/api/admin/admins")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ email: "new-admin@example.com" });
  assert.strictEqual(res.status, 403);
});

test("DELETE /api/admin/admins/:id — 마스터 관리자가 아니면 403(다른 관리자의 권한을 해제할 수 없다)", async () => {
  const res = await request(buildApp())
    .delete(`/api/admin/admins/${MASTER.id}`)
    .set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(res.status, 403);
});

test("POST /api/admin/admins — 마스터 관리자는 새 이메일을 초대할 수 있다", async () => {
  const res = await request(buildApp())
    .post("/api/admin/admins")
    .set("Authorization", `Bearer ${MASTER_TOKEN}`)
    .send({ email: "new-admin@example.com" });
  assert.strictEqual(res.status, 200);

  const list = await request(buildApp()).get("/api/admin/admins").set("Authorization", `Bearer ${MASTER_TOKEN}`);
  assert.strictEqual(list.body.items.length, 3);
});

/* 2026-09-01 사용자가 실제로 겪은 문제: 이미 가입된 이메일(고객으로 먼저 가입한 사람)을
   관리자로 초대하려 하면 Supabase가 영어 원문 에러를 그대로 줘서 뭘 해야 할지 안내가 안 됐다.
   이제는 409 + code:"already_registered" + existingId를 돌려줘서 프런트가 "관리자로
   승격할까요?"로 물어보고, 확인되면 members.js의 승격 엔드포인트를 그대로 쓸 수 있다. */
test("POST /api/admin/admins — 이미 가입된 이메일이면 409로 승격 여부를 물을 수 있는 정보를 돌려준다", async () => {
  const res = await request(buildApp())
    .post("/api/admin/admins")
    .set("Authorization", `Bearer ${MASTER_TOKEN}`)
    .send({ email: EXISTING_CUSTOMER.email });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.code, "already_registered");
  assert.strictEqual(res.body.existingId, EXISTING_CUSTOMER.id);

  // 프런트는 이 id로 members.js의 승격 엔드포인트를 그대로 호출한다 — 실제로 되는지 이어서 확인.
  const promoted = await request(buildApp())
    .patch(`/api/admin/members/${res.body.existingId}/promote`)
    .set("Authorization", `Bearer ${MASTER_TOKEN}`);
  assert.strictEqual(promoted.status, 200);

  const profile = await supabaseAdmin.from("profiles").select("role").eq("id", EXISTING_CUSTOMER.id).maybeSingle();
  assert.strictEqual(profile.data.role, "admin");
});

test("POST /api/admin/admins — 이미 관리자인 이메일을 다시 초대하면 그냥 400", async () => {
  const res = await request(buildApp())
    .post("/api/admin/admins")
    .set("Authorization", `Bearer ${MASTER_TOKEN}`)
    .send({ email: ADMIN.email });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, undefined);
});

test("DELETE /api/admin/admins/:id — 마스터 관리자는 다른 관리자의 권한을 해제할 수 있다", async () => {
  const res = await request(buildApp())
    .delete(`/api/admin/admins/${ADMIN.id}`)
    .set("Authorization", `Bearer ${MASTER_TOKEN}`);
  assert.strictEqual(res.status, 200);

  const profile = await supabaseAdmin.from("profiles").select("role").eq("id", ADMIN.id).maybeSingle();
  assert.strictEqual(profile.data.role, "customer");
});

test("DELETE /api/admin/admins/:id — 마스터 관리자도 본인 권한은 해제할 수 없다", async () => {
  const res = await request(buildApp())
    .delete(`/api/admin/admins/${MASTER.id}`)
    .set("Authorization", `Bearer ${MASTER_TOKEN}`);
  assert.strictEqual(res.status, 400);
});
