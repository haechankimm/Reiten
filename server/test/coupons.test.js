const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveCoupon, claimCouponUsage, releaseCouponUsage } = require("../lib/coupons");
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

/* claim/releaseCouponUsage — 032_coupon_usage_lock.sql의 원자적 차감(usage_limit 경쟁 상태 수정,
   2026-09 코드 감사에서 발견). resolveCoupon()의 count 기반 확인과 달리 이 두 함수만 실제로
   coupons.used_count를 바꾼다. */
test("claimCouponUsage — 코드가 없으면 그냥 통과", async () => {
  const db = createFakeSupabase();
  assert.equal(await claimCouponUsage(db, null), true);
});

test("claimCouponUsage — usage_limit 안에서는 계속 성공하고 used_count가 늘어난다", async () => {
  const db = createFakeSupabase({ coupons: [baseCoupon({ usage_limit: 2 })] });
  assert.equal(await claimCouponUsage(db, "TESTCODE"), true);
  assert.equal(await claimCouponUsage(db, "TESTCODE"), true);
  const { data: coupon } = await db.from("coupons").select("*").eq("code", "TESTCODE").single();
  assert.equal(coupon.used_count, 2);
});

test("claimCouponUsage — usage_limit을 넘으면 실패하고 더 이상 증가하지 않는다", async () => {
  const db = createFakeSupabase({ coupons: [baseCoupon({ usage_limit: 1, used_count: 1 })] });
  assert.equal(await claimCouponUsage(db, "TESTCODE"), false);
  const { data: coupon } = await db.from("coupons").select("*").eq("code", "TESTCODE").single();
  assert.equal(coupon.used_count, 1);
});

test("claimCouponUsage — usage_limit이 null이면 무제한 성공", async () => {
  const db = createFakeSupabase({ coupons: [baseCoupon({ usage_limit: null })] });
  for (let i = 0; i < 5; i++) assert.equal(await claimCouponUsage(db, "TESTCODE"), true);
});

test("releaseCouponUsage — 차감했던 슬롯을 되돌린다(경쟁 상태로 중복 확정된 주문 정리)", async () => {
  const db = createFakeSupabase({ coupons: [baseCoupon({ usage_limit: 1 })] });
  assert.equal(await claimCouponUsage(db, "TESTCODE"), true);
  assert.equal(await claimCouponUsage(db, "TESTCODE"), false, "이미 소진된 상태여야 함");
  await releaseCouponUsage(db, "TESTCODE");
  assert.equal(await claimCouponUsage(db, "TESTCODE"), true, "복원 후에는 다시 성공해야 함");
});

test("releaseCouponUsage — 0 밑으로는 내려가지 않는다", async () => {
  const db = createFakeSupabase({ coupons: [baseCoupon({ used_count: 0 })] });
  await releaseCouponUsage(db, "TESTCODE");
  const { data: coupon } = await db.from("coupons").select("*").eq("code", "TESTCODE").single();
  assert.equal(coupon.used_count, 0);
});
