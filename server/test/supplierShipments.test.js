/* routes/supplierShipments.js — 에이전트 공급처 송장 기록 + Works 목록·입고 처리 */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const router = require("../routes/supplierShipments");
const { normalizeBotShipment, buildUpdate, trackingUrl } = router;

const KEY = "k".repeat(40);
const ADMIN = { id: "admin-1", email: "admin@example.com" };
const TOKEN = fakeAdminToken(ADMIN.id, ADMIN.email);
const URL = "/api/bot/supplier-shipments";

function app() {
  const a = express();
  a.use(express.json());
  a.use(router);
  return a;
}
const post = (body) => request(app()).post(URL).set("X-REITEN-BOT-KEY", KEY).send(body);
const rows = async () => (await supabaseAdmin.from("supplier_shipments").select("*")).data;

const SAMPLE = {
  supplierName: "PrintCanvas",
  supplierOrderId: "20261109-0000047",
  carrierCode: "kr.cjlogistics",
  carrierName: "CJ대한통운",
  trackingNumber: "6013-7348-3215",
  itemsSummary: "오버핏 쭈리 후드(차콜) XL 1벌",
  metadata: { gmailId: "abc" },
};

beforeEach(() => {
  process.env.REITEN_BOT_KEY = KEY;
  supabaseAdmin.__reset({
    profiles: [{ id: ADMIN.id, role: "admin", created_at: "2026-01-01T00:00:00.000Z" }],
    supplier_shipments: [],
    admin_audit_log: [],
  });
});

after(() => {
  delete process.env.REITEN_BOT_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("키가 없거나 틀리면 403, 서버 키가 없으면 404", async () => {
  assert.strictEqual((await request(app()).post(URL).send(SAMPLE)).status, 403);
  assert.strictEqual((await request(app()).post(URL).set("X-REITEN-BOT-KEY", "x".repeat(40)).send(SAMPLE)).status, 403);
  delete process.env.REITEN_BOT_KEY;
  assert.strictEqual((await post(SAMPLE)).status, 404);
  assert.strictEqual((await rows()).length, 0);
});

test("새 송장 기록 — 공급처명 소문자, 송장번호 하이픈 제거, 기본 상태 SHIPPED, 배송조회 링크", async () => {
  const res = await post(SAMPLE);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.created, true);
  const s = res.body.shipment;
  assert.strictEqual(s.supplierName, "printcanvas");
  assert.strictEqual(s.trackingNumber, "601373483215");
  assert.strictEqual(s.status, "SHIPPED");
  assert.ok(s.shippedAt);
  assert.strictEqual(s.trackingUrl, "https://trace.cjlogistics.com/next/tracking.html?wblNo=601373483215");
  const log = (await supabaseAdmin.from("admin_audit_log").select("*")).data;
  assert.strictEqual(log[0].action, "bot.supplier_shipment_create");
  assert.strictEqual(log[0].admin_email, "bot:pickle");
});

test("같은 공급처+송장번호는 한 줄로 갱신 — 상태는 앞으로만, metadata는 합치고 출고일은 유지", async () => {
  const first = (await post(SAMPLE)).body.shipment;
  const r2 = await post({ ...SAMPLE, supplierName: "printcanvas ", trackingNumber: "601373483215", status: "DELIVERED", metadata: { fee: 3000 } });
  assert.strictEqual(r2.body.created, false);
  assert.strictEqual(r2.body.shipment.status, "DELIVERED");
  assert.ok(r2.body.shipment.deliveredAt);
  assert.deepStrictEqual(r2.body.shipment.metadata, { gmailId: "abc", fee: 3000 });
  assert.strictEqual(r2.body.shipment.shippedAt, first.shippedAt);
  // 같은 "출고" 메일이 다시 와도 배송완료가 되돌아가지 않는다
  const r3 = await post({ ...SAMPLE, status: "SHIPPED" });
  assert.strictEqual(r3.body.shipment.status, "DELIVERED");
  assert.strictEqual((await rows()).length, 1);
});

test("입력 검사 — 필수값 누락·이상한 상태·날짜·metadata는 400", async () => {
  assert.strictEqual((await post({ ...SAMPLE, trackingNumber: "" })).status, 400);
  assert.strictEqual((await post({ ...SAMPLE, carrierCode: undefined })).status, 400);
  assert.strictEqual((await post({ ...SAMPLE, trackingNumber: "12-3" })).status, 400);
  assert.strictEqual((await post({ ...SAMPLE, carrierCode: "<script>" })).status, 400);
  assert.strictEqual((await post({ ...SAMPLE, status: "RECEIVED" })).status, 400);
  assert.strictEqual((await post({ ...SAMPLE, shippedAt: "어제" })).status, 400);
  assert.strictEqual((await post({ ...SAMPLE, metadata: [1] })).status, 400);
  assert.strictEqual((await post({ ...SAMPLE, metadata: { x: "a".repeat(5000) } })).status, 400);
  assert.strictEqual((await rows()).length, 0);
});

test("normalizeBotShipment — 제어문자 제거·길이 제한", () => {
  const { fields } = normalizeBotShipment({ ...SAMPLE, itemsSummary: "후드\u0000\n  XL" + "가".repeat(2000) });
  assert.ok(fields.items_summary.startsWith("후드 XL"));
  assert.strictEqual(fields.items_summary.length, 1000);
});

test("buildUpdate — 관리자가 정한 입고 완료·취소는 봇이 바꾸지 못한다", () => {
  const now = "2026-11-10T00:00:00.000Z";
  assert.strictEqual(buildUpdate({ status: "RECEIVED" }, { status: "DELIVERED" }, now).status, undefined);
  assert.strictEqual(buildUpdate({ status: "CANCELED" }, { status: "IN_TRANSIT" }, now).status, undefined);
  assert.strictEqual(buildUpdate({ status: "SHIPPED" }, { status: "IN_TRANSIT" }, now).status, "IN_TRANSIT");
});

test("trackingUrl — 모르는 택배사는 링크 없음", () => {
  assert.strictEqual(trackingUrl("kr.unknown", "123456"), null);
  assert.match(trackingUrl("kr.epost", "1234567890123"), /epost\.go\.kr/);
});

test("Works 목록·입고 처리 — 관리자만, 기본은 진행 중만 보이고 입고 완료하면 빠진다", async () => {
  assert.strictEqual((await request(app()).get("/api/admin/supplier-shipments")).status, 401);
  const id = (await post(SAMPLE)).body.shipment.id;
  const auth = { Authorization: `Bearer ${TOKEN}` };
  let list = await request(app()).get("/api/admin/supplier-shipments").set(auth);
  assert.strictEqual(list.body.items.length, 1);

  assert.strictEqual((await request(app()).patch(`/api/admin/supplier-shipments/${id}`).set(auth).send({ status: "NOPE" })).status, 400);
  const done = await request(app()).patch(`/api/admin/supplier-shipments/${id}`).set(auth).send({ status: "RECEIVED" });
  assert.strictEqual(done.status, 200);
  assert.strictEqual(done.body.shipment.status, "RECEIVED");
  assert.ok(done.body.shipment.deliveredAt);

  list = await request(app()).get("/api/admin/supplier-shipments").set(auth);
  assert.strictEqual(list.body.items.length, 0);
  list = await request(app()).get("/api/admin/supplier-shipments?status=RECEIVED").set(auth);
  assert.strictEqual(list.body.items.length, 1);
  assert.strictEqual((await request(app()).patch("/api/admin/supplier-shipments/none").set(auth).send({ status: "RECEIVED" })).status, 404);
});
