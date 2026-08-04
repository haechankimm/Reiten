const test = require("node:test");
const assert = require("node:assert/strict");
const { paginationParams } = require("../lib/pagination");

test("paginationParams — 기본값 (page/pageSize 없음)", () => {
  const { page, pageSize, from, to } = paginationParams({});
  assert.equal(page, 1);
  assert.equal(pageSize, 20);
  assert.equal(from, 0);
  assert.equal(to, 19);
});

test("paginationParams — 2페이지는 이전 페이지 크기만큼 건너뛴다", () => {
  const { from, to } = paginationParams({ page: "2", pageSize: "10" });
  assert.equal(from, 10);
  assert.equal(to, 19);
});

test("paginationParams — pageSize는 maxSize를 넘지 못한다", () => {
  const { pageSize } = paginationParams({ pageSize: "9999" }, { maxSize: 100 });
  assert.equal(pageSize, 100);
});

test("paginationParams — page/pageSize가 0 이하거나 숫자가 아니면 최소값으로 보정", () => {
  assert.equal(paginationParams({ page: "0" }).page, 1);
  assert.equal(paginationParams({ page: "abc" }).page, 1);
  assert.equal(paginationParams({ pageSize: "-5" }).pageSize, 1);
});
