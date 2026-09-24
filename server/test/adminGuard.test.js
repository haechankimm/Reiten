process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../lib/adminGuard");

test("areaForPath — 경로가 올바른 영역으로 매핑됨", () => {
  assert.equal(g.areaForPath("/orders"), "orders");
  assert.equal(g.areaForPath("/orders/R260830-000001"), "orders");
  assert.equal(g.areaForPath("/orders/export"), "orders");
  assert.equal(g.areaForPath("/qna-templates"), "qna");
  assert.equal(g.areaForPath("/qna/abc"), "qna");
  assert.equal(g.areaForPath("/products/bulk-price"), "products");
  assert.equal(g.areaForPath("/colors"), "products");
  assert.equal(g.areaForPath("/usage-log/stats"), "dashboard");
  assert.equal(g.areaForPath("/usage-log"), "open");
  assert.equal(g.areaForPath("/notifications"), "open");
  assert.equal(g.areaForPath("/admins"), "open");
  assert.equal(g.areaForPath("/handoff-notes/1"), "collab");
});

test("areaForPath — 표에 없는 경로는 null(마스터 전용)", () => {
  assert.equal(g.areaForPath("/something-new"), null);
  assert.equal(g.areaForPath("/staff"), null);
  assert.equal(g.areaForPath("/staff/1/pin"), null);
});

test("requiredLevel — GET은 view, 나머지는 edit", () => {
  assert.equal(g.requiredLevel("GET"), "view");
  assert.equal(g.requiredLevel("PATCH"), "edit");
  assert.equal(g.requiredLevel("DELETE"), "edit");
});

test("resolvePermissions — 저장값 없으면 전체 허용, 있으면 명시한 것만", () => {
  const legacy = g.resolvePermissions(null, false);
  assert.ok(Object.values(legacy).every((v) => v === "edit"));
  const limited = g.resolvePermissions({ orders: "view", returns: "edit" }, false);
  assert.equal(limited.orders, "view");
  assert.equal(limited.returns, "edit");
  assert.equal(limited.coupons, "none");
  const master = g.resolvePermissions({ orders: "none" }, true);
  assert.equal(master.orders, "edit");
});

test("normalizePermissions — 잘못된 값은 none", () => {
  const n = g.normalizePermissions({ orders: "edit", returns: "hack", nope: "edit" });
  assert.equal(n.orders, "edit");
  assert.equal(n.returns, "none");
  assert.equal(n.nope, undefined);
});

test("PIN 토큰 — 서명·만료·사용자·PIN 버전 검증", () => {
  const { token } = g.signPinToken("user-1", 111, 1000);
  assert.equal(g.verifyPinToken(token, "user-1", 111, 2000), true);
  assert.equal(g.verifyPinToken(token, "user-2", 111, 2000), false);
  assert.equal(g.verifyPinToken(token, "user-1", 222, 2000), false); // PIN 변경 시 무효
  assert.equal(g.verifyPinToken(token, "user-1", 111, 1000 + 13 * 3600 * 1000), false); // 만료
  assert.equal(g.verifyPinToken(token.slice(0, -2) + "xx", "user-1", 111, 2000), false); // 위조
  assert.equal(g.verifyPinToken("", "user-1", 111), false);
});

test("isValidPin / hashPin", () => {
  assert.equal(g.isValidPin("123456"), true);
  assert.equal(g.isValidPin("12345"), false);
  assert.equal(g.isValidPin("12345a"), false);
  assert.equal(g.hashPin("123456", "salt"), g.hashPin("123456", "salt"));
  assert.notEqual(g.hashPin("123456", "salt"), g.hashPin("123457", "salt"));
});
