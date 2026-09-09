const test = require("node:test");
const assert = require("node:assert/strict");
const { isMissingSchemaError, isMissingColumnError, extractMissingColumnName } = require("../lib/pgErrors");

test("isMissingSchemaError — PGRST205·PGRST202·42P01만 true", () => {
  assert.equal(isMissingSchemaError({ code: "PGRST205" }), true);
  assert.equal(isMissingSchemaError({ code: "PGRST202" }), true);
  assert.equal(isMissingSchemaError({ code: "42P01" }), true);
  assert.equal(isMissingSchemaError({ code: "PGRST204" }), false);
  assert.equal(isMissingSchemaError(null), false);
});

test("isMissingColumnError — PGRST204·42703만 true", () => {
  assert.equal(isMissingColumnError({ code: "PGRST204" }), true);
  assert.equal(isMissingColumnError({ code: "42703" }), true);
  assert.equal(isMissingColumnError({ code: "PGRST205" }), false);
  assert.equal(isMissingColumnError(null), false);
});

/* insertOrderRow(server.js)가 "선택 컬럼 중 정말 없는 것만" 정확히 빼고 재시도하려면 이
   함수가 실제 컬럼명을 뽑아내야 한다 — 못 뽑으면 순서대로 찍어 넘기다 존재하는 다른 선택
   컬럼까지 잘못 지울 위험이 있다(2026-09 코드 감사에서 발견, pgErrors.js 주석 참고). */
test("extractMissingColumnName — PostgREST(INSERT/UPDATE) 형식", () => {
  const error = { message: "Could not find the 'virtual_account_bank' column of 'orders' in the schema cache" };
  assert.equal(extractMissingColumnName(error), "virtual_account_bank");
});

test("extractMissingColumnName — raw Postgres 'column table.col does not exist' 형식", () => {
  const error = { message: 'column orders.points_used does not exist' };
  assert.equal(extractMissingColumnName(error), "points_used");
});

test("extractMissingColumnName — raw Postgres 'column \"col\" of relation' 형식", () => {
  const error = { message: 'column "device" of relation "orders" does not exist' };
  assert.equal(extractMissingColumnName(error), "device");
});

test("extractMissingColumnName — 알 수 없는 형식이면 null", () => {
  assert.equal(extractMissingColumnName({ message: "something unexpected happened" }), null);
  assert.equal(extractMissingColumnName(null), null);
  assert.equal(extractMissingColumnName({}), null);
});
