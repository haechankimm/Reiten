/* routes/outbox.js 통합 테스트 — 실제 Supabase 대신 test-helpers/fakeSupabase.js를 쓴다. */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const outboxRouter = require("../routes/outbox");

const ADMIN = { id: "admin-1", email: "admin@example.com" };
const TOKEN = fakeAdminToken(ADMIN.id, ADMIN.email);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(outboxRouter);
  return app;
}

beforeEach(() => {
  supabaseAdmin.__reset({
    profiles: [{ id: ADMIN.id, role: "admin", created_at: "2026-01-01T00:00:00.000Z" }],
    system_error_log: [
      { id: "e1", type: "notification_failed", detail: { channel: "email", kind: "signup_confirm_resend", to: "a@example.com", error: "550 invalid" }, resolved: false, created_at: "2026-09-01T01:00:00.000Z" },
      { id: "e2", type: "notification_failed", detail: { channel: "email", kind: "order_notification", to: "b@example.com", error: "timeout" }, resolved: true, created_at: "2026-09-01T02:00:00.000Z" },
      { id: "e3", type: "refund_failed", detail: { orderNo: "R1" }, resolved: false, created_at: "2026-09-01T03:00:00.000Z" },
    ],
  });
});

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("GET /api/admin/outbox — 인증 없으면 401", async () => {
  const res = await request(buildApp()).get("/api/admin/outbox");
  assert.strictEqual(res.status, 401);
});

test("GET /api/admin/outbox — 미해결 알림 발송 실패만 나오고, 다른 타입(refund_failed)은 안 섞인다", async () => {
  const res = await request(buildApp()).get("/api/admin/outbox").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.total, 1);
  assert.strictEqual(res.body.items[0].kind, "signup_confirm_resend");
  assert.strictEqual(res.body.items[0].to, "a@example.com");
});

test("GET /api/admin/outbox?resolved=true — 처리된 것만 볼 수 있다", async () => {
  const res = await request(buildApp()).get("/api/admin/outbox?resolved=true").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(res.body.total, 1);
  assert.strictEqual(res.body.items[0].kind, "order_notification");
});
