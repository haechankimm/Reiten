process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const calendarRouter = require("../routes/calendar");
const { normalizeEnd } = calendarRouter;

after(() => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

test("normalizeEnd — 비우거나 같은 날이면 하루짜리, 역순·1년 초과는 거부", () => {
  assert.deepEqual(normalizeEnd("2026-10-03", ""), { end: null });
  assert.deepEqual(normalizeEnd("2026-10-03", "2026-10-03"), { end: null });
  assert.deepEqual(normalizeEnd("2026-10-03", "2026-10-15"), { end: "2026-10-15" });
  assert.ok(normalizeEnd("2026-10-03", "2026-10-01").error);
  assert.ok(normalizeEnd("2026-10-03", "2027-12-01").error);
  assert.ok(normalizeEnd("2026-10-03", "10/15").error);
});

test("POST — 기간 일정이 한 건으로 저장되고 endDate가 내려온다", async () => {
  supabaseAdmin.__reset({ profiles: [{ id: "a1", role: "admin" }], calendar_events: [] });
  const app = express();
  app.use(express.json());
  app.use(calendarRouter);
  const r = await request(app)
    .post("/api/admin/calendar-events")
    .set("Authorization", `Bearer ${fakeAdminToken("a1", "a@example.com")}`)
    .send({ title: "가을 세일", date: "2026-10-03", endDate: "2026-10-15", color: "red" });
  assert.equal(r.status, 200);
  assert.equal(r.body.date, "2026-10-03");
  assert.equal(r.body.endDate, "2026-10-15");
  const bad = await request(app)
    .post("/api/admin/calendar-events")
    .set("Authorization", `Bearer ${fakeAdminToken("a1", "a@example.com")}`)
    .send({ title: "x", date: "2026-10-03", endDate: "2026-10-01" });
  assert.equal(bad.status, 400);
});
