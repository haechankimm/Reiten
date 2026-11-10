/* routes/botDiagnostics.js — 에이전트 전용 읽기 전용 진단 */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const router = require("../routes/botDiagnostics");

const KEY = "k".repeat(40);
function app() {
  const a = express();
  a.use(express.json());
  a.use(router);
  return a;
}

beforeEach(() => {
  process.env.REITEN_BOT_KEY = KEY;
  supabaseAdmin.__reset({
    system_error_log: [
      { id: "1", type: "refund_failed", detail: { email: "cust@mail.com", note: "x" }, resolved: false, created_at: new Date().toISOString() },
      { id: "2", type: "refund_failed", detail: {}, resolved: true, created_at: new Date(Date.now() - 3600e3).toISOString() },
    ],
    payment_log: [],
    orders: [{ order_no: "O1", status: "입금대기", created_at: new Date(Date.now() - 100 * 3600e3).toISOString(), customer: { name: "홍길동", tel: "01012345678" } }],
    return_requests: [],
    admin_audit_log: [],
  });
});

after(() => {
  delete process.env.REITEN_BOT_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("키가 맞으면 묶인 오류·주문 건수·텍스트 리포트를 준다(개인정보 없음)", async () => {
  const res = await request(app()).get("/api/bot/diagnostics").set("X-REITEN-BOT-KEY", KEY);
  assert.strictEqual(res.status, 200);
  const g = res.body.systemErrors7d.find((e) => e.type === "refund_failed");
  assert.strictEqual(g.count, 2);
  assert.strictEqual(g.unresolved, 1);
  assert.strictEqual(res.body.orders.pendingOver48h, 1);
  assert.ok(typeof res.body.report === "string" && res.body.report.includes("REITEN 진단 리포트"));
  const raw = JSON.stringify(res.body);
  for (const secret of ["cust@mail.com", "홍길동", "01012345678"]) assert.ok(!raw.includes(secret), secret);
  assert.strictEqual(res.headers["cache-control"], "no-store");
  const log = (await supabaseAdmin.from("admin_audit_log").select("*")).data;
  assert.strictEqual(log[0].action, "bot.diagnostics_read");
});

test("키가 틀리거나 없으면 403", async () => {
  assert.strictEqual((await request(app()).get("/api/bot/diagnostics")).status, 403);
  assert.strictEqual((await request(app()).get("/api/bot/diagnostics").set("X-REITEN-BOT-KEY", "k".repeat(39))).status, 403);
});

test("서버에 키가 없거나 32자 미만이면 경로 자체가 꺼진다(404)", async () => {
  delete process.env.REITEN_BOT_KEY;
  assert.strictEqual((await request(app()).get("/api/bot/diagnostics").set("X-REITEN-BOT-KEY", "")).status, 404);
  process.env.REITEN_BOT_KEY = "short";
  assert.strictEqual((await request(app()).get("/api/bot/diagnostics").set("X-REITEN-BOT-KEY", "short")).status, 404);
});

test("쓰기 메서드는 없다", async () => {
  for (const m of ["post", "put", "patch", "delete"]) {
    const res = await request(app())[m]("/api/bot/diagnostics").set("X-REITEN-BOT-KEY", KEY);
    assert.strictEqual(res.status, 404, m);
  }
});
