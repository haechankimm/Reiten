/* AI 승인함(2026-11-11, 054) — 제안(사전 검사·중복·권한 설정) → 승인/거절(묶음) → 실행(승인자 신분) → 되돌리기, 조건부 자동 승인 */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const { setDispatchOverride } = require("../lib/internalDispatch");
const agent = require("../routes/agentActions");
const invoices = require("../routes/supplierInvoices");
const { MASTER_ADMIN_EMAIL } = require("../lib/auth");

const KEY = "k".repeat(40);
const BOT = { "X-REITEN-BOT-KEY": KEY };
const MASTER = { Authorization: `Bearer ${fakeAdminToken("m1", MASTER_ADMIN_EMAIL)}` };
const STAFF = { Authorization: `Bearer ${fakeAdminToken("s1", "staff@reiten.kr")}` };
const E1 = "11111111-1111-4111-8111-111111111111";

function app() {
  const a = express();
  a.use(express.json());
  a.use(agent);
  return a;
}
/* 내부 실행을 실제 지출 라우트로 흘려 보내는 앱(되돌리기까지 끝까지 확인용) */
const execApp = express();
execApp.use(express.json());
execApp.use((req, res, next) => {
  const actor = JSON.parse(Buffer.from(req.headers["x-test-actor"], "base64").toString());
  req.user = actor; req.adminVerified = true; req.isMasterAdmin = !!actor.isMaster; req.agentActionId = req.headers["x-test-action"];
  next();
});
execApp.use(invoices);

let calls = [];
const rows = async (t) => (await supabaseAdmin.from(t).select("*")).data;
const propose = (body) => request(app()).post("/api/bot/actions").set(BOT).send(body);

beforeEach(() => {
  process.env.REITEN_BOT_KEY = KEY;
  calls = [];
  setDispatchOverride(async (opts) => {
    calls.push(opts);
    if (opts.path.startsWith("/api/admin/supplier-invoices")) {
      const r = await request(execApp)[opts.method.toLowerCase()](opts.path)
        .set("x-test-actor", Buffer.from(JSON.stringify(opts.actor)).toString("base64")).set("x-test-action", opts.actionId || "").send(opts.body || {});
      return { status: r.status, body: r.body };
    }
    return { status: 200, body: { ok: true } };
  });
  supabaseAdmin.__reset({
    profiles: [{ id: "m1", role: "admin" }, { id: "s1", role: "admin" }],
    admin_permissions: [{ user_id: "s1", permissions: { orders: "view", expenses: "edit" } }],
    agent_actions: [], agent_policy: [], admin_audit_log: [],
    orders: [
      { order_no: "R1", status: "입금확인", total: 59000, payment_method: "bank", tracking_no: null },
      { order_no: "R2", status: "입금대기", total: 89000, payment_method: "bank" },
      { order_no: "R3", status: "입금대기", total: 30000, payment_method: "bank" },
      { order_no: "R4", status: "입금대기", total: 30000, payment_method: "card" },
    ],
    supplier_invoices: [{ id: E1, supplier_name: "render", issued_on: "2026-11-01", total_amount: 9000, status: "RECORDED", category: "other", metadata: {} }],
  });
});
after(() => { setDispatchOverride(null); delete process.env.REITEN_BOT_KEY; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

test("제안 — 서버가 미리 검사해 안 되는 건 바로 반려, 되는 건 바뀔 내용과 함께 대기, 같은 제안은 한 번만", async () => {
  const ok = await propose({ type: "tracking_input", params: { orderNo: "R1", courier: "cj", trackingNo: "6013-7348-3215" }, reason: "CJ 출고 메일" });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.action.status, "PENDING");
  assert.deepStrictEqual(ok.body.action.preview.lines[0], { label: "주문 상태", before: "입금확인", after: "배송중" });
  const dup = await propose({ type: "tracking_input", params: { orderNo: "R1", courier: "cj", trackingNo: "601373483215" } });
  assert.strictEqual(dup.body.duplicate, true);
  assert.strictEqual((await rows("agent_actions")).length, 1);
  assert.strictEqual((await propose({ type: "tracking_input", params: { orderNo: "R2", courier: "cj", trackingNo: "601373483215" } })).status, 422); // 입금대기
  const mismatch = await propose({ type: "deposit_confirm", params: { orderNo: "R2", amount: 88000 } });
  assert.strictEqual(mismatch.status, 422);
  assert.match(mismatch.body.error, /금액이 다릅니다/);
  assert.strictEqual((await propose({ type: "deposit_confirm", params: { orderNo: "R4", amount: 30000 } })).status, 422); // 카드
  assert.strictEqual((await propose({ type: "refund_order", params: {} })).status, 400); // 없는 작업
});

test("AI 권한 설정 — 리뷰 승인은 기본 꺼짐, 전체 끄면 모든 제안 403", async () => {
  assert.strictEqual((await propose({ type: "review_approve", params: { reviewId: "x" } })).status, 403);
  await request(app()).put("/api/admin/agent-policy").set(MASTER).send({ policy: { enabled: false } });
  const off = await propose({ type: "deposit_confirm", params: { orderNo: "R2", amount: 89000 } });
  assert.strictEqual(off.status, 403);
  assert.strictEqual(off.body.code, "AGENT_DISABLED");
  const pol = await request(app()).get("/api/bot/actions/policy").set(BOT);
  assert.strictEqual(pol.body.enabled, false);
});

test("묶어서 승인 — 승인자 신분으로 기존 관리자 API 호출, 그 사이 상태가 바뀐 건 실행 안 함, 로그", async () => {
  const a = (await propose({ type: "deposit_confirm", params: { orderNo: "R2", amount: 89000 } })).body.action.id;
  const b = (await propose({ type: "deposit_confirm", params: { orderNo: "R3", amount: 30000 } })).body.action.id;
  // R3는 그 사이 사람이 직접 처리
  (await supabaseAdmin.from("orders").update({ status: "입금확인" }).eq("order_no", "R3"));
  const res = await request(app()).post("/api/admin/agent-actions/decide").set(MASTER).send({ ids: [a, b], decision: "approve" });
  assert.strictEqual(res.status, 200);
  const byId = Object.fromEntries(res.body.results.map((r) => [r.id, r]));
  assert.strictEqual(byId[a].status, "EXECUTED");
  assert.strictEqual(byId[b].status, "FAILED");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].path, "/api/admin/orders/R2");
  assert.deepStrictEqual(calls[0].body, { status: "입금확인", expected: { status: "입금대기" } });
  assert.strictEqual(calls[0].actor.email, MASTER_ADMIN_EMAIL);
  assert.strictEqual(calls[0].actionId, String(a));
  await new Promise((r) => setImmediate(r));
  assert.ok((await rows("admin_audit_log")).some((l) => l.action === "agent.approve"));
  assert.strictEqual((await request(app()).post("/api/admin/agent-actions/decide").set(MASTER).send({ ids: [a], decision: "approve" })).body.results[0].ok, false); // 두 번 승인 안 됨
});

test("권한 — 주문 '보기'만 있는 직원은 입금 확인을 승인할 수 없고, 거절은 기록된다", async () => {
  const a = (await propose({ type: "deposit_confirm", params: { orderNo: "R2", amount: 89000 } })).body.action.id;
  const staff = await request(app()).post("/api/admin/agent-actions/decide").set(STAFF).send({ ids: [a], decision: "approve" });
  assert.match(staff.body.results[0].error, /권한/);
  assert.strictEqual(calls.length, 0);
  const rej = await request(app()).post("/api/admin/agent-actions/decide").set(MASTER).send({ ids: [a], decision: "reject", note: "입금자명 다름" });
  assert.strictEqual(rej.body.results[0].status, "REJECTED");
  const bot = await request(app()).get(`/api/bot/actions?ids=${a}`).set(BOT);
  assert.strictEqual(bot.body.items[0].status, "REJECTED");
});

test("지출 확인 → 실제 실행 → 되돌리기까지(원래 로그에 AI 제안 번호)", async () => {
  const id = (await propose({ type: "expense_confirm", params: { expenseId: E1, category: "software" } })).body.action.id;
  const res = await request(app()).post("/api/admin/agent-actions/decide").set(STAFF).send({ ids: [id], decision: "approve" });
  assert.strictEqual(res.body.results[0].status, "EXECUTED");
  let e = (await rows("supplier_invoices"))[0];
  assert.strictEqual(e.status, "CONFIRMED");
  assert.strictEqual(e.category, "software");
  await new Promise((r) => setImmediate(r));
  const log = (await rows("admin_audit_log")).find((l) => l.action === "supplier_invoice.update");
  assert.strictEqual(log.detail.viaAgentAction, String(id));
  const undo = await request(app()).post(`/api/admin/agent-actions/${id}/undo`).set(STAFF);
  assert.strictEqual(undo.status, 200);
  e = (await rows("supplier_invoices"))[0];
  assert.strictEqual(e.status, "RECORDED");
  assert.strictEqual(e.category, "other");
  assert.strictEqual((await request(app()).get("/api/admin/agent-actions?view=history").set(MASTER)).body.items[0].status, "UNDONE");
});

test("조건부 자동 승인 — 메인 관리자가 켠 작업만, 금액 상한 안이면 바로 실행·넘으면 대기", async () => {
  await request(app()).put("/api/admin/agent-policy").set(MASTER).send({ policy: { actions: { deposit_confirm: { enabled: true, autoApprove: true, autoDailyLimit: 5, autoMaxAmount: 50000 } } } });
  const small = await propose({ type: "deposit_confirm", params: { orderNo: "R3", amount: 30000 } });
  assert.strictEqual(small.body.autoApproved, true);
  assert.strictEqual(small.body.action.status, "EXECUTED");
  assert.strictEqual(calls[0].actor.email, "bot:pickle(자동 승인)");
  const big = await propose({ type: "deposit_confirm", params: { orderNo: "R2", amount: 89000 } });
  assert.strictEqual(big.body.action.status, "PENDING");
  // 자동 승인이 허용되지 않는 작업(고객에게 글이 나가는 답변)은 설정해도 꺼진 채
  const pol = await request(app()).put("/api/admin/agent-policy").set(MASTER).send({ policy: { actions: { qna_answer: { enabled: true, autoApprove: true } } } });
  assert.strictEqual(pol.body.policy.actions.qna_answer.autoApprove, false);
});
