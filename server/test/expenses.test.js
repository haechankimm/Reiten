/* 지출 장부·동업자 정산(2026-11-11, 052) — lib/expenses.js + routes/expenses.js + routes/supplierInvoices.js 확장 */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const ex = require("../lib/expenses");
const expenses = require("../routes/expenses");
const invoices = require("../routes/supplierInvoices");

const KEY = "k".repeat(40);
const AUTH = { Authorization: `Bearer ${fakeAdminToken("a1", "ceo@reiten.kr")}` };
const BOT = { "X-REITEN-BOT-KEY": KEY };
const PARTNERS = [
  { id: "ceo", name: "대표", email: "ceo@reiten.kr", share_percent: 50, active: true, created_at: "2026-01-01" },
  { id: "partner", name: "동업자", email: "p@reiten.kr", share_percent: 50, active: true, created_at: "2026-01-02" },
];
const app = () => { const a = express(); a.use(express.json()); a.use(invoices); a.use(expenses); return a; };
const rows = async (t) => (await supabaseAdmin.from(t).select("*")).data;
const exp = (over) => ({ id: `e${Math.random().toString(36).slice(2, 8)}`, supplier_name: "x", issued_on: "2026-11-05", total_amount: 10000, status: "CONFIRMED", category: "ads", funded_by: "business", shared: true, settlement_id: null, metadata: {}, ...over });

beforeEach(() => {
  process.env.REITEN_BOT_KEY = KEY;
  supabaseAdmin.__reset({
    profiles: [{ id: "a1", role: "admin" }],
    expense_partners: PARTNERS.map((p) => ({ ...p })),
    expense_budgets: [], expense_settlements: [], expense_recurring: [], admin_audit_log: [],
    supplier_invoices: [], orders: [],
    products: [{ id: "hoodie", name_ko: "후디", unit_cost: 20000, price: 59000, active: true }],
  });
});
after(() => { delete process.env.REITEN_BOT_KEY; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

test("computeSettlement — 50:50, 각자 낸 돈 기준으로 누가 누구에게 얼마", () => {
  const r = ex.computeSettlement([
    exp({ id: "1", funded_by: "ceo", total_amount: 30000 }),
    exp({ id: "2", funded_by: "partner", total_amount: 10001 }),
    exp({ id: "3", funded_by: "business", total_amount: 99999 }), // 사업자 돈 — 정산 대상 아님
    exp({ id: "4", funded_by: "ceo", total_amount: 5000, shared: false }), // 개인 부담 — 대상 아님
    exp({ id: "5", funded_by: "ceo", total_amount: 7000, status: "RECORDED" }), // 확인 전 — 대상 아님
  ], PARTNERS);
  assert.strictEqual(r.total, 40001);
  assert.deepStrictEqual(r.expenseIds.sort(), ["1", "2"]);
  assert.strictEqual(r.balances.reduce((n, b) => n + b.share, 0), 40001); // 끝전까지 맞음
  assert.strictEqual(r.transfers.length, 1);
  assert.strictEqual(r.transfers[0].from, "partner");
  assert.strictEqual(r.transfers[0].to, "ceo");
  assert.strictEqual(r.transfers[0].amount, 30000 - r.balances.find((b) => b.partnerId === "ceo").share);
});

test("vatDeductibility — 적격증빙·사업자 카드는 공제 후보, 개인 카드는 확인 필요, 접대비는 불공제", () => {
  assert.strictEqual(ex.vatDeductibility({ evidence_type: "tax_invoice", category: "purchase" }), "yes");
  assert.strictEqual(ex.vatDeductibility({ evidence_type: "card", payment_method: "personal_card", category: "ads" }), "check");
  assert.strictEqual(ex.vatDeductibility({ payment_method: "biz_check", category: "shipping" }), "yes");
  assert.strictEqual(ex.vatDeductibility({ evidence_type: "card", payment_method: "biz_check", category: "meals" }), "no");
  assert.deepStrictEqual(ex.splitVat({ total_amount: 11000, evidence_type: "tax_invoice", category: "ads" }), { supply: 10000, vat: 1000, estimated: true });
});

test("지출 직접 입력 — 분류·결제수단·낸 사람·카드 뒤 4자리, 잘못된 값은 400", async () => {
  const ok = await request(app()).post("/api/admin/supplier-invoices").set(AUTH).send({
    supplierName: "meta", supplierLabel: "메타 광고", issuedOn: "2026-11-03", totalAmount: 55000, docType: "receipt",
    category: "ads", paymentMethod: "personal_card", cardLast4: "1234-5678-9012-3456", fundedBy: "partner", evidenceType: "card", memo: "인스타 광고",
  });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.invoice.cardLast4, "3456");
  assert.strictEqual(ok.body.invoice.fundedBy, "partner");
  assert.strictEqual(ok.body.invoice.vatDeductible, "check");
  assert.strictEqual((await request(app()).post("/api/admin/supplier-invoices").set(AUTH).send({ supplierName: "x", issuedOn: "2026-11-03", totalAmount: 1, category: "nope" })).status, 400);
  assert.strictEqual((await request(app()).post("/api/admin/supplier-invoices").set(AUTH).send({ supplierName: "x", issuedOn: "2026-11-03", totalAmount: 1, cardLast4: "12" })).status, 400);
});

test("동업자 정산 — 미리보기 → 정산(지출에 표시) → 정산된 지출은 금액 수정 409 → 정산 취소로 풀림", async () => {
  supabaseAdmin.__reset({
    profiles: [{ id: "a1", role: "admin" }], expense_partners: PARTNERS.map((p) => ({ ...p })), expense_settlements: [], admin_audit_log: [],
    supplier_invoices: [exp({ id: "11111111-1111-4111-8111-111111111111", funded_by: "ceo", total_amount: 20000 }), exp({ id: "22222222-2222-4222-8222-222222222222", funded_by: "partner", total_amount: 0 })],
  });
  const pv = await request(app()).get("/api/admin/expenses/settlement/preview").set(AUTH);
  assert.strictEqual(pv.body.total, 20000);
  assert.strictEqual(pv.body.transfers[0].amount, 10000);
  assert.strictEqual((await request(app()).post("/api/admin/expenses/settlements").set(AUTH).send({ expectedTotal: 999 })).status, 409);
  const st = await request(app()).post("/api/admin/expenses/settlements").set(AUTH).send({ expectedTotal: 20000 });
  assert.strictEqual(st.status, 200);
  const sid = st.body.settlement.id;
  assert.ok((await rows("supplier_invoices")).every((r) => r.settlement_id === sid));
  const locked = await request(app()).patch("/api/admin/supplier-invoices/11111111-1111-4111-8111-111111111111").set(AUTH).send({ totalAmount: 30000 });
  assert.strictEqual(locked.status, 409);
  const memoOk = await request(app()).patch("/api/admin/supplier-invoices/11111111-1111-4111-8111-111111111111").set(AUTH).send({ memo: "메모는 수정 가능" });
  assert.strictEqual(memoOk.status, 200);
  assert.strictEqual((await request(app()).post("/api/admin/expenses/settlements").set(AUTH).send({})).status, 400); // 남은 정산 대상 없음
  const cancel = await request(app()).post(`/api/admin/expenses/settlements/${sid}/cancel`).set(AUTH);
  assert.strictEqual(cancel.status, 200);
  assert.ok((await rows("supplier_invoices")).every((r) => r.settlement_id === null));
  assert.strictEqual((await request(app()).patch("/api/admin/supplier-invoices/11111111-1111-4111-8111-111111111111").set(AUTH).send({ totalAmount: 30000 })).status, 200);
});

test("동업자 설정 — 비율 합 100%가 아니면 400", async () => {
  const bad = await request(app()).put("/api/admin/expenses/partners").set(AUTH).send({ partners: [{ id: "ceo", name: "대표", sharePercent: 60 }, { id: "partner", name: "동업자", sharePercent: 30 }] });
  assert.strictEqual(bad.status, 400);
  const ok = await request(app()).put("/api/admin/expenses/partners").set(AUTH).send({ partners: [{ id: "ceo", name: "해찬", email: "ceo@reiten.kr", sharePercent: 50 }, { id: "partner", name: "동업자", sharePercent: 50 }] });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.partners.find((p) => p.id === "ceo").name, "해찬");
  const meta = await request(app()).get("/api/admin/expenses/meta").set(AUTH);
  assert.strictEqual(meta.body.myPartnerId, "ceo");
});

test("CSV 가져오기 — 같은 거래는 다시 안 들어가고, 확인 대기로", async () => {
  const body = { rows: [{ date: "2026-11-02", merchant: "쿠팡", amount: "12,300", cardLast4: "9999" }, { date: "11/02", merchant: "x", amount: 1 }], defaults: { paymentMethod: "personal_card", fundedBy: "ceo", category: "office" } };
  const a = await request(app()).post("/api/admin/expenses/import").set(AUTH).send(body);
  assert.strictEqual(a.body.created, 1);
  assert.deepStrictEqual(a.body.invalid, [2]);
  const b = await request(app()).post("/api/admin/expenses/import").set(AUTH).send(body);
  assert.strictEqual(b.body.created, 0);
  assert.strictEqual(b.body.duplicates, 1);
  const r = (await rows("supplier_invoices"))[0];
  assert.strictEqual(r.status, "RECORDED");
  assert.strictEqual(r.total_amount, 12300);
  assert.strictEqual(r.evidence_type, "card");
});

test("정기 지출 — 결제일이 지나면 그달 한 번만 확인 대기로 생성", async () => {
  const c = await request(app()).post("/api/admin/expenses/recurring").set(AUTH).send({ name: "Render 서버", supplierName: "render", amount: 9000, dayOfMonth: 3, category: "software", paymentMethod: "biz_check" });
  assert.strictEqual(c.status, 200);
  const now = new Date("2026-11-05T03:00:00Z");
  assert.strictEqual((await expenses.generateRecurringExpenses({ now })).created, 1);
  assert.strictEqual((await expenses.generateRecurringExpenses({ now })).created, 0);
  const r = (await rows("supplier_invoices"))[0];
  assert.strictEqual(r.issued_on, "2026-11-03");
  assert.strictEqual(r.status, "RECORDED");
  assert.strictEqual((await expenses.generateRecurringExpenses({ now: new Date("2026-12-01T03:00:00Z") })).created, 0); // 12월 결제일(3일) 전
});

test("통계·예산·마진·내보내기·AI 요약(개인정보 없음)", async () => {
  supabaseAdmin.__reset({
    profiles: [{ id: "a1", role: "admin" }], expense_partners: PARTNERS.map((p) => ({ ...p })), admin_audit_log: [],
    expense_budgets: [{ category: "ads", monthly_amount: 50000 }],
    supplier_invoices: [exp({ id: "a", total_amount: 45000, category: "ads", card_last4: "1234", payment_method: "personal_card", evidence_type: "card", funded_by: "ceo" }), exp({ id: "b", total_amount: 20000, category: "shipping", issued_on: "2026-10-10" })],
    orders: [{ total: 118000, status: "입금확인", created_at: "2026-11-04T05:00:00Z", items: [{ productId: "hoodie", qty: 2, sum: 118000 }] }],
    products: [{ id: "hoodie", name_ko: "후디", unit_cost: 20000, price: 59000 }],
  });
  const s = await request(app()).get("/api/admin/expenses/stats?month=2026-11").set(AUTH);
  assert.strictEqual(s.body.confirmedTotal, 45000);
  assert.strictEqual(s.body.previousTotal, 20000);
  assert.strictEqual(s.body.revenue, 118000);
  assert.strictEqual(s.body.budgets[0].ratio, 0.9);
  const m = await request(app()).get("/api/admin/expenses/margin?month=2026-11").set(AUTH);
  assert.strictEqual(m.body.items[0].margin, 118000 - 40000);
  const csv = await request(app()).get("/api/admin/expenses/export?month=2026-11").set(AUTH);
  assert.match(csv.text, /계정과목/);
  assert.match(csv.text, /광고선전비/);
  const ai = await request(app()).get("/api/bot/expenses/summary?month=2026-11").set(BOT);
  assert.strictEqual(ai.status, 200);
  assert.match(ai.body.text, /광고·마케팅/);
  assert.ok(!JSON.stringify(ai.body).includes("1234"));
});

test("AI 지출 기록 — /api/bot/expenses로도 받고, 분류·결제수단을 함께 저장", async () => {
  const r = await request(app()).post("/api/bot/expenses").set(BOT).send({ supplierName: "render", supplierLabel: "Render", issuedOn: "2026-11-01", totalAmount: 9000, docType: "receipt", category: "software", paymentMethod: "biz_check", evidenceType: "card" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.invoice.category, "software");
  assert.strictEqual(r.body.invoice.status, "RECORDED");
});
