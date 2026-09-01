/* routes/members.js 통합 테스트 — 실제 Supabase 대신 test-helpers/fakeSupabase.js를 쓴다.
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
const membersRouter = require("../routes/members");

const ADMIN = { id: "admin-1", email: "admin@example.com" };
const TOKEN = fakeAdminToken(ADMIN.id, ADMIN.email);
const CUSTOMER = { id: "cust-1", email: "customer@example.com" };
const OTHER_ADMIN_PROFILE = { id: "admin-2", role: "admin", created_at: "2026-01-01T00:00:00.000Z" };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(membersRouter);
  return app;
}

function seedDefault(extra = {}) {
  supabaseAdmin.__reset({
    profiles: [
      { id: ADMIN.id, role: "admin", created_at: "2026-01-01T00:00:00.000Z" },
      OTHER_ADMIN_PROFILE,
      { id: CUSTOMER.id, name: "홍길동", role: "customer", created_at: "2026-02-01T00:00:00.000Z" },
    ],
    authUsers: [
      { id: ADMIN.id, email: ADMIN.email, email_confirmed_at: "2026-01-01T00:00:00.000Z" },
      { id: OTHER_ADMIN_PROFILE.id, email: "admin2@example.com", email_confirmed_at: "2026-01-01T00:00:00.000Z" },
      { id: CUSTOMER.id, email: CUSTOMER.email, email_confirmed_at: "2026-02-01T00:00:00.000Z" },
    ],
    orders: [],
    return_requests: [],
    qna: [],
    ...extra,
  });
}

beforeEach(() => seedDefault());

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("GET /api/admin/members — 인증 없으면 401", async () => {
  const res = await request(buildApp()).get("/api/admin/members");
  assert.strictEqual(res.status, 401);
});

test("GET /api/admin/members — 관리자 계정은 목록에서 빠지고 일반 회원만 나온다", async () => {
  const res = await request(buildApp()).get("/api/admin/members").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.total, 1);
  assert.strictEqual(res.body.items[0].email, CUSTOMER.email);
  assert.strictEqual(res.body.items[0].name, "홍길동");
});

test("GET /api/admin/members?q= — 이메일·이름으로 검색된다", async () => {
  const app = buildApp();
  const hit = await request(app).get("/api/admin/members?q=길동").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(hit.body.total, 1);
  const miss = await request(app).get("/api/admin/members?q=없는이름").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(miss.body.total, 0);
});

test("PATCH /api/admin/members/:id/ban — 관리자 계정은 차단할 수 없다", async () => {
  const res = await request(buildApp())
    .patch(`/api/admin/members/${OTHER_ADMIN_PROFILE.id}/ban`)
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ banned: true });
  assert.strictEqual(res.status, 400);
});

test("PATCH /api/admin/members/:id/ban — 차단하면 목록에 반영되고, 해제하면 풀린다", async () => {
  const app = buildApp();

  const banned = await request(app)
    .patch(`/api/admin/members/${CUSTOMER.id}/ban`)
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ banned: true });
  assert.strictEqual(banned.status, 200);

  const afterBan = await request(app).get("/api/admin/members").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(afterBan.body.items[0].banned, true);

  const unbanned = await request(app)
    .patch(`/api/admin/members/${CUSTOMER.id}/ban`)
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ banned: false });
  assert.strictEqual(unbanned.status, 200);

  const afterUnban = await request(app).get("/api/admin/members").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(afterUnban.body.items[0].banned, false);
});

test("DELETE /api/admin/members/:id — 관리자 계정은 삭제할 수 없다", async () => {
  const res = await request(buildApp())
    .delete(`/api/admin/members/${OTHER_ADMIN_PROFILE.id}`)
    .set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(res.status, 400);
});

/* 001_init.sql에서 orders.user_id/return_requests.user_id/qna.user_id는 auth.users(id)를
   on delete cascade 없이 참조한다 — 실제 Supabase였다면 이 주문이 하나라도 남아있는 채로
   auth 계정을 지우려 하면 외래키 위반으로 그냥 실패한다. 그래서 라우트는 계정을 지우기 전에
   먼저 이 세 테이블의 user_id를 null로 끊어야 한다 — 그 순서가 실제로 지켜지는지 검증한다. */
test("DELETE /api/admin/members/:id — 주문·반품·문의는 남기고 회원 연결만 끊은 뒤 계정을 삭제한다", async () => {
  seedDefault({
    orders: [{ id: "o1", order_no: "R2609010001", user_id: CUSTOMER.id, customer: { name: "홍길동" }, items: [], subtotal: 0, shipping: 0, total: 0 }],
    return_requests: [{ id: "r1", order_no: "R2609010001", user_id: CUSTOMER.id, contact_name: "홍길동", contact_tel: "010", reason: "단순변심" }],
    qna: [{ id: "q1", product_id: "general", user_id: CUSTOMER.id, name: "홍길동", question: "문의" }],
  });
  const app = buildApp();

  const res = await request(app).delete(`/api/admin/members/${CUSTOMER.id}`).set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(res.status, 200);

  const order = await supabaseAdmin.from("orders").select("*").eq("id", "o1").maybeSingle();
  assert.strictEqual(order.data.user_id, null);
  const ret = await supabaseAdmin.from("return_requests").select("*").eq("id", "r1").maybeSingle();
  assert.strictEqual(ret.data.user_id, null);
  const qnaRow = await supabaseAdmin.from("qna").select("*").eq("id", "q1").maybeSingle();
  assert.strictEqual(qnaRow.data.user_id, null);

  const listed = await request(app).get("/api/admin/members").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(listed.body.total, 0);

  const profile = await supabaseAdmin.from("profiles").select("*").eq("id", CUSTOMER.id).maybeSingle();
  assert.strictEqual(profile.data, null);
});
