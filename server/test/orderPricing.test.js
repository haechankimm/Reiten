/* priceItem·shippingFor·resolveCoupon을 실제 주문 생성 경로(POST /api/order)와 같은 순서로
   조합해 최종 결제금액이 맞는지 확인하는 통합 테스트. 각 함수는 pricing.test.js/coupons.test.js에서
   따로도 검증하지만, 여기서는 "장바구니 → 소계 → 배송비 → 쿠폰 할인 → 최종 결제금액"이 실제로
   연결됐을 때도 맞물려 돌아가는지를 본다(배송비 무료 기준이 할인 전 소계로 판정되는지 같은,
   조합했을 때만 드러나는 버그를 잡기 위한 테스트). */
const test = require("node:test");
const assert = require("node:assert/strict");
const { priceItem, shippingFor } = require("../lib/pricing");
const { resolveCoupon } = require("../lib/coupons");
const { createFakeSupabase } = require("../test-helpers/fakeSupabase");

const PRODUCTS = [
  { id: "core-zip-hoodie", price: 119000 },
  { id: "reflect-crop-hoodie", price: 89000 },
];
const PRICE_OPTS = { extras: [], charmPrice: 5900, extraPrice: 9000 };
const SHIPPING_CFG = { fee: 3500, freeOver: 100000 };

async function computeOrderTotal(db, rawItems, couponCode) {
  const items = rawItems.map((raw) => priceItem(raw, PRODUCTS, PRICE_OPTS));
  const subtotal = items.reduce((s, it) => s + it.sum, 0);
  const shipping = shippingFor(subtotal, SHIPPING_CFG);
  const coupon = await resolveCoupon(db, couponCode, { rawItems, items, subtotal });
  const total = subtotal - coupon.discount + shipping;
  return { subtotal, shipping, discount: coupon.discount, total, couponCode: coupon.code };
}

function baseCoupon(overrides) {
  return {
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

test("주문 합계 — 쿠폰 없이 배송비만 부과", async () => {
  const db = createFakeSupabase();
  const result = await computeOrderTotal(db, [{ productId: "reflect-crop-hoodie", qty: 1 }], null);
  assert.equal(result.subtotal, 89000);
  assert.equal(result.shipping, 3500);
  assert.equal(result.discount, 0);
  assert.equal(result.total, 92500);
});

test("주문 합계 — 정률 쿠폰은 무료배송 기준(할인 전 소계)에 영향을 주지 않는다", async () => {
  const db = createFakeSupabase({
    coupons: [{ code: "WELCOME10", discount_type: "percent", discount_value: 10, ...baseCoupon() }],
  });
  // 소계 119000원은 무료배송 기준(100000원)을 넘으므로 배송비 0 — 할인 때문에 실질 지불액이
  // 기준 밑으로 내려가도 배송비가 다시 붙지 않아야 한다(서버가 이렇게 계산하도록 만들었음).
  const result = await computeOrderTotal(db, [{ productId: "core-zip-hoodie", qty: 1 }], "welcome10");
  assert.equal(result.subtotal, 119000);
  assert.equal(result.shipping, 0);
  assert.equal(result.discount, 11900);
  assert.equal(result.total, 107100);
  assert.equal(result.couponCode, "WELCOME10");
});

test("주문 합계 — 정액 쿠폰은 소계를 넘겨 깎이지 않는다(음수 방지)", async () => {
  const db = createFakeSupabase({
    coupons: [{ code: "BIG50000", discount_type: "amount", discount_value: 50000, ...baseCoupon() }],
  });
  const result = await computeOrderTotal(db, [{ productId: "reflect-crop-hoodie", qty: 1 }], "BIG50000");
  assert.equal(result.subtotal, 89000);
  assert.equal(result.discount, 50000);
  assert.equal(result.total, 89000 - 50000 + 3500);
});

test("주문 합계 — scope=products 쿠폰은 지정 상품 몫만 할인한다", async () => {
  const db = createFakeSupabase({
    coupons: [
      { code: "HOODIEONLY", discount_type: "percent", discount_value: 20, ...baseCoupon({ scope: "products", product_ids: ["core-zip-hoodie"] }) },
    ],
  });
  const result = await computeOrderTotal(
    db,
    [
      { productId: "core-zip-hoodie", qty: 1 },
      { productId: "reflect-crop-hoodie", qty: 1 },
    ],
    "HOODIEONLY"
  );
  assert.equal(result.subtotal, 208000);
  assert.equal(result.discount, 23800); // 119000의 20%만, reflect-crop-hoodie 몫은 그대로
});

test("주문 합계 — 유효하지 않은 쿠폰이면 주문 계산 자체가 중단된다", async () => {
  const db = createFakeSupabase();
  await assert.rejects(
    () => computeOrderTotal(db, [{ productId: "core-zip-hoodie", qty: 1 }], "NOSUCHCODE"),
    /유효하지 않은 쿠폰/
  );
});

test("주문 합계 — 사용횟수 소진된 쿠폰은 주문 계산을 막는다", async () => {
  const db = createFakeSupabase({
    coupons: [{ code: "ONEUSE", discount_type: "amount", discount_value: 1000, ...baseCoupon({ usage_limit: 1 }) }],
    orders: [{ id: "o1", coupon_code: "ONEUSE" }],
  });
  await assert.rejects(
    () => computeOrderTotal(db, [{ productId: "core-zip-hoodie", qty: 1 }], "ONEUSE"),
    /소진/
  );
});

test("주문 합계 — 수량이 여럿이어도 소계·할인이 정확히 누적된다", async () => {
  const db = createFakeSupabase({
    coupons: [{ code: "TENOFF", discount_type: "percent", discount_value: 10, ...baseCoupon() }],
  });
  const result = await computeOrderTotal(
    db,
    [
      { productId: "core-zip-hoodie", qty: 2 },
      { productId: "reflect-crop-hoodie", qty: 3 },
    ],
    "TENOFF"
  );
  const expectedSubtotal = 119000 * 2 + 89000 * 3;
  assert.equal(result.subtotal, expectedSubtotal);
  assert.equal(result.discount, Math.floor(expectedSubtotal * 0.1));
});
