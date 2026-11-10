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
const { normalizeBotShipment, buildUpdate } = router;
const { trackingUrl, findCarrier } = require("../lib/carriers");
const supplierLib = require("../lib/supplierShipments");
const budget = require("../lib/trackingBudget");
const tracking = require("../lib/tracking");

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
  assert.strictEqual((await post({ ...SAMPLE, carrierCode: undefined, carrierName: undefined })).status, 400);
  assert.strictEqual((await post({ ...SAMPLE, trackingNumber: "12-3" })).status, 400);
  assert.strictEqual((await post({ ...SAMPLE, carrierCode: "<script>", carrierName: undefined })).status, 400);
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

test("택배사 — 코드·이름 어느 쪽이든 같은 택배사로, 모르는 택배사는 네이버 검색 링크", () => {
  assert.strictEqual(findCarrier("CJ대한통운").id, "kr.cjlogistics");
  assert.strictEqual(findCarrier(null, "경동 택배").id, "kr.kdexp");
  assert.match(trackingUrl("kr.epost", null, "1234567890123"), /epost\.go\.kr/);
  assert.match(trackingUrl("kr.unknown", "새택배", "123456"), /search\.naver\.com.*123456/);
});

test("택배사 이름만 와도 등록 — 표에 있으면 코드로 바꾸고, 없으면 etc + 이름 보관", async () => {
  const a = (await post({ ...SAMPLE, carrierCode: undefined, carrierName: "경동택배", trackingNumber: "KD1234567" })).body.shipment;
  assert.strictEqual(a.carrierCode, "kr.kdexp");
  const b = (await post({ ...SAMPLE, supplierName: "원단도매A", supplierLabel: "원단도매 A상사", carrierCode: undefined, carrierName: "어느화물", trackingNumber: "99887766" })).body.shipment;
  assert.strictEqual(b.carrierCode, "etc");
  assert.strictEqual(b.carrierName, "어느화물");
  assert.strictEqual(b.supplierLabel, "원단도매 A상사");
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

/* ---------- 스마트택배 배송조회(049) ---------- */
const NOW = new Date("2026-11-12T03:00:00.000Z");
const shippedRow = (over = {}) => ({ id: "s1", supplier_name: "printcanvas", carrier_code: "kr.cjlogistics", tracking_number: "601373483215", status: "SHIPPED", shipped_at: "2026-11-10T00:00:00.000Z", tracking_checked_at: null, ...over });
const fetchDelivered = async () => ({ ok: true, json: async () => ({ complete: true, level: 6, trackingDetails: [{ timeString: "2026-11-11 10:00", where: "성수", kind: "집화처리" }, { timeString: "2026-11-12 11:00", where: "강남", kind: "배달완료" }] }) });

function withKey(fn) {
  return async () => {
    process.env.SWEETTRACKER_API_KEY = "test-key";
    budget._resetMemory();
    tracking._resetCompanyCache();
    try { await fn(); } finally { delete process.env.SWEETTRACKER_API_KEY; delete process.env.SWEETTRACKER_MONTHLY_LIMIT; }
  };
}

test("크론 — 배송완료면 DELIVERED·단계 기록 저장, 사용량 1건", withKey(async () => {
  supabaseAdmin.__reset({ supplier_shipments: [shippedRow()], api_usage_monthly: [] });
  const r = await supplierLib.checkSupplierShipments({ now: NOW, fetchImpl: fetchDelivered });
  assert.deepStrictEqual(r, { checked: 1, delivered: 1 });
  const row = (await rows())[0];
  assert.strictEqual(row.status, "DELIVERED");
  assert.strictEqual(row.tracking_status, "배달완료");
  assert.strictEqual(row.tracking_events.length, 2);
  assert.strictEqual((await budget.usage(supabaseAdmin, NOW)).calls, 1);
}));

test("크론 — 방금 조회한 송장은 다시 조회하지 않고, 입고 완료·취소는 대상 아님", withKey(async () => {
  supabaseAdmin.__reset({
    supplier_shipments: [
      shippedRow({ tracking_checked_at: new Date(NOW.getTime() - 3600e3).toISOString() }),
      shippedRow({ id: "s2", status: "RECEIVED" }),
      shippedRow({ id: "s3", status: "CANCELED" }),
    ],
  });
  const r = await supplierLib.checkSupplierShipments({ now: NOW, fetchImpl: fetchDelivered });
  assert.strictEqual(r.checked, 0);
}));

test("월간 한도를 다 쓰면 조회하지 않는다", withKey(async () => {
  process.env.SWEETTRACKER_MONTHLY_LIMIT = "1";
  supabaseAdmin.__reset({ supplier_shipments: [shippedRow(), shippedRow({ id: "s2", tracking_number: "111122223333" })], api_usage_monthly: [] });
  let calls = 0;
  const r = await supplierLib.checkSupplierShipments({ now: NOW, fetchImpl: async (...a) => { calls++; return fetchDelivered(...a); } });
  assert.strictEqual(r.checked, 1);
  assert.strictEqual(calls, 1);
}));

test("표에 스마트택배 코드가 없는 택배사는 택배사 목록 API에서 이름으로 찾는다", withKey(async () => {
  supabaseAdmin.__reset({ supplier_shipments: [shippedRow({ carrier_code: "kr.kdexp", carrier_name: "경동택배" })] });
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("companylist")) return { ok: true, json: async () => ({ Company: [{ Code: "23", Name: "경동택배" }] }) };
    return fetchDelivered();
  };
  await supplierLib.checkSupplierShipments({ now: NOW, fetchImpl });
  assert.ok(urls.some((u) => u.includes("t_code=23")));
}));

test("Works 배송조회 버튼 — 키 없으면 400, 있으면 조회해 단계 기록을 돌려준다", async () => {
  supabaseAdmin.__reset({ profiles: [{ id: ADMIN.id, role: "admin" }], supplier_shipments: [shippedRow()] });
  const auth = { Authorization: `Bearer ${TOKEN}` };
  assert.strictEqual((await request(app()).post("/api/admin/supplier-shipments/s1/track").set(auth)).status, 400);
  const list = await request(app()).get("/api/admin/supplier-shipments").set(auth);
  assert.strictEqual(list.body.trackingEnabled, false);
  assert.deepStrictEqual(list.body.suppliers.map((p) => p.name), ["printcanvas"]);
});

test("patchFromResult — 조회 오류는 오류만 기록하고 상태는 그대로", () => {
  const p = supplierLib.patchFromResult(shippedRow(), { error: "키 만료" }, NOW);
  assert.strictEqual(p.tracking_error, "키 만료");
  assert.strictEqual(p.status, undefined);
  const q = supplierLib.patchFromResult(shippedRow({ status: "RECEIVED" }), { delivered: true, events: [] }, NOW);
  assert.strictEqual(q.status, undefined);
});
