const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveCoupon } = require("../lib/coupons");
const { createFakeSupabase } = require("../test-helpers/fakeSupabase");

const items = [{ sum: 100000 }];
const rawItems = [{ productId: "core-zip-hoodie" }];

function baseCoupon(overrides) {
  return {
    code: "TESTCODE",
    discount_type: "amount",
    discount_value: 10000,
    scope: "all",
    product_ids: [],
    min_subtotal: 0,
    usage_limit: null,
    starts_at: null,
    ends_at: null,
    active: true,
    ...overrides,
  };
}

test("resolveCoupon — 코드를 안 쓰면 그냥 통과(discount 0)", async () => {
  const db = createFakeSupabase();
  const result = await resolveCoupon(db, "", { rawItems, items, subtotal: 100000 });
  assert.deepEqual(result, { code: null, discount: 0 });
});

test("resolveCoupon — 존재하지 않는 코드는 거부", async () => {
  const db = createFakeSupabase({ coupons: [] });
  await assert.rejects(() => resolveCoupon(db, "NOPE", { rawItems, items, subtotal: 100000 }), /유효하지 않은/);
});

test("resolveCoupon — 비활성 쿠폰은 거부", async () => {
  const db = createFakeSupabase({ coupons: [baseCoupon({ active: false })] });
  await assert.rejects(() => resolveCoupon(db, "TESTCODE", { rawItems, items, subtotal: 100000 }), /유효하지 않은/);
});

test("resolveCoupon — 시작일 이전이면 거부", async () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const db = createFakeSupabase({ coupons: [baseCoupon({ starts_at: future })] });
  await assert.rejects(() => resolveCoupon(db, "TESTCODE", { rawItems, items, subtotal: 100000 }), /아직 사용할 수 없는/);
});

test("resolveCoupon — 종료일 이후면 거부", async () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  const db = createFakeSupabase({ coupons: [baseCoupon({ ends_at: past })] });
  await assert.rejects(() => resolveCoupon(db, "TESTCODE", { rawItems, items, subtotal: 100000 }), /만료된/);
});

test("resolveCoupon — 최소 주문금액 미달이면 거부", async () => {
  const db = createFakeSupabase({ coupons: [baseCoupon({ min_subtotal: 200000 })] });
  await assert.rejects(() => resolveCoupon(db, "TESTCODE", { rawItems, items, subtotal: 100000 }), /이상 주문부터/);
});

test("resolveCoupon — 사용횟수 소진이면 거부", async () => {
  const db = createFakeSupabase({
    coupons: [baseCoupon({ usage_limit: 2 })],
    orders: [
      { id: "1", coupon_code: "TESTCODE" },
      { id: "2", coupon_code: "TESTCODE" },
    ],
  });
  await assert.rejects(() => resolveCoupon(db, "TESTCODE", { rawItems, items, subtotal: 100000 }), /소진/);
});

test("resolveCoupon — 사용횟수가 한도 미만이면 통과", async () => {
  const db = createFakeSupabase({
    coupons: [baseCoupon({ usage_limit: 2 })],
    orders: [{ id: "1", coupon_code: "TESTCODE" }],
  });
  const result = await resolveCoupon(db, "TESTCODE", { rawItems, items, subtotal: 100000 });
  assert.equal(result.discount, 10000);
});

test("resolveCoupon — 다른 쿠폰 코드로 쓰인 주문은 사용횟수에 안 잡힌다", async () => {
  const db = createFakeSupabase({
    coupons: [baseCoupon({ usage_limit: 1 })],
    orders: [{ id: "1", coupon_code: "OTHERCODE" }],
  });
  const result = await resolveCoupon(db, "TESTCODE", { rawItems, items, subtotal: 100000 });
  assert.equal(result.discount, 10000);
});

test("resolveCoupon — scope=products인데 장바구니에 해당 상품이 없으면 거부", async () => {
  const db = createFakeSupabase({ coupons: [baseCoupon({ scope: "products", product_ids: ["other-product"] })] });
  await assert.rejects(() => resolveCoupon(db, "TESTCODE", { rawItems, items, subtotal: 100000 }), /적용할 수 없습니다/);
});

test("resolveCoupon — 코드는 대소문자 구분 없이 매칭된다", async () => {
  const db = createFakeSupabase({ coupons: [baseCoupon()] });
  const result = await resolveCoupon(db, "testcode", { rawItems, items, subtotal: 100000 });
  assert.equal(result.code, "TESTCODE");
});
