/* =========================================================
   라이더 사이즈 추천 (2026-10-02)
   ---------------------------------------------------------
   키·몸무게로 "평소 사이즈"를 어림잡고(키 기준 + 체형 보정, 의류몰에서 흔한 방식), 원하는 핏과
   보호대(이너 프로텍터) 착용 여부를 반영해 추천한다. 보호대 착용 시에는 data.js PROTECTOR_GUIDE의
   "보호대 착용 시 권장" 표를 그대로 따른다. 정밀한 체형 계측이 아닌 참고치라 화면에도 실측표를
   같이 보라고 안내한다. 브라우저(product.html)와 Node(테스트) 양쪽에서 쓰려고 별도 파일로 뺐다.
   ========================================================= */
const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL"];

function clampSizeIndex(i) {
  return Math.max(0, Math.min(SIZE_ORDER.length - 1, i));
}

/* 키(cm)·몸무게(kg) → 평소 사이즈(남녀공용 오버핏 기준). 값이 말이 안 되면 null. */
function estimateUsualSize(heightCm, weightKg) {
  const h = Number(heightCm);
  const w = Number(weightKg);
  if (!(h >= 130 && h <= 210) || !(w >= 30 && w <= 160)) return null;
  let idx = h < 158 ? 0 : h < 166 ? 1 : h < 174 ? 2 : h < 181 ? 3 : 4;
  const bmi = w / Math.pow(h / 100, 2);
  if (bmi >= 29) idx += 2;
  else if (bmi >= 25) idx += 1;
  else if (bmi < 18.5) idx -= 1;
  return SIZE_ORDER[clampSizeIndex(idx)];
}

/* input: { heightCm, weightKg, fit: "fitted"|"regular"|"relaxed", protector: boolean }
   product: { sizes: ["S","M",...], guide: PROTECTOR_GUIDE[...] (없어도 됨) }
   → { usual, recommended, reasons: ["fit_up"|"fit_down"|"protector_up"|"nearest_available"] } 또는 { error } */
function recommendSize(input, product) {
  const base = estimateUsualSize(input && input.heightCm, input && input.weightKg);
  if (!base) return { error: "키(cm)와 몸무게(kg)를 확인해 주세요." };
  /* 상품 사이즈가 하나도 SIZE_ORDER(XS~XXL)에 없으면(예: FREE·숫자 사이즈) 예전엔 이 상품이 팔지 않는
     사이즈를 그대로 추천했다 — 추천하지 않고 안내만 한다(2026-10-28 정기 감사). */
  const available = ((product && product.sizes) || []).filter((s) => SIZE_ORDER.includes(s));
  if (!available.length) return { error: "이 상품은 사이즈 추천을 지원하지 않아요. 아래 사이즈 실측표를 확인해 주세요." };

  /* usual은 화면에 "평소 사이즈"로 보여주는 값이라 키·몸무게로 어림잡은 그대로여야 한다 — 예전엔 핏 보정을
     한 뒤의 값을 usual로 돌려줘서 "평소 사이즈"가 틀리게 나왔다. fit_up/fit_down도 실제로 한 칸 움직였을
     때만 넣는다(XS에서 "딱 맞게"면 더 작아질 수 없는데 "한 치수 작게 봤어요"가 나왔다)(2026-10-28 정기 감사). */
  const usual = base;
  const reasons = [];
  const baseIdx = SIZE_ORDER.indexOf(base);
  let idx = baseIdx;
  if (input.fit === "relaxed") idx = clampSizeIndex(baseIdx + 1);
  else if (input.fit === "fitted") idx = clampSizeIndex(baseIdx - 1);
  if (idx > baseIdx) reasons.push("fit_up");
  else if (idx < baseIdx) reasons.push("fit_down");
  const fitted = SIZE_ORDER[idx];

  let recommended = fitted;
  if (input.protector) {
    const row = product && product.guide && Array.isArray(product.guide.rows) ? product.guide.rows.find((r) => r[0] === fitted) : null;
    recommended = row ? row[1] : SIZE_ORDER[clampSizeIndex(idx + 1)];
    if (recommended !== fitted) reasons.push("protector_up");
  }

  if (!available.includes(recommended)) {
    const target = SIZE_ORDER.indexOf(recommended);
    // 가장 가까운 사이즈, 같은 거리면 큰 쪽(오버핏 상의라 작은 쪽보다 낫다)
    const nearest = available
      .map((s) => [s, SIZE_ORDER.indexOf(s)])
      .sort((a, b) => Math.abs(a[1] - target) - Math.abs(b[1] - target) || b[1] - a[1])[0][0];
    recommended = nearest;
    reasons.push("nearest_available");
  }
  return { usual, recommended, reasons };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SIZE_ORDER, estimateUsualSize, recommendSize };
}
