process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const { MASTER_ADMIN_EMAIL } = require("../lib/auth");
const { adminGuard, invalidateAdminCache } = require("../lib/adminGuard");
const staffRouter = require("../routes/staff");

const MASTER = { id: "master-1", email: MASTER_ADMIN_EMAIL };
const STAFF = { id: "staff-1", email: "staff@example.com" };
const MT = fakeAdminToken(MASTER.id, MASTER.email);
const ST = fakeAdminToken(STAFF.id, STAFF.email);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminGuard);
  app.get("/api/admin/orders", (req, res) => res.json({ ok: true }));
  app.patch("/api/admin/orders/:no", (req, res) => res.json({ ok: true }));
  app.get("/api/admin/coupons", (req, res) => res.json({ ok: true }));
  app.get("/api/admin/brand-new-thing", (req, res) => res.json({ ok: true }));
  app.use(staffRouter);
  return app;
}

beforeEach(() => {
  invalidateAdminCache();
  supabaseAdmin.__reset({
    profiles: [
      { id: MASTER.id, role: "admin", created_at: "2026-01-01T00:00:00.000Z" },
      { id: STAFF.id, role: "admin", name: "직원", created_at: "2026-01-02T00:00:00.000Z" },
    ],
    authUsers: [
      { id: MASTER.id, email: MASTER.email, email_confirmed_at: "2026-01-01T00:00:00.000Z" },
      { id: STAFF.id, email: STAFF.email, email_confirmed_at: "2026-01-01T00:00:00.000Z" },
    ],
  });
});

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

async function setupPin(app, token, pin = "123456") {
  const res = await request(app).post("/api/admin/pin/setup").set("Authorization", `Bearer ${token}`).send({ pin });
  assert.strictEqual(res.status, 200);
  invalidateAdminCache();
  return res.body.token;
}

const auth = (t, pin) => ({ Authorization: `Bearer ${t}`, ...(pin ? { "X-Admin-Pin": pin } : {}) });

test("PIN 미설정이면 관리자 API가 PIN_SETUP_REQUIRED로 막히고, /me는 통과한다", async () => {
  const app = buildApp();
  const r = await request(app).get("/api/admin/orders").set(auth(MT));
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, "PIN_SETUP_REQUIRED");
  const me = await request(app).get("/api/admin/me").set(auth(MT));
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.isMaster, true);
  assert.strictEqual(me.body.pin.set, false);
});

test("PIN 설정 후: 토큰 없으면 PIN_REQUIRED, 토큰 있으면 통과, 틀린 PIN은 거부", async () => {
  const app = buildApp();
  const token = await setupPin(app, MT);
  const noToken = await request(app).get("/api/admin/orders").set(auth(MT));
  assert.strictEqual(noToken.body.code, "PIN_REQUIRED");
  const ok = await request(app).get("/api/admin/orders").set(auth(MT, token));
  assert.strictEqual(ok.status, 200);

  const bad = await request(app).post("/api/admin/pin/verify").set(auth(MT)).send({ pin: "000000" });
  assert.strictEqual(bad.status, 401);
  const good = await request(app).post("/api/admin/pin/verify").set(auth(MT)).send({ pin: "123456" });
  assert.strictEqual(good.status, 200);
  assert.ok(good.body.token);
});

test("PIN 5회 틀리면 잠금(429)", async () => {
  const app = buildApp();
  await setupPin(app, MT);
  for (let i = 0; i < 5; i++) await request(app).post("/api/admin/pin/verify").set(auth(MT)).send({ pin: "111111" });
  invalidateAdminCache();
  const locked = await request(app).post("/api/admin/pin/verify").set(auth(MT)).send({ pin: "123456" });
  assert.strictEqual(locked.status, 429);
});

test("PIN을 바꾸면 이전 토큰은 무효", async () => {
  const app = buildApp();
  const oldToken = await setupPin(app, MT);
  const change = await request(app).post("/api/admin/pin/change").set(auth(MT)).send({ currentPin: "123456", newPin: "654321" });
  assert.strictEqual(change.status, 200);
  invalidateAdminCache();
  const stale = await request(app).get("/api/admin/orders").set(auth(MT, oldToken));
  assert.strictEqual(stale.body.code, "PIN_REQUIRED");
  const fresh = await request(app).get("/api/admin/orders").set(auth(MT, change.body.token));
  assert.strictEqual(fresh.status, 200);
});

test("직원 권한: 보기만이면 GET 허용·PATCH 403, 없는 영역은 403, 표에 없는 새 경로는 마스터 전용", async () => {
  const app = buildApp();
  const staffToken = await setupPin(app, ST);
  const masterToken = await setupPin(app, MT);

  const put = await request(app).put(`/api/admin/staff/${STAFF.id}/permissions`).set(auth(MT, masterToken)).send({ permissions: { orders: "view" } });
  assert.strictEqual(put.status, 200);
  invalidateAdminCache();

  assert.strictEqual((await request(app).get("/api/admin/orders").set(auth(ST, staffToken))).status, 200);
  const patch = await request(app).patch("/api/admin/orders/R1").set(auth(ST, staffToken)).send({});
  assert.strictEqual(patch.status, 403);
  assert.strictEqual(patch.body.code, "FORBIDDEN_AREA");
  assert.strictEqual((await request(app).get("/api/admin/coupons").set(auth(ST, staffToken))).status, 403);
  assert.strictEqual((await request(app).get("/api/admin/brand-new-thing").set(auth(ST, staffToken))).status, 403);
  assert.strictEqual((await request(app).get("/api/admin/brand-new-thing").set(auth(MT, masterToken))).status, 200);
  assert.strictEqual((await request(app).get("/api/admin/staff").set(auth(ST, staffToken))).status, 403);
});

test("마스터: 직원 PIN 지정·초기화, 비밀번호 변경, 마스터 자신은 대상 불가", async () => {
  const app = buildApp();
  const masterToken = await setupPin(app, MT);
  const set = await request(app).post(`/api/admin/staff/${STAFF.id}/pin`).set(auth(MT, masterToken)).send({ pin: "222222" });
  assert.strictEqual(set.status, 200);
  const verify = await request(app).post("/api/admin/pin/verify").set(auth(ST)).send({ pin: "222222" });
  assert.strictEqual(verify.status, 200);

  const reset = await request(app).post(`/api/admin/staff/${STAFF.id}/pin`).set(auth(MT, masterToken)).send({ reset: true });
  assert.strictEqual(reset.status, 200);
  invalidateAdminCache();
  const me = await request(app).get("/api/admin/me").set(auth(ST));
  assert.strictEqual(me.body.pin.set, false);

  const shortPw = await request(app).post(`/api/admin/staff/${STAFF.id}/password`).set(auth(MT, masterToken)).send({ password: "short" });
  assert.strictEqual(shortPw.status, 400);
  const okPw = await request(app).post(`/api/admin/staff/${STAFF.id}/password`).set(auth(MT, masterToken)).send({ password: "longenough1" });
  assert.strictEqual(okPw.status, 200);

  const self = await request(app).post(`/api/admin/staff/${MASTER.id}/pin`).set(auth(MT, masterToken)).send({ pin: "111111" });
  assert.strictEqual(self.status, 400);
});
