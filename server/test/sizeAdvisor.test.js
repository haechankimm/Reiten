/* 소스 코드/assets/js/sizeAdvisor.js — 라이더 사이즈 추천 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { estimateUsualSize, recommendSize } = require("../../소스 코드/assets/js/sizeAdvisor.js");
const { PROTECTOR_GUIDE } = require("../../소스 코드/assets/js/data.js");

test("키·몸무게 → 평소 사이즈(체형 보정)", () => {
  assert.equal(estimateUsualSize(170, 63), "M");
  assert.equal(estimateUsualSize(170, 80), "L"); // BMI 27.7 → +1
  assert.equal(estimateUsualSize(178, 95), "XXL"); // BMI 30 → +2 (L+2)
  assert.equal(estimateUsualSize(160, 45), "XS"); // BMI 17.6 → −1
  assert.equal(estimateUsualSize(500, 60), null);
});

test("보호대 착용이면 PROTECTOR_GUIDE 권장 사이즈, 판매하지 않는 사이즈는 가장 가까운 것(같으면 큰 쪽)", () => {
  const hoodie = { sizes: ["S", "M", "L", "XL"], guide: PROTECTOR_GUIDE.hoodie };
  const r = recommendSize({ heightCm: 170, weightKg: 63, fit: "regular", protector: true }, hoodie);
  assert.equal(r.usual, "M");
  assert.equal(r.recommended, "L");
  assert.ok(r.reasons.includes("protector_up"));
  const big = recommendSize({ heightCm: 185, weightKg: 100, protector: false }, hoodie);
  assert.equal(big.recommended, "XL");
  assert.ok(big.reasons.includes("nearest_available"));
  const crop = recommendSize({ heightCm: 150, weightKg: 40 }, { sizes: ["S", "M", "L"] });
  assert.equal(crop.recommended, "S");
  assert.ok(recommendSize({ heightCm: "", weightKg: 60 }, hoodie).error);
});

test("usual은 핏 보정 전 평소 사이즈, fit_* 사유는 실제로 움직였을 때만, 추천 가능한 사이즈가 없으면 오류", () => {
  const hoodie = { sizes: ["S", "M", "L", "XL"], guide: PROTECTOR_GUIDE.hoodie };
  const relaxed = recommendSize({ heightCm: 170, weightKg: 63, fit: "relaxed" }, hoodie);
  assert.equal(relaxed.usual, "M");
  assert.equal(relaxed.recommended, "L");
  assert.ok(relaxed.reasons.includes("fit_up"));
  // XS에서 "딱 맞게"는 더 작아질 수 없으니 fit_down이 없어야 한다
  const xs = recommendSize({ heightCm: 150, weightKg: 40, fit: "fitted" }, { sizes: ["XS", "S"] });
  assert.equal(xs.usual, "XS");
  assert.equal(xs.recommended, "XS");
  assert.ok(!xs.reasons.includes("fit_down"));
  // XS~XXL 체계가 아닌 사이즈만 파는 상품은 추천하지 않는다
  assert.ok(recommendSize({ heightCm: 170, weightKg: 63 }, { sizes: ["FREE"] }).error);
  assert.ok(recommendSize({ heightCm: 170, weightKg: 63 }, { sizes: [] }).error);
});
