/* lib/tracking.js + lib/purchaseConfirm.js — 배송완료 자동 처리, 자동·고객 구매확정, 구매확정 때 적립. */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { supabaseAdmin } = require("../lib/supabase");
const { parseTrackingResponse } = require("../lib/tracking");
const pc = require("../lib/purchaseConfirm");

const NOW = new Date("2026-10-20T03:00:00.000Z");
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();

beforeEach(() => {
  pc._resetCapability(true);
  process.env.SWEETTRACKER_API_KEY = "test-key";
  supabaseAdmin.__reset({
    orders: [
      { order_no: "D8", status: "완료", user_id: "u1", points_earned: 1200, shipped_at: daysAgo(10), delivered_at: daysAgo(8), confirmed_at: null },
      { order_no: "D3", status: "완료", user_id: "u1", points_earned: 500, shipped_at: daysAgo(5), delivered_at: daysAgo(3), confirmed_at: null },
      { order_no: "S15", status: "배송중", user_id: null, points_earned: 0, shipped_at: daysAgo(15), delivered_at: null, confirmed_at: null },
      { order_no: "RET", status: "완료", user_id: "u2", points_earned: 300, shipped_at: daysAgo(12), delivered_at: daysAgo(9), confirmed_at: null },
      { order_no: "TRK", status: "배송중", courier: "cj", tracking_no: "1234-5678", user_id: null, shipped_at: daysAgo(2), delivered_at: null, confirmed_at: null },
    ],
    return_requests: [{ id: "r1", order_no: "RET", request_type: "return", status: "수거중" }],
    loyalty_points_ledger: [],
  });
});

after(() => {
  delete process.env.SWEETTRACKER_API_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("parseTrackingResponse — complete/level 6이면 배송완료, 오류 응답은 error", () => {
  assert.equal(parseTrackingResponse({ complete: true, level: 6, lastDetail: { kind: "배달완료", timeString: "2026-10-18 14:00" } }).delivered, true);
  assert.equal(parseTrackingResponse({ complete: false, level: 4, lastDetail: { kind: "배달출발" } }).delivered, false);
  assert.ok(parseTrackingResponse({ status: false, msg: "운송장 미등록" }).error);
});

test("자동 구매확정 — 배송완료 7일·출고 14일 지난 것만, 반품 처리 중은 제외, 확정 때 적립", async () => {
  const r = await pc.autoConfirmOrders({ now: NOW });
  assert.equal(r.confirmed, 2); // D8(배송완료 8일), S15(배송완료 기록 없이 출고 15일)
  const rows = (await supabaseAdmin.from("orders").select("*")).data;
  const byNo = Object.fromEntries(rows.map((o) => [o.order_no, o]));
  assert.ok(byNo.D8.confirmed_at);
  assert.ok(byNo.S15.confirmed_at);
  assert.equal(byNo.D3.confirmed_at, null, "배송완료 3일은 아직");
  assert.equal(byNo.RET.confirmed_at, null, "반품 수거 중이면 자동 확정 안 함");
  const ledger = (await supabaseAdmin.from("loyalty_points_ledger").select("*")).data;
  assert.equal(ledger.filter((l) => l.order_no === "D8" && l.reason === "earn_purchase").length, 1);
  assert.equal(ledger.find((l) => l.order_no === "D8").delta, 1200);
});

test("구매확정은 두 번 해도 한 번만 적립", async () => {
  const order = (await supabaseAdmin.from("orders").select("*").eq("order_no", "D3").maybeSingle()).data;
  const first = await pc.confirmOrder(order, { now: NOW });
  const second = await pc.confirmOrder(order, { now: NOW });
  assert.equal(first.ok, true);
  assert.equal(first.pointsCredited, 500);
  assert.equal(second.ok, false);
  assert.equal(second.already, true);
  const ledger = (await supabaseAdmin.from("loyalty_points_ledger").select("*")).data;
  assert.equal(ledger.length, 1);
});

test("배송조회 크론 — 배송완료 응답이면 주문 '완료' + delivered_at, 아니면 상태 메모만", async () => {
  const fakeFetch = async (url) => ({
    ok: true,
    json: async () => (url.includes("t_code=04") ? { complete: true, level: 6, lastDetail: { kind: "배달완료" } } : {}),
  });
  const r = await pc.checkDeliveries({ now: NOW, fetchImpl: fakeFetch });
  assert.equal(r.checked, 1);
  assert.equal(r.delivered, 1);
  const trk = (await supabaseAdmin.from("orders").select("*").eq("order_no", "TRK").maybeSingle()).data;
  assert.equal(trk.status, "완료");
  assert.ok(trk.delivered_at);
  assert.equal(trk.tracking_status, "배달완료");
});

test("배송조회 키가 없으면 크론은 아무것도 안 한다", async () => {
  delete process.env.SWEETTRACKER_API_KEY;
  const r = await pc.checkDeliveries({ now: NOW });
  assert.equal(r.skipped, "no_key");
});

test("canConfirm — 배송중·완료이고 아직 확정 전일 때만", () => {
  assert.equal(pc.canConfirm({ status: "배송중", confirmed_at: null }), true);
  assert.equal(pc.canConfirm({ status: "입금확인", confirmed_at: null }), false);
  assert.equal(pc.canConfirm({ status: "완료", confirmed_at: "2026-10-01" }), false);
});
