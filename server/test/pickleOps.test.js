/* 피클 업무 확장(2026-11-10, 마이그레이션 050) — 공급처 배송조회 보고, 입고→재고, 매입 장부, 브리핑, 문의 답변 초안 */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const shipments = require("../routes/supplierShipments");
const invoices = require("../routes/supplierInvoices");
const botAssist = require("../routes/botAssist");
const qna = require("../routes/qna");
const supplierLib = require("../lib/supplierShipments");
const { buildSettlement } = require("../lib/settlement");

const KEY = "k".repeat(40);
const ADMIN = { id: "admin-1", email: "admin@example.com" };
const AUTH = { Authorization: `Bearer ${fakeAdminToken(ADMIN.id, ADMIN.email)}` };
const BOT = { "X-REITEN-BOT-KEY": KEY };
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const Q1 = "33333333-3333-4333-8333-333333333333";
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();

function app() {
  const a = express();
  a.use(express.json());
  a.use(shipments);
  a.use(invoices);
  a.use(botAssist);
  a.use(qna);
  return a;
}
const rows = async (t) => (await supabaseAdmin.from(t).select("*")).data;
const ship = (over = {}) => ({
  id: S1, supplier_name: "printcanvas", supplier_label: "프린트캔버스", carrier_code: "kr.cjlogistics", tracking_number: "601373483215",
  recipient_name: "김대표", items_summary: "후드 XL 10벌", status: "SHIPPED", shipped_at: hoursAgo(30), tracking_checked_at: null, metadata: {}, ...over,
});

beforeEach(() => {
  process.env.REITEN_BOT_KEY = KEY;
  supabaseAdmin.__reset({
    profiles: [{ id: ADMIN.id, role: "admin" }],
    supplier_shipments: [ship(), ship({ id: S2, tracking_number: "999988887777", tracking_checked_at: hoursAgo(1) })],
    products: [{ id: "hoodie", name_ko: "리플렉트 후디", colors: ["black", "gray"], sizes: ["M", "L", "XL"] }],
    inventory: [{ product_id: "hoodie", color: "black", size: "XL", qty: 0 }],
    inventory_log: [],
    restock_subscriptions: [],
    supplier_invoices: [],
    qna: [
      { id: Q1, product_id: "hoodie", name: "홍길동", email: "hong@mail.com", question: "XL 재입고 언제인가요? 연락처 010-1234-5678", secret: false, status: "답변대기", created_at: hoursAgo(5) },
    ],
    qna_templates: [{ id: "t1", label: "재입고", body: "재입고는 보통 2주 걸립니다." }],
    admin_audit_log: [],
  });
});

after(() => {
  delete process.env.REITEN_BOT_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

/* ---------- 공급처 배송조회: 피클 담당 ---------- */
test("기본 설정에서는 서버가 스마트택배로 공급처 송장을 조회하지 않는다(피클 담당)", async () => {
  process.env.SWEETTRACKER_API_KEY = "x";
  try {
    const r = await supplierLib.checkSupplierShipments({ fetchImpl: async () => { throw new Error("호출되면 안 됨"); } });
    assert.strictEqual(r.skipped, "pickle");
  } finally { delete process.env.SWEETTRACKER_API_KEY; }
});

test("조회 대기 목록 — 최근에 조회한 송장은 빼고, 받는 사람 이름은 주지 않는다", async () => {
  const res = await request(app()).get("/api/bot/supplier-shipments/pending").set(BOT);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.items.map((i) => i.id), [S1]);
  assert.match(res.body.items[0].trackingUrl, /cjlogistics/);
  assert.ok(!JSON.stringify(res.body).includes("김대표"));
  assert.strictEqual((await request(app()).get("/api/bot/supplier-shipments/pending")).status, 403);
});

test("피클 배송조회 보고 — 배송완료면 DELIVERED + 단계 기록, 출처 pickle", async () => {
  const res = await request(app()).post(`/api/bot/supplier-shipments/${S1}/tracking`).set(BOT)
    .send({ delivered: true, statusText: "배달완료", events: [{ at: "2026-11-11 10:00", where: "성수", kind: "집화" }, { at: "2026-11-12 11:00", where: "강남", kind: "배달완료" }] });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.shipment.status, "DELIVERED");
  assert.strictEqual(res.body.shipment.trackingEvents.length, 2);
  assert.strictEqual(res.body.shipment.trackingSource, "pickle");
  assert.ok(res.body.shipment.deliveredAt);
});

test("피클 배송조회 보고 — 입력 검사, 입고 완료된 송장은 상태를 바꾸지 않는다", async () => {
  assert.strictEqual((await request(app()).post(`/api/bot/supplier-shipments/${S1}/tracking`).set(BOT).send({ statusText: "?" })).status, 400);
  assert.strictEqual((await request(app()).post("/api/bot/supplier-shipments/abc/tracking").set(BOT).send({ delivered: true })).status, 404);
  supabaseAdmin.__reset({ supplier_shipments: [ship({ status: "RECEIVED" })] });
  const res = await request(app()).post(`/api/bot/supplier-shipments/${S1}/tracking`).set(BOT).send({ delivered: true });
  assert.strictEqual(res.body.shipment.status, "RECEIVED");
  // 조회 실패 보고는 오류만 남긴다
  const err = await request(app()).post(`/api/bot/supplier-shipments/${S1}/tracking`).set(BOT).send({ error: "조회 화면 접속 실패" });
  assert.strictEqual(err.body.shipment.trackingError, "조회 화면 접속 실패");
});

/* ---------- 입고 → 재고 ---------- */
test("피클이 보낸 입고 품목 초안이 저장된다(상품을 못 찾았으면 name만)", async () => {
  const res = await request(app()).post("/api/bot/supplier-shipments").set(BOT).send({
    supplierName: "printcanvas", carrierCode: "kr.cjlogistics", trackingNumber: "601373483215",
    receiptItems: [{ productId: "hoodie", color: "black", size: "XL", qty: 10 }, { name: "라벨 원단", qty: 3 }],
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.shipment.receiptItems.length, 2);
  const bad = await request(app()).post("/api/bot/supplier-shipments").set(BOT).send({ supplierName: "x", carrierCode: "kr.epost", trackingNumber: "123456789", receiptItems: [{ qty: 0, name: "a" }] });
  assert.strictEqual(bad.status, 400);
});

test("입고 처리 — 재고에 더하고 이력(supplier_receipt)을 남기며, 두 번 눌러도 한 번만 더해진다", async () => {
  const items = [{ productId: "hoodie", color: "black", size: "XL", qty: 10 }, { productId: "hoodie", color: "black", size: "XL", qty: 2 }, { productId: "hoodie", color: "gray", size: "M", qty: 5 }];
  const res = await request(app()).post(`/api/admin/supplier-shipments/${S1}/receive`).set(AUTH).send({ items });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.shipment.status, "RECEIVED");
  assert.ok(res.body.shipment.receivedAt);
  const inv = await rows("inventory");
  assert.strictEqual(inv.find((r) => r.color === "black" && r.size === "XL").qty, 12);
  assert.strictEqual(inv.find((r) => r.color === "gray" && r.size === "M").qty, 5);
  await new Promise((r) => setImmediate(r));
  const log = await rows("inventory_log");
  assert.ok(log.length === 2 && log.every((l) => l.reason === "supplier_receipt"));
  const again = await request(app()).post(`/api/admin/supplier-shipments/${S1}/receive`).set(AUTH).send({ items });
  assert.strictEqual(again.status, 409);
  assert.strictEqual((await rows("inventory")).find((r) => r.color === "black" && r.size === "XL").qty, 12);
});

test("입고 처리 — 없는 색상·사이즈는 400, 품목 없이 입고 완료만도 가능", async () => {
  const bad = await request(app()).post(`/api/admin/supplier-shipments/${S1}/receive`).set(AUTH).send({ items: [{ productId: "hoodie", color: "red", size: "XL", qty: 1 }] });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual((await rows("supplier_shipments")).find((r) => r.id === S1).status, "SHIPPED");
  const only = await request(app()).post(`/api/admin/supplier-shipments/${S1}/receive`).set(AUTH).send({ items: [] });
  assert.strictEqual(only.status, 200);
  assert.strictEqual(only.body.addedToInventory, 0);
});

/* ---------- 매입 장부 ---------- */
const INV = { supplierName: "PrintCanvas", supplierLabel: "프린트캔버스", docType: "tax_invoice", docNumber: "2026111012345", issuedOn: "2026-11-09", supplyAmount: "100,000", vatAmount: 10000, totalAmount: 110000, itemsSummary: "후드 인쇄 10벌", trackingNumber: "6013-7348-3215" };

test("매입 기록 — 같은 문서는 한 줄, 송장과 연결, 금액 글자도 숫자로", async () => {
  const a = await request(app()).post("/api/bot/supplier-invoices").set(BOT).send(INV);
  assert.strictEqual(a.status, 200);
  assert.strictEqual(a.body.created, true);
  assert.strictEqual(a.body.invoice.supplyAmount, 100000);
  assert.strictEqual(a.body.invoice.shipmentId, S1);
  const b = await request(app()).post("/api/bot/supplier-invoices").set(BOT).send({ ...INV, itemsSummary: "후드 인쇄 10벌(수정)" });
  assert.strictEqual(b.body.created, false);
  assert.strictEqual((await rows("supplier_invoices")).length, 1);
  // 문서번호 없는 영수증 — 같은 날·같은 금액이면 같은 줄
  await request(app()).post("/api/bot/supplier-invoices").set(BOT).send({ supplierName: "원단도매", docType: "receipt", issuedOn: "2026-11-09", totalAmount: 33000 });
  await request(app()).post("/api/bot/supplier-invoices").set(BOT).send({ supplierName: "원단도매", docType: "receipt", issuedOn: "2026-11-09", totalAmount: 33000 });
  assert.strictEqual((await rows("supplier_invoices")).length, 2);
});

test("매입 기록 — 입력 검사, 금액 불일치 표시, 확인된 줄은 피클이 못 바꾼다", async () => {
  assert.strictEqual((await request(app()).post("/api/bot/supplier-invoices").set(BOT).send({ ...INV, issuedOn: "11/09" })).status, 400);
  assert.strictEqual((await request(app()).post("/api/bot/supplier-invoices").set(BOT).send({ ...INV, totalAmount: undefined })).status, 400);
  const m = await request(app()).post("/api/bot/supplier-invoices").set(BOT).send({ ...INV, totalAmount: 120000 });
  assert.strictEqual(m.body.amountMismatch, true);
  const id = m.body.invoice.id;
  const ok = await request(app()).patch(`/api/admin/supplier-invoices/${id}`).set(AUTH).send({ status: "CONFIRMED", totalAmount: 110000 });
  assert.strictEqual(ok.body.invoice.status, "CONFIRMED");
  const again = await request(app()).post("/api/bot/supplier-invoices").set(BOT).send({ ...INV, totalAmount: 999 });
  assert.strictEqual(again.body.unchanged, true);
  assert.strictEqual((await rows("supplier_invoices"))[0].total_amount, 110000);
});

test("매입 장부 목록·월간 정산 — 확인된 매입만 합계에 들어간다", async () => {
  const a = (await request(app()).post("/api/bot/supplier-invoices").set(BOT).send(INV)).body.invoice.id;
  await request(app()).post("/api/bot/supplier-invoices").set(BOT).send({ supplierName: "원단도매", issuedOn: "2026-11-02", totalAmount: 50000 });
  await request(app()).patch(`/api/admin/supplier-invoices/${a}`).set(AUTH).send({ status: "CONFIRMED" });
  const list = await request(app()).get("/api/admin/supplier-invoices?month=2026-11").set(AUTH);
  assert.deepStrictEqual(list.body.totals, { confirmed: 110000, recorded: 50000 });
  assert.strictEqual(list.body.bySupplier[0].label, "프린트캔버스");
  supabaseAdmin.from("orders"); supabaseAdmin.from("return_requests");
  const s = await buildSettlement("2026-11");
  assert.strictEqual(s.summary.purchaseTotal, 110000);
  assert.strictEqual(s.summary.purchasePending, 50000);
  assert.strictEqual(s.summary.grossProfit, s.summary.netRevenue - 110000);
});

/* ---------- 브리핑 ---------- */
test("브리핑 — 입고 대기·멈춘 송장·확인 대기 매입·초안 없는 문의를 요약, 고객 정보 없음", async () => {
  supabaseAdmin.__reset({
    supplier_shipments: [ship({ status: "DELIVERED", delivered_at: hoursAgo(2) }), ship({ id: S2, tracking_number: "1111", shipped_at: hoursAgo(24 * 7) })],
    supplier_invoices: [{ id: "i1", supplier_name: "a", status: "RECORDED", total_amount: 5000, issued_on: new Date().toISOString().slice(0, 10) }],
    qna: [{ id: Q1, status: "답변대기", name: "홍길동", question: "q", ai_draft: null }],
    orders: [], return_requests: [], system_error_log: [], admin_audit_log: [],
  });
  const res = await request(app()).get("/api/bot/briefing").set(BOT);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.suppliers.awaitingReceipt.length, 1);
  assert.strictEqual(res.body.suppliers.stalled.length, 1);
  assert.strictEqual(res.body.invoices.pendingCount, 1);
  assert.strictEqual(res.body.qna.withoutDraft, 1);
  assert.match(res.body.summary, /입고 대기 1건/);
  assert.ok(!JSON.stringify(res.body).includes("홍길동"));
  assert.ok(!JSON.stringify(res.body).includes("김대표"));
});

/* ---------- 문의 답변 초안 ---------- */
test("답변 대기 문의 — 작성자 이름·이메일 없이, 질문 속 연락처는 가려서 준다", async () => {
  const res = await request(app()).get("/api/bot/qna/pending").set(BOT);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.items[0].productName, "리플렉트 후디");
  const raw = JSON.stringify(res.body);
  for (const secret of ["홍길동", "hong@mail.com", "010-1234-5678"]) assert.ok(!raw.includes(secret), secret);
  assert.strictEqual(res.body.templates[0].label, "재입고");
});

test("답변 초안 — 저장되고 Works에 보이지만 고객 답변은 아니다, 답변 끝난 문의엔 못 쓴다", async () => {
  const ok = await request(app()).post(`/api/bot/qna/${Q1}/draft`).set(BOT).send({ draft: "안녕하세요, 리플렉트 후디 XL은 다음 주 재입고 예정입니다." });
  assert.strictEqual(ok.status, 200);
  const q = (await rows("qna"))[0];
  assert.strictEqual(q.status, "답변대기");
  assert.ok(!q.answer);
  const admin = await request(app()).get("/api/admin/qna").set(AUTH);
  assert.match(admin.body.items[0].aiDraft, /재입고 예정/);
  const pub = await request(app()).get("/api/qna");
  assert.ok(!JSON.stringify(pub.body).includes("재입고 예정"));
  q.status = "답변완료";
  supabaseAdmin.__reset({ qna: [q] });
  assert.strictEqual((await request(app()).post(`/api/bot/qna/${Q1}/draft`).set(BOT).send({ draft: "x" })).status, 409);
  assert.strictEqual((await request(app()).post(`/api/bot/qna/${Q1}/draft`).set(BOT).send({ draft: "" })).status, 400);
});
