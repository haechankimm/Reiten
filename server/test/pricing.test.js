const test = require("node:test");
const assert = require("node:assert/strict");
const { orderNo, priceItem, shippingFor, couponDiscount } = require("../lib/pricing");

const PRODUCTS = [
  { id: "core-zip-hoodie", price: 119000 },
  { id: "reflect-crop-hoodie", price: 89000 },
];
const EXTRAS = [{ key: "flower-doll" }, { key: "bead-bracelet" }];
const PRICE_OPTS = { extras: EXTRAS, charmPrice: 5900, extraPrice: 9000 };

test("orderNo — seq가 있으면 R + YYMMDD + 6자리로 0채움", () => {
  const no = orderNo(42, new Date("2026-08-05T00:00:00Z"));
  assert.equal(no, "R260805-000042");
});

test("orderNo — seq가 없으면(마이그레이션 미실행 등) 임의 4자리로 폴백", () => {
  const no = orderNo(undefined, new Date("2026-08-05T00:00:00Z"));
  assert.match(no, /^R260805-\d{4}$/);
});

test("orderNo — 서로 다른 seq는 항상 다른 주문번호를 만든다(충돌 불가능)", () => {
  const date = new Date("2026-08-05T00:00:00Z");
  assert.notEqual(orderNo(1, date), orderNo(2, date));
});

test("shippingFor — 소계 0이면 배송비 0 (빈 장바구니)", () => {
  assert.equal(shippingFor(0, { fee: 3500, freeOver: 100000 }), 0);
});

test("shippingFor — 무료배송 기준 미만이면 배송비 부과", () => {
  assert.equal(shippingFor(50000, { fee: 3500, freeOver: 100000 }), 3500);
});

test("shippingFor — 무료배송 기준 이상이면 배송비 0", () => {
  assert.equal(shippingFor(100000, { fee: 3500, freeOver: 100000 }), 0);
  assert.equal(shippingFor(150000, { fee: 3500, freeOver: 100000 }), 0);
});

test("priceItem — 일반 상품 가격을 서버 기준으로 재계산", () => {
  const item = priceItem({ productId: "core-zip-hoodie", qty: 2 }, PRODUCTS, PRICE_OPTS);
  assert.equal(item.unit, 119000);
  assert.equal(item.sum, 238000);
  assert.equal(item.qty, 2);
});

test("priceItem — 클라이언트가 unit/sum을 조작해도 무시하고 서버 가격을 쓴다", () => {
  const item = priceItem({ productId: "core-zip-hoodie", qty: 1, unit: 1, sum: 1 }, PRODUCTS, PRICE_OPTS);
  assert.equal(item.unit, 119000);
  assert.equal(item.sum, 119000);
});

test("priceItem — 참(charm)을 고르면 참 가격이 더해진다", () => {
  const item = priceItem(
    { productId: "core-zip-hoodie", qty: 1, charm: { key: "star", finish: "silver" } },
    PRODUCTS,
    PRICE_OPTS
  );
  assert.equal(item.unit, 119000 + 5900);
});

test("priceItem — charm.key가 'none'이면 참 가격을 더하지 않는다", () => {
  const item = priceItem({ productId: "core-zip-hoodie", qty: 1, charm: { key: "none" } }, PRODUCTS, PRICE_OPTS);
  assert.equal(item.unit, 119000);
});

test("priceItem — 추가 아이템(extras) 가격이 개당 더해진다", () => {
  const item = priceItem(
    { productId: "core-zip-hoodie", qty: 1, extras: ["flower-doll", "bead-bracelet"] },
    PRODUCTS,
    PRICE_OPTS
  );
  assert.equal(item.unit, 119000 + 9000 * 2);
});

test("priceItem — 존재하지 않는 상품이면 null", () => {
  assert.equal(priceItem({ productId: "no-such-product", qty: 1 }, PRODUCTS, PRICE_OPTS), null);
});

test("priceItem — 존재하지 않는 추가 아이템이면 null", () => {
  assert.equal(
    priceItem({ productId: "core-zip-hoodie", qty: 1, extras: ["no-such-extra"] }, PRODUCTS, PRICE_OPTS),
    null
  );
});

test("priceItem — 참만 담기(charm-*)는 참 가격만 청구, charm 없이 보내면 null", () => {
  const ok = priceItem({ productId: "charm-star", qty: 1, charm: { key: "star" } }, PRODUCTS, PRICE_OPTS);
  assert.equal(ok.unit, 5900);

  const invalid = priceItem({ productId: "charm-star", qty: 1 }, PRODUCTS, PRICE_OPTS);
  assert.equal(invalid, null);
});

test("priceItem — 수량은 1~99로 clamp된다", () => {
  const low = priceItem({ productId: "core-zip-hoodie", qty: 0 }, PRODUCTS, PRICE_OPTS);
  assert.equal(low.qty, 1);
  const high = priceItem({ productId: "core-zip-hoodie", qty: 500 }, PRODUCTS, PRICE_OPTS);
  assert.equal(high.qty, 99);
});

const rawItems = [{ productId: "core-zip-hoodie" }, { productId: "reflect-crop-hoodie" }];
const items = [
  { sum: 119000 },
  { sum: 178000 },
];

test("couponDiscount — scope=all 정률 할인은 전체 합계 기준", () => {
  const coupon = { discount_type: "percent", discount_value: 10, scope: "all", product_ids: [] };
  assert.equal(couponDiscount(coupon, { subtotal: 297000, items, rawItems }), 29700);
});

test("couponDiscount — scope=all 정액 할인은 합계를 넘지 않는다", () => {
  const coupon = { discount_type: "amount", discount_value: 500000, scope: "all", product_ids: [] };
  assert.equal(couponDiscount(coupon, { subtotal: 297000, items, rawItems }), 297000);
});

test("couponDiscount — scope=products는 해당 상품 합계만 할인 대상", () => {
  const coupon = { discount_type: "percent", discount_value: 10, scope: "products", product_ids: ["core-zip-hoodie"] };
  assert.equal(couponDiscount(coupon, { subtotal: 297000, items, rawItems }), 11900);
});

test("couponDiscount — 적용 상품이 장바구니에 없으면 할인 0", () => {
  const coupon = { discount_type: "percent", discount_value: 10, scope: "products", product_ids: ["no-such-product"] };
  assert.equal(couponDiscount(coupon, { subtotal: 297000, items, rawItems }), 0);
});
