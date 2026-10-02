/* lib/settlement.js(정산 환불 계산) + lib/briefing.js(아침 요약 문구) */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "fake";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeSettlementSummary, monthRangeFromKey } = require("../lib/settlement");
const { briefingText } = require("../lib/briefing");

test("monthRangeFromKey — KST 기준 한 달의 UTC 범위, 잘못된 형식은 null", () => {
  const r = monthRangeFromKey("2026-09");
  assert.equal(r.startISO, "2026-08-31T15:00:00.000Z");
  assert.equal(r.endISO, "2026-09-30T15:00:00.000Z");
  assert.equal(r.monthLabel, "2026년 9월");
  assert.equal(monthRangeFromKey("2026-13"), null);
  assert.equal(monthRangeFromKey("abc"), null);
});

test("정산 — 부분 환불은 실제 환불액, 기록 없는 예전 전액 환불만 주문 총액으로", () => {
  const orders = [
    { order_no: "A", total: 100000, status: "완료", coupon_code: "WELCOME", discount: 5000 },
    { order_no: "B", total: 50000, status: "완료" },
    { order_no: "C", total: 30000, status: "취소" },
  ];
  const { summary, refundLines } = computeSettlementSummary({
    orders,
    refundRows: [{ order_no: "A", kind: "return", refund_amount: 43000, shipping_deduction: 7000, method: "card", created_at: "2026-09-10" }],
    legacyReturns: [
      { order_no: "A", refunded: true, reason: "단순변심", created_at: "2026-09-10" }, // A는 기록이 있으므로 이중 계산 안 함
      { order_no: "B", refunded: true, reason: "불량", created_at: "2026-09-12" },
    ],
    totalsByOrderNo: new Map([["A", 100000], ["B", 50000]]),
  });
  assert.equal(summary.revenue, 150000); // 취소 C 제외
  assert.equal(summary.refundTotal, 93000); // 43,000(부분) + 50,000(예전 전액)
  assert.equal(summary.netRevenue, 57000);
  assert.equal(summary.couponDiscount, 5000);
  assert.equal(refundLines.length, 2);
});

test("아침 요약 — 할 일이 있는 항목만, 하나도 없으면 null", () => {
  assert.equal(briefingText({ pendingDeposit: 2, toShip: 0, openQna: 1, openReturns: 0, systemErrors: 0 }), "입금 확인 2 · 미답변 문의 1");
  assert.equal(briefingText({ pendingDeposit: 0, toShip: 0, openQna: 0, openReturns: 0, systemErrors: 0 }), null);
});
