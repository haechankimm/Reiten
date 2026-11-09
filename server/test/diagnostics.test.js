process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, after } = require("node:test");
const assert = require("node:assert");
const { supabaseAdmin } = require("../lib/supabase");
const { buildDiagnosticReport, maskText } = require("../lib/diagnostics");

after(() => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

test("maskText — 이메일·전화·웹훅 주소·긴 비밀값을 가린다", () => {
  const out = maskText("a.b@test.co.kr 010-1234-5678 https://hooks.example.com/services/T000/B000/XXXX token abcdefghijklmnopqrstuvwxyz0123456789ABCD");
  assert.ok(!out.includes("@test"));
  assert.ok(!out.includes("1234-5678"));
  assert.ok(!out.includes("/services/"));
  assert.ok(!out.includes("abcdefghijklmnopqrstuvwxyz"));
  assert.ok(out.includes("[email]") && out.includes("[phone]") && out.includes("[secret]"));
});

test("진단 리포트 — 오류·결제 이상·멈춘 주문을 담고 개인정보는 가린다", async () => {
  const old = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
  supabaseAdmin.__reset({
    system_error_log: [{ id: "1", type: "refund_failed", detail: { order: "R1", email: "cust@mail.com" }, resolved: false, created_at: new Date().toISOString() }],
    payment_log: [{ id: "p", payment_id: "x", status: "failed", amount: 1000, method: "card", reason: "카드 한도 초과 010-1111-2222", created_at: new Date().toISOString() }],
    orders: [{ order_no: "O1", status: "입금대기", created_at: old }],
    return_requests: [{ id: "r1", status: "접수" }],
  });
  const report = await buildDiagnosticReport();
  assert.ok(report.includes("refund_failed"));
  assert.ok(report.includes("미해결 1건"));
  assert.ok(report.includes("입금대기 48시간 넘음: 1건"));
  assert.ok(!report.includes("cust@mail.com"));
  assert.ok(!report.includes("1111-2222"));
});
