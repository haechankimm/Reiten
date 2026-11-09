/* 장바구니 검증·가격 재계산(주문·카드결제 준비 공용) — server.js에서 분리(2026-11-09, 동작 변경 없음). */
const { SITE, CHARM_PRICE, EXTRA_PRICE, EXTRAS, CHARMS } = require("../../소스 코드/assets/js/data.js");
const { supabaseAdmin } = require("./supabase");
const { isEmailBanned, BANNED_MESSAGE } = require("./bans");
const { priceItem, shippingFor, hasPhysicalProduct } = require("./pricing");
const { resolveCoupon } = require("./coupons");
const { resolvePointsToUse } = require("./loyaltyPoints");

const REQUIRED_CUSTOMER_FIELDS = ["name", "tel", "email", "zip", "addr", "payer"];
const PRICE_OPTS = { extras: EXTRAS, charmPrice: CHARM_PRICE, extraPrice: EXTRA_PRICE };
const ORDER_DEVICE_TYPES = ["mobile", "tablet", "desktop"];

/* 무통장입금(/api/order)과 카드결제 준비(/api/payments/prepare)가 "장바구니를 검증하고 가격을
   다시 계산한다"는 부분만큼은 완전히 같은 로직이었는데 그동안 두 곳에 따로 복붙돼 있었다 —
   가격 정책을 바꿀 때 한쪽만 고치고 다른 쪽을 놓치기 쉬운 지점이라 하나로 합친다. 이 함수는
   DB에 아무것도 쓰지 않고(coupon 조회만 함) 검증된 값 또는 에러만 돌려주므로, 호출부가
   재고 차감·저장 같은 각자의 나머지 절차를 이어서 하면 된다. */
async function validateAndPriceOrder(body, products, userId, { banned = false } = {}) {
  const { customer, items: rawItems, couponCode, device, pointsToUse: rawPointsToUse } = body || {};
  if (banned) return { error: { status: 403, body: { error: BANNED_MESSAGE, code: "banned" } } };
  if (!customer || typeof customer !== "object") {
    return { error: { status: 400, body: { error: "customer 정보가 없습니다." } } };
  }
  /* 주문자 정보는 문자열만, 연락처는 숫자 9~11자리, 이메일은 형식 검사 — "abc" 같은 연락처로 주문하면 나중에 주문조회·
     반품 신청을 영영 못 했고, 객체를 보내면 "[object Object]"가 이름으로 저장됐다(2026-10-28 정기 감사). */
  for (const f of [...REQUIRED_CUSTOMER_FIELDS, "addr2", "memo"]) {
    if (customer[f] !== undefined && customer[f] !== null && typeof customer[f] !== "string") {
      return { error: { status: 400, body: { error: "주문자 정보 형식이 올바르지 않습니다." } } };
    }
  }
  const missing = REQUIRED_CUSTOMER_FIELDS.filter((f) => !String(customer[f] || "").trim());
  if (missing.length) {
    const fields = missing.join(", ");
    return { error: { status: 400, body: { error: `필수 항목이 비었습니다: ${fields}`, i18n: { key: "필수 항목이 비었습니다: {fields}", vars: { fields } } } } };
  }
  const telDigitsOnly = String(customer.tel).replace(/\D/g, "");
  if (telDigitsOnly.length < 9 || telDigitsOnly.length > 11) {
    return { error: { status: 400, body: { error: "연락처를 숫자로 정확히 입력해 주세요.", code: "INVALID_TEL" } } };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(customer.email).trim())) {
    return { error: { status: 400, body: { error: "이메일 주소를 정확히 입력해 주세요.", code: "INVALID_EMAIL" } } };
  }
  // 차단된 회원이 로그아웃하고 같은 이메일로 비회원 주문하는 길도 막는다(lib/bans.js).
  if (await isEmailBanned(customer.email)) {
    return { error: { status: 403, body: { error: BANNED_MESSAGE, code: "banned" } } };
  }
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return { error: { status: 400, body: { error: "장바구니 항목이 없습니다." } } };
  }
  if (!hasPhysicalProduct(rawItems)) {
    return { error: { status: 400, body: { error: "참은 후디·집업 등 상품과 함께 주문할 때만 구매할 수 있습니다.", code: "CHARM_ONLY" } } };
  }

  /* 예전에 담아 둔 장바구니에 지금은 팔지 않는 사이즈가 남아 있으면, 뭉뚱그린 오류 대신 어느 상품인지 알려준다(2026-10-28) */
  const badSizeIndex = rawItems.findIndex((raw) => {
    const p = raw && typeof raw.productId === "string" && !raw.productId.startsWith("charm-") ? products.find((x) => x.id === raw.productId) : null;
    return p && Array.isArray(p.sizes) && p.sizes.length && !(typeof raw.size === "string" && p.sizes.includes(raw.size));
  });
  if (badSizeIndex >= 0) {
    const bad = rawItems[badSizeIndex];
    const bp = products.find((x) => x.id === bad.productId);
    const name = (bp && (bp.nameKo || bp.name)) || bad.productId;
    const size = String(bad.size || "-");
    return { error: { status: 400, body: {
      error: `${name} ${size} 사이즈는 지금 판매하지 않습니다. 장바구니에서 빼고 다시 담아 주세요.`,
      i18n: { key: "{name} {size} 사이즈는 지금 판매하지 않습니다. 장바구니에서 빼고 다시 담아 주세요.", vars: { name, size } },
      code: "INVALID_SIZE", index: badSizeIndex,
    } } };
  }

  /* 참 줄은 실제 있는 참만(아무 키나 받던 것), 같은 상품·컬러·사이즈를 여러 줄로 나눠 한 줄 상한(99개)을 넘기는 것도 막는다
     (2026-10-28 정기 감사) */
  const validCharmKeys = new Set((CHARMS || []).map((c) => c.key).filter((k) => k !== "none"));
  if (rawItems.some((raw) => raw && typeof raw === "object" && raw.charm && raw.charm.key && raw.charm.key !== "none" && !validCharmKeys.has(raw.charm.key))) {
    return { error: { status: 400, body: { error: "존재하지 않는 상품·참(charm) 또는 잘못된 수량이 포함되어 있습니다." } } };
  }
  {
    const perVariant = new Map();
    for (const raw of rawItems) {
      if (!raw || typeof raw !== "object") continue;
      const k = `${raw.productId}|${raw.color || ""}|${raw.size || ""}`;
      perVariant.set(k, (perVariant.get(k) || 0) + (Math.floor(Number(raw.qty)) || 0));
    }
    if ([...perVariant.values()].some((q) => q > 99)) {
      return { error: { status: 400, body: { error: "한 상품은 한 번에 99개까지 주문할 수 있습니다.", code: "QTY_LIMIT" } } };
    }
  }

  const items = rawItems.map((raw) => priceItem(raw, products, PRICE_OPTS));
  if (items.some((it) => it === null)) {
    return { error: { status: 400, body: { error: "존재하지 않는 상품·참(charm) 또는 잘못된 수량이 포함되어 있습니다." } } };
  }

  const subtotal = items.reduce((s, it) => s + it.sum, 0);
  const shipping = shippingFor(subtotal, SITE.shipping);

  let coupon;
  try {
    coupon = await resolveCoupon(supabaseAdmin, couponCode, { rawItems, items, subtotal });
  } catch (e) {
    return { error: { status: e.status || 400, body: { error: e.message, i18n: e.i18n } } };
  }

  /* 배송비까지 포인트로 낼 수는 없으므로 (상품 합계 - 쿠폰 할인액)을 상한으로 clamp한다
     (lib/loyaltyPoints.js 참고) — 비회원(userId 없음)이면 항상 0. */
  const pointsUsed = await resolvePointsToUse(supabaseAdmin, userId, rawPointsToUse, Math.max(0, subtotal - coupon.discount));

  const total = subtotal - coupon.discount - pointsUsed + shipping;
  /* 무료배송 금액 이상 + 전액 쿠폰(또는 "적립금 전액 사용")이면 결제할 금액이 0원이 된다. 이 주문은 결제창 없이
     무통장 경로(/api/order)로 받아 바로 "입금확인"으로 만든다(아래 zeroTotal 처리). 카드결제창은 0원을 받지 않으므로
     결제 준비(/api/payments/prepare)에서만 거절한다(2026-10-28 정기 감사 — 처음엔 0원을 거절했다가 "전액 사용" 버튼이
     항상 실패하는 문제가 생겨 이렇게 바꿈). */
  return {
    rawItems,
    items,
    subtotal,
    shipping,
    coupon,
    pointsUsed,
    total,
    zeroTotal: total <= 0,
    device: ORDER_DEVICE_TYPES.includes(device) ? device : "unknown",
  };
}

module.exports = { validateAndPriceOrder, REQUIRED_CUSTOMER_FIELDS, PRICE_OPTS, ORDER_DEVICE_TYPES };
