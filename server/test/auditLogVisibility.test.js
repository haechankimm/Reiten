/* routes/auditLog.js — 직원 권한·PIN·관리자 계정 기록은 마스터만(2026-11-11) */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const router = require("../routes/auditLog");

after(() => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

function app(isMaster) {
  const a = express();
  a.use((req, res, next) => { req.adminVerified = true; req.isMasterAdmin = isMaster; req.user = { id: "u", email: "x@x" }; next(); });
  a.use(router);
  return a;
}

test("직원은 staff.*·admin.* 기록을 볼 수 없고 마스터는 본다", async () => {
  supabaseAdmin.__reset({ admin_audit_log: [
    { id: 1, action: "staff.permissions", at: "2026-11-11T01:00:00Z" },
    { id: 2, action: "admin.invite", at: "2026-11-11T02:00:00Z" },
    { id: 3, action: "order.update", at: "2026-11-11T03:00:00Z" },
  ] });
  const staff = await request(app(false)).get("/api/admin/audit-log");
  assert.deepStrictEqual(staff.body.items.map((i) => i.action), ["order.update"]);
  const staffFilter = await request(app(false)).get("/api/admin/audit-log?action=staff.permissions");
  assert.strictEqual(staffFilter.body.items.length, 0);
  const master = await request(app(true)).get("/api/admin/audit-log");
  assert.strictEqual(master.body.items.length, 3);
});
