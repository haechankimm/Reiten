const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calcEarnedPoints,
  getPointsBalance,
  resolvePointsToUse,
  claimPointsUsage,
  awardPoints,
  reversePointsForOrder,
  LOYALTY_POINTS_RATE_SETTING_LABEL,
} = require("../lib/loyaltyPoints");
const { createFakeSupabase } = require("../test-helpers/fakeSupabase");

const USER = "user-1";

test("calcEarnedPoints — 소수점은 버리고 정수만 반환", () => {
  assert.equal(calcEarnedPoints(10000, 1), 100);
  assert.equal(calcEarnedPoints(999, 1), 9);
  assert.equal(calcEarnedPoints(0, 1), 0);
  assert.equal(calcEarnedPoints(10000, 0), 0);
});

test("getPointsBalance — 코드가 없으면(비회원) 항상 0", async () => {
  const db = createFakeSupabase();
  assert.equal(await getPointsBalance(db, null), 0);
});

test("getPointsBalance — 적립·사용 내역을 그대로 합산", async () => {
  const db = createFakeSupabase({
    loyalty_points_ledger: [
      { user_id: USER, delta: 500, reason: "earn_purchase" },
      { user_id: USER, delta: -200, reason: "redeem_order" },
      { user_id: "other-user", delta: 9999, reason: "earn_purchase" },
    ],
  });
  assert.equal(await getPointsBalance(db, USER), 300);
});

test("resolvePointsToUse — 비회원은 항상 0", async () => {
  const db = createFakeSupabase();
  assert.equal(await resolvePointsToUse(db, null, 1000, 50000), 0);
});

test("resolvePointsToUse — 잔액·상품합계 중 더 작은 값으로 clamp", async () => {
  const db = createFakeSupabase({ loyalty_points_ledger: [{ user_id: USER, delta: 3000, reason: "earn_purchase" }] });
  assert.equal(await resolvePointsToUse(db, USER, 1000, 50000), 1000, "요청값이 둘 다보다 작으면 그대로");
  assert.equal(await resolvePointsToUse(db, USER, 5000, 50000), 3000, "잔액을 넘을 수 없음");
  assert.equal(await resolvePointsToUse(db, USER, 5000, 2000), 2000, "상품 합계를 넘을 수 없음(배송비까지 포인트로 낼 수 없음)");
});

test("resolvePointsToUse — 0 이하·숫자 아님은 0으로 거부", async () => {
  const db = createFakeSupabase({ loyalty_points_ledger: [{ user_id: USER, delta: 3000, reason: "earn_purchase" }] });
  assert.equal(await resolvePointsToUse(db, USER, 0, 50000), 0);
  assert.equal(await resolvePointsToUse(db, USER, -100, 50000), 0);
  assert.equal(await resolvePointsToUse(db, USER, "abc", 50000), 0);
});

test("claimPointsUsage — 잔액 안에서는 성공하고 잔액이 실제로 줄어든다", async () => {
  const db = createFakeSupabase({ loyalty_points_ledger: [{ user_id: USER, delta: 1000, reason: "earn_purchase" }] });
  assert.equal(await claimPointsUsage(db, USER, 400, "R1"), true);
  assert.equal(await getPointsBalance(db, USER), 600);
});

test("claimPointsUsage — 잔액을 넘으면 실패하고 잔액은 그대로", async () => {
  const db = createFakeSupabase({ loyalty_points_ledger: [{ user_id: USER, delta: 100, reason: "earn_purchase" }] });
  assert.equal(await claimPointsUsage(db, USER, 400, "R1"), false);
  assert.equal(await getPointsBalance(db, USER), 100);
});

test("claimPointsUsage — 0포인트·비회원은 그냥 통과", async () => {
  const db = createFakeSupabase();
  assert.equal(await claimPointsUsage(db, USER, 0, "R1"), true);
  assert.equal(await claimPointsUsage(db, null, 100, "R1"), true);
});

test("awardPoints — 설정값 적립률을 읽어 적립하고, 비회원은 건너뛴다", async () => {
  const db = createFakeSupabase({ admin_settings: [{ id: "1", label: LOYALTY_POINTS_RATE_SETTING_LABEL, value: "2" }] });
  await awardPoints(db, USER, 10000, "R1");
  assert.equal(await getPointsBalance(db, USER), 200);

  await awardPoints(db, null, 10000, "R2");
  assert.equal(await getPointsBalance(db, USER), 200, "비회원 주문은 적립 안 됨");
});

test("awardPoints — 설정이 없거나 잘못됐으면 기본값(1%)으로 폴백", async () => {
  const db = createFakeSupabase();
  await awardPoints(db, USER, 10000, "R1");
  assert.equal(await getPointsBalance(db, USER), 100);
});

test("awardPoints — 같은 주문에 두 번 적립을 시도해도 한 번만 반영(웹훅 재전송 대비)", async () => {
  const db = createFakeSupabase();
  await awardPoints(db, USER, 10000, "R1");
  await awardPoints(db, USER, 10000, "R1");
  assert.equal(await getPointsBalance(db, USER), 100);
});

test("reversePointsForOrder — 그 주문의 적립·사용을 반대 부호로 되돌린다", async () => {
  const db = createFakeSupabase({
    loyalty_points_ledger: [
      { user_id: USER, order_no: "R1", delta: 100, reason: "earn_purchase" },
      { user_id: USER, order_no: "R1", delta: -50, reason: "redeem_order" },
    ],
  });
  assert.equal(await getPointsBalance(db, USER), 50);
  await reversePointsForOrder(db, "R1");
  assert.equal(await getPointsBalance(db, USER), 0);
});
