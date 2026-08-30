const test = require("node:test");
const assert = require("node:assert/strict");
const { restoreItemsFromOrder, findOutOfStockSinceFromLogs } = require("../lib/inventory");

test("restoreItemsFromOrder — 참(charm)은 제외하고 실제 재고 항목만 뽑는다", () => {
  const items = [
    { productId: "reflect-heart-hoodie", color: "black", size: "M", qty: 1 },
    { productId: "charm-flower-doll", size: "M", qty: 1 },
    { productId: "core-zip-hoodie", color: "", size: "L", qty: 2 },
  ];
  assert.deepEqual(restoreItemsFromOrder(items), [
    { productId: "reflect-heart-hoodie", color: "black", size: "M", qty: 1 },
    { productId: "core-zip-hoodie", color: "", size: "L", qty: 2 },
  ]);
});

test("restoreItemsFromOrder — productId·size가 없는 옛 주문 항목은 건너뛴다", () => {
  const items = [{ name: "리플렉트 하트 후디", qty: 1 }];
  assert.deepEqual(restoreItemsFromOrder(items), []);
});

test("restoreItemsFromOrder — items가 없으면 빈 배열", () => {
  assert.deepEqual(restoreItemsFromOrder(undefined), []);
});

test("findOutOfStockSinceFromLogs — 마지막으로 0 이하로 떨어진 시점을 역산한다", () => {
  // 최신순(내림차순) — 현재 qty=0. 가장 최근 변동(-1)이 2를 0으로 만들었으니, 그 변동이 "since".
  const logs = [
    { delta: -1, created_at: "2026-08-20T00:00:00Z" }, // 이 변동 전 재고 2(양수) → 이 시점이 품절 시작
    { delta: +2, created_at: "2026-08-10T00:00:00Z" },
  ];
  assert.equal(findOutOfStockSinceFromLogs(logs, 0), "2026-08-20T00:00:00Z");
});

test("findOutOfStockSinceFromLogs — 조회한 이력 전체 기간 동안 계속 품절(마이너스 재고)이면 가장 오래된 이력 시점으로 폴백", () => {
  // 현재 qty가 -3까지 내려가 있고, 조회한 이력 200건 내내 한 번도 양수로 돌아온 적이 없는 경우 —
  // "정확히 언제부터 품절이었는지"는 이 이력만으로는 알 수 없으므로 가장 오래된 기록 시점을 쓴다.
  const logs = [
    { delta: -1, created_at: "2026-08-20T00:00:00Z" },
    { delta: -1, created_at: "2026-08-15T00:00:00Z" },
    { delta: -1, created_at: "2026-08-10T00:00:00Z" },
  ];
  assert.equal(findOutOfStockSinceFromLogs(logs, -3), "2026-08-10T00:00:00Z");
});

test("findOutOfStockSinceFromLogs — 이력이 없으면(조회 불가) null", () => {
  assert.equal(findOutOfStockSinceFromLogs([], 0), null);
  assert.equal(findOutOfStockSinceFromLogs(null, 0), null);
});
