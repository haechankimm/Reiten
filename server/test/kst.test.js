const test = require("node:test");
const assert = require("node:assert/strict");
const { kstDateKey, kstMonthKey, kstDateTimeLabel, kstDayRangeISO, kstMonthRangeISO } = require("../lib/kst");

test("kstDateKey — UTC 자정 근처는 KST로 넘어가면 다음 날 날짜가 나온다", () => {
  // 2026-01-15T14:59:59Z = KST 2026-01-15 23:59:59 (아직 같은 날)
  assert.equal(kstDateKey("2026-01-15T14:59:59Z"), "2026-01-15");
  // 2026-01-15T15:00:00Z = KST 2026-01-16 00:00:00 (자정 넘어감 — 옛날 방식은 이 경계를 놓쳤음)
  assert.equal(kstDateKey("2026-01-15T15:00:00Z"), "2026-01-16");
});

test("kstMonthKey — 월말 자정 경계도 KST 기준으로 넘어간다", () => {
  // 2026-01-31T14:59:59Z = KST 2026-01-31 23:59:59
  assert.equal(kstMonthKey("2026-01-31T14:59:59Z"), "2026-01");
  // 2026-01-31T15:00:00Z = KST 2026-02-01 00:00:00
  assert.equal(kstMonthKey("2026-01-31T15:00:00Z"), "2026-02");
});

test("kstDateTimeLabel — KST 기준 YYYY-MM-DD HH:mm", () => {
  assert.equal(kstDateTimeLabel("2026-01-15T15:30:00Z"), "2026-01-16 00:30");
});

test("kstDayRangeISO — KST 하루(00:00~23:59:59.999)를 UTC 범위로 변환", () => {
  const range = kstDayRangeISO("2026-01-15");
  assert.equal(range.startISO, "2026-01-14T15:00:00.000Z");
  assert.equal(range.endISO, "2026-01-15T14:59:59.999Z");
});

test("kstDayRangeISO — 형식이 이상하면 null", () => {
  assert.equal(kstDayRangeISO("not-a-date"), null);
});

test("kstMonthRangeISO — 1월에 지난달(monthsAgo=1)을 구하면 전년도 12월로 안전하게 넘어간다", () => {
  const range = kstMonthRangeISO(1, new Date("2026-01-05T00:00:00Z"));
  assert.equal(range.monthKey, "2025-12");
  assert.equal(range.monthLabel, "2025년 12월");
  assert.equal(range.startISO, "2025-11-30T15:00:00.000Z"); // 2025-12-01 00:00 KST
  assert.equal(range.endISO, "2025-12-31T15:00:00.000Z"); // 2026-01-01 00:00 KST
});

test("kstMonthRangeISO — 평범한 달은 그냥 한 달 전", () => {
  const range = kstMonthRangeISO(1, new Date("2026-08-05T00:00:00Z"));
  assert.equal(range.monthKey, "2026-07");
});
