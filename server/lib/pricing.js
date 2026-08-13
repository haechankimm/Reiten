/* 가격·주문번호 계산 — 순수 함수만 모아둔다(테스트하기 쉽도록 Supabase/Express에 의존하지 않음). */

function orderNo(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    "R" +
    String(date.getFullYear()).slice(2) +
    p(date.getMonth() + 1) +
    p(date.getDate()) +
    "-" +
    String(Math.floor(Math.random() * 9000) + 1000)
  );
}

/* 클라이언트가 보낸 unit/sum은 신뢰하지 않는다.
   productId + charm + extras 조합만으로 상품/참/추가아이템 가격을 다시 계산한다. */
function priceItem(raw, products, { extras, charmPrice, extraPrice }) {
  const qty = Math.max(1, Math.min(99, Math.floor(Number(raw.qty) || 1)));
  const charmKey = raw.charm && raw.charm.key && raw.charm.key !== "none" ? raw.charm.key : null;

  const extraKeys = Array.isArray(raw.extras) ? raw.extras : [];
  if (extraKeys.some((k) => !extras.find((x) => x.key === k))) return null;
  const extrasTotal = extraKeys.length * extraPrice;

  let unit;
  if (typeof raw.productId === "string" && raw.productId.startsWith("charm-")) {
    if (!charmKey) return null;
    unit = charmPrice + extrasTotal;
  } else {
    const product = products.find((p) => p.id === raw.productId);
    if (!product) return null;
    unit = product.price + (charmKey ? charmPrice : 0) + extrasTotal;
  }

  return {
    name: String(raw.name || "").slice(0, 200),
    options: Array.isArray(raw.opts) ? raw.opts.map((o) => `${o.label} ${o.value}`).join(" / ") : "",
    qty,
    unit,
    sum: unit * qty,
  };
}

function shippingFor(subtotal, shippingCfg) {
  if (subtotal === 0) return 0;
  return subtotal >= shippingCfg.freeOver ? 0 : shippingCfg.fee;
}

/* 쿠폰 할인액 계산 — coupon row(coupons 테이블 형태)와 이미 계산된 items(rawItems와 같은 순서)를
   받아 할인액만 계산하는 순수 함수. 쿠폰이 유효한지(활성·기간·사용횟수·최소금액)는 Supabase 조회가
   필요해 server.js(resolveCoupon)에서 먼저 확인하고, 여기서는 "얼마를 깎을지"만 계산한다.
   scope가 'products'면 쿠폰이 적용되는 상품의 합계(base)만 할인 대상으로 삼는다 — 배송비·다른
   상품에는 영향이 없다. */
function couponDiscount(coupon, { subtotal, items, rawItems }) {
  let base = subtotal;
  if (coupon.scope === "products") {
    base = items.reduce((s, it, i) => {
      const raw = rawItems[i];
      return raw && it && coupon.product_ids.includes(raw.productId) ? s + it.sum : s;
    }, 0);
  }
  if (base <= 0) return 0;
  const raw = coupon.discount_type === "percent" ? Math.floor((base * coupon.discount_value) / 100) : coupon.discount_value;
  return Math.max(0, Math.min(raw, base));
}

module.exports = { orderNo, priceItem, shippingFor, couponDiscount };
