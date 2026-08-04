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

module.exports = { orderNo, priceItem, shippingFor };
