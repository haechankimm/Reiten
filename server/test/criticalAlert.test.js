process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldAlert, _resetThrottle } = require("../lib/criticalAlert");

test("shouldAlert — 같은 종류는 30분에 한 번, 다른 종류는 따로", () => {
  _resetThrottle();
  assert.equal(shouldAlert("refund_failed", {}, 1000), true);
  assert.equal(shouldAlert("refund_failed", {}, 1000 + 10 * 60 * 1000), false);
  assert.equal(shouldAlert("card_cancel_failed", {}, 1000 + 10 * 60 * 1000), true);
  assert.equal(shouldAlert("refund_failed", {}, 1000 + 31 * 60 * 1000), true);
});

test("shouldAlert — 알림 채널 자신의 실패(푸시·텔레그램)는 다시 알리지 않음, 메일 실패는 알림", () => {
  _resetThrottle();
  assert.equal(shouldAlert("notification_failed", { channel: "push" }), false);
  assert.equal(shouldAlert("notification_failed", { channel: "telegram" }), false);
  assert.equal(shouldAlert("notification_failed", { channel: "email" }), true);
});
