/* lib/kakao.js — 솔라피 알림톡 요청 만들기(2026-11-11). 실제 발송은 하지 않는다. */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, afterEach, after } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const kakao = require("../lib/kakao");

const KEYS = ["SOLAPI_API_KEY", "SOLAPI_API_SECRET", "KAKAO_PF_ID", "KAKAO_SENDER_PHONE", "KAKAO_TPL_SHIPPED"];
afterEach(() => KEYS.forEach((k) => delete process.env[k]));
after(() => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

test("설정이 없으면 발송하지 않고 건너뛴다", async () => {
  assert.strictEqual(kakao.isConfigured(), false);
  assert.deepStrictEqual(await kakao.sendAlimtalk("SHIPPED", "010-1234-5678", {}), { skipped: "not-configured" });
});

test("템플릿 ID·변수가 모두 있을 때만 요청 본문을 만든다", () => {
  process.env.KAKAO_PF_ID = "PF1";
  process.env.KAKAO_SENDER_PHONE = "010-9999-0000";
  const vars = { name: "홍길동", orderNo: "R1", trackingNo: "123", courier: "CJ대한통운" };
  assert.strictEqual(kakao.buildMessage("SHIPPED", "01012345678", vars), null); // 템플릿 ID 없음
  process.env.KAKAO_TPL_SHIPPED = "KA01TP1";
  const body = kakao.buildMessage("SHIPPED", "010-1234-5678", vars);
  assert.strictEqual(body.message.to, "01012345678");
  assert.strictEqual(body.message.from, "01099990000");
  assert.strictEqual(body.message.kakaoOptions.templateId, "KA01TP1");
  assert.deepStrictEqual(body.message.kakaoOptions.variables, { "#{name}": "홍길동", "#{orderNo}": "R1", "#{courier}": "CJ대한통운", "#{trackingNo}": "123" });
  assert.strictEqual(kakao.buildMessage("SHIPPED", "010-1234-5678", { ...vars, courier: "" }), null); // 변수 빠짐
  assert.strictEqual(kakao.buildMessage("SHIPPED", "02-123-4567", vars), null); // 휴대폰 아님
});

test("모든 템플릿 변수는 실제 호출하는 곳이 넘기는 이름과 같다", () => {
  assert.deepStrictEqual(kakao.templateVars("ORDER_RECEIVED"), ["name", "orderNo", "amount", "account", "hours"]);
  assert.deepStrictEqual(kakao.templateVars("REFUND_COMPLETED"), ["name", "orderNo", "amount"]);
  for (const code of ["PAYMENT_CONFIRMED", "CARD_PAID", "ORDER_CANCELLED"]) assert.deepStrictEqual(kakao.templateVars(code), ["name", "orderNo"]);
});

test("인증 헤더는 date+salt를 비밀키로 서명한다", () => {
  const h = kakao.authHeader("K", "S", new Date("2026-11-11T00:00:00Z"));
  const m = h.match(/^HMAC-SHA256 apiKey=K, date=(\S+), salt=(\w+), signature=(\w+)$/);
  assert.ok(m);
  assert.strictEqual(m[3], crypto.createHmac("sha256", "S").update(m[1] + m[2]).digest("hex"));
});
