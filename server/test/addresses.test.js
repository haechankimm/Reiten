/* 배송지 주소록 + 출고 전 셀프 배송지 변경(2026-11-21, 056) — lib/addresses.js · routes/addresses.js */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");

const USER_A = fakeAdminToken("user-a", "a@example.com");
const USER_B = fakeAdminToken("user-b", "b@example.com");
const ADDR = { name: "김라이더", tel: "010-1234-5678", zip: "04524", addr: "서울 중구 세종대로 110", addr2: "3층" };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(require("../routes/addresses"));
  return app;
}

function order(over = {}) {
  return {
    id: "o-" + Math.random().toString(36).slice(2),
    order_no: "R261121000001",
    status: "입금확인",
    tracking_no: null,
    user_id: null,
    customer: { name: "김라이더", tel: "010-1234-5678", zip: "04524", addr: "서울 중구 세종대로 110", addr2: "3층", memo: "문 앞" },
    ...over,
  };
}

beforeEach(() => {
  supabaseAdmin.__reset({ customer_addresses: [], orders: [] });
});

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("배송지 검사·변경 가능 상태·이전 주소 기록(최근 5개)", () => {
  const { shipFields, addressFromBody, canEditAddress, applyAddressChange, sameAddress } = require("../lib/addresses");
  assert.ok(shipFields({ zip: "123", addr: "서울 어딘가 1" }).error);
  assert.ok(shipFields({ zip: "04524", addr: "서울" }).error);
  assert.deepStrictEqual(shipFields({ zip: "04-524", addr: " 서울 중구  세종대로 110 ", addr2: "" }), { zip: "04524", addr: "서울 중구 세종대로 110", addr2: "" });
  assert.ok(addressFromBody({ ...ADDR, name: "" }).error);
  assert.ok(addressFromBody({ ...ADDR, tel: "010" }).error);
  assert.ok(sameAddress(ADDR, { ...ADDR, addr: "서울 중구 세종대로  110" }), "띄어쓰기만 다르면 같은 주소");

  assert.strictEqual(canEditAddress({ status: "입금대기" }), true);
  assert.strictEqual(canEditAddress({ status: "입금확인", tracking_no: "123" }), false, "운송장이 들어가면 잠긴다");
  assert.strictEqual(canEditAddress({ status: "배송중" }), false);
  assert.strictEqual(canEditAddress({ status: "취소" }), false);

  let c = { zip: "00001", addr: "처음 주소", memo: "문 앞" };
  for (let i = 2; i <= 8; i++) c = applyAddressChange(c, { zip: String(i).padStart(5, "0"), addr: `${i}번째 주소`, addr2: "" });
  assert.strictEqual(c.addr, "8번째 주소");
  assert.strictEqual(c.memo, "문 앞", "메모를 안 보내면 그대로");
  assert.deepStrictEqual(c.addressHistory.map((h) => h.addr), ["3번째 주소", "4번째 주소", "5번째 주소", "6번째 주소", "7번째 주소"]);
  assert.ok(c.addressChangedAt);
});

test("주소록: 로그인 필요, 첫 주소는 기본, 같은 주소는 새로 안 만든다, 남의 주소는 못 건드린다", async () => {
  const app = buildApp();
  assert.strictEqual((await request(app).get("/api/my/addresses")).status, 401);

  const first = await request(app).post("/api/my/addresses").set("Authorization", `Bearer ${USER_A}`).send(ADDR);
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.isDefault, true);
  const dup = await request(app).post("/api/my/addresses").set("Authorization", `Bearer ${USER_A}`).send({ ...ADDR, tel: "010-9999-8888" });
  assert.strictEqual(dup.body.duplicate, true);
  assert.strictEqual(dup.body.tel, "010-9999-8888", "연락처만 바뀌었으면 갱신");
  const second = await request(app).post("/api/my/addresses").set("Authorization", `Bearer ${USER_A}`).send({ ...ADDR, zip: "06236", addr: "서울 강남구 테헤란로 1" });
  assert.strictEqual(second.body.isDefault, false);

  const list = await request(app).get("/api/my/addresses").set("Authorization", `Bearer ${USER_A}`);
  assert.strictEqual(list.body.items.length, 2);
  assert.strictEqual((await request(app).get("/api/my/addresses").set("Authorization", `Bearer ${USER_B}`)).body.items.length, 0);

  assert.strictEqual((await request(app).delete(`/api/my/addresses/${first.body.id}`).set("Authorization", `Bearer ${USER_B}`)).status, 404);
  assert.strictEqual((await request(app).patch(`/api/my/addresses/${second.body.id}`).set("Authorization", `Bearer ${USER_B}`).send({ isDefault: true })).status, 404);

  // 기본 배송지를 지우면 남은 것이 기본이 된다
  assert.strictEqual((await request(app).delete(`/api/my/addresses/${first.body.id}`).set("Authorization", `Bearer ${USER_A}`)).status, 200);
  const rest = await request(app).get("/api/my/addresses").set("Authorization", `Bearer ${USER_A}`);
  assert.deepStrictEqual(rest.body.items.map((a) => [a.id, a.isDefault]), [[second.body.id, true]]);
});

test("주소록: 10개까지만", async () => {
  supabaseAdmin.__reset({
    customer_addresses: Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, user_id: "user-a", ...ADDR, zip: String(10000 + i), is_default: i === 0 })),
  });
  const res = await request(buildApp()).post("/api/my/addresses").set("Authorization", `Bearer ${USER_A}`).send({ ...ADDR, zip: "99999" });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, "ADDRESS_LIMIT");
});

test("셀프 배송지 변경: 비회원은 연락처로 확인, 틀리면 주문이 있는지도 안 알려 준다", async () => {
  supabaseAdmin.__reset({ orders: [order()] });
  const app = buildApp();
  const change = { orderNo: "R261121000001", zip: "06236", addr: "서울 강남구 테헤란로 1", addr2: "5층" };
  const wrong = await request(app).post("/api/orders/address").send({ ...change, tel: "010-0000-0000" });
  assert.strictEqual(wrong.status, 404);
  const none = await request(app).post("/api/orders/address").send({ ...change, orderNo: "R000", tel: "010-1234-5678" });
  assert.strictEqual(none.status, 404);
  assert.strictEqual(wrong.body.error, none.body.error);

  const ok = await request(app).post("/api/orders/address").send({ ...change, tel: "01012345678" });
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(ok.body.shipTo, { zip: "06236", addr: "서울 강남구 테헤란로 1" });
  const saved = (await supabaseAdmin.from("orders").select("*")).data[0];
  assert.deepStrictEqual([saved.customer.zip, saved.customer.addr2, saved.customer.memo, saved.customer.name], ["06236", "5층", "문 앞", "김라이더"]);
  assert.deepStrictEqual(saved.customer.addressHistory.map((h) => h.addr), ["서울 중구 세종대로 110"]);
});

test("셀프 배송지 변경: 회원은 로그인으로, 출고 준비가 끝났으면 409", async () => {
  supabaseAdmin.__reset({
    orders: [
      order({ order_no: "R1", user_id: "user-a" }),
      order({ order_no: "R2", status: "배송중", tracking_no: "5555" }),
      order({ order_no: "R3", status: "입금확인", tracking_no: "6666" }),
    ],
  });
  const app = buildApp();
  const change = { zip: "06236", addr: "서울 강남구 테헤란로 1" };
  assert.strictEqual((await request(app).post("/api/orders/address").set("Authorization", `Bearer ${USER_A}`).send({ ...change, orderNo: "R1" })).status, 200);
  assert.strictEqual((await request(app).post("/api/orders/address").set("Authorization", `Bearer ${USER_B}`).send({ ...change, orderNo: "R1" })).status, 404, "다른 회원은 안 됨");
  const shipped = await request(app).post("/api/orders/address").send({ ...change, orderNo: "R2", tel: "010-1234-5678" });
  assert.strictEqual(shipped.status, 409);
  assert.strictEqual(shipped.body.code, "NOT_EDITABLE");
  assert.strictEqual((await request(app).post("/api/orders/address").send({ ...change, orderNo: "R3", tel: "010-1234-5678" })).status, 409);
  assert.strictEqual((await request(app).post("/api/orders/address").send({ orderNo: "R1", zip: "1", addr: "x", tel: "010-1234-5678" })).status, 400);
});

test("주문 조회 응답: 바꿀 수 있을 때만 버튼·도로명 주소를 주고, 상세주소는 주지 않는다", () => {
  const { toCustomerOrderDto } = require("../lib/customerOrders");
  const editable = toCustomerOrderDto(order());
  assert.strictEqual(editable.canEditAddress, true);
  assert.deepStrictEqual(editable.shipTo, { zip: "04524", addr: "서울 중구 세종대로 110" });
  const locked = toCustomerOrderDto(order({ status: "배송중", tracking_no: "1" }));
  assert.strictEqual(locked.canEditAddress, false);
  assert.strictEqual(locked.shipTo, null);
});
