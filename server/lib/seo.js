/* ---------- 검색 노출(서버 사전 렌더링) + 네이버쇼핑 EP 피드 (2026-10-02) ----------
   이 사이트는 상품 화면을 브라우저 자바스크립트가 그려서, 자바스크립트를 실행하지 않거나 늦게 실행하는 검색
   로봇(특히 네이버 Yeti)에게는 빈 페이지처럼 보였다. 그래서 서버가 HTML을 보낼 때 ① 상품명·가격·설명·사진을
   담은 기본 HTML ② 구조화 데이터(JSON-LD Product/ItemList) ③ canonical 주소를 미리 끼워 넣는다 — 브라우저에서는
   기존 자바스크립트가 그 자리를 그대로 덮어써서 손님이 보는 화면은 예전과 같다.
   네이버쇼핑 EP는 네이버 쇼핑파트너센터에 등록하는 상품 목록 파일(TSV, EP 3.0 형식)이다.
   이 파일의 함수는 전부 순수 함수(입력 → 문자열)라 테스트하기 쉽다. */
const SITE_URL = "https://reiten.kr";
const BRAND = "REITEN";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function absUrl(src) {
  if (!src) return "";
  if (/^https?:\/\//.test(src)) return src;
  return SITE_URL + (src.startsWith("/") ? src : "/" + src);
}

function productUrl(p) {
  return `${SITE_URL}/product.html?id=${encodeURIComponent(p.id)}`;
}

/* app.js isProductFullyOutOfStock와 같은 기준 — 모든 사이즈가 모든 컬러에서 품절이면 true */
function isFullyOutOfStock(p) {
  const sizes = p.sizes || [];
  const colors = p.colors || [];
  if (!sizes.length || !colors.length) return false;
  return sizes.every(
    (size) => (p.soldOut || []).includes(size) || colors.every((c) => ((p.outOfStockByColor && p.outOfStockByColor[c]) || []).includes(size))
  );
}

function productImages(p) {
  return (p.images || []).filter(Boolean).map(absUrl);
}

function productJsonLd(p, { reviewCount = 0, ratingAvg = 0 } = {}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.nameKo || p.name,
    description: String(p.desc || p.short || "").slice(0, 500),
    sku: p.id,
    brand: { "@type": "Brand", name: BRAND },
    image: productImages(p),
    category: p.category || undefined,
    offers: {
      "@type": "Offer",
      url: productUrl(p),
      priceCurrency: "KRW",
      price: p.price,
      availability: isFullyOutOfStock(p) ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  };
  if (reviewCount > 0 && ratingAvg > 0) {
    data.aggregateRating = { "@type": "AggregateRating", ratingValue: Number(ratingAvg.toFixed(1)), reviewCount };
  }
  // </script> 끊김 방지
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/* 상품 상세 사전 렌더링 — product.html의 #root 안에 들어가고, 브라우저 자바스크립트가 곧바로 덮어쓴다. */
function productSsrHtml(p) {
  const img = productImages(p)[0];
  const price = Number(p.price || 0).toLocaleString("ko-KR");
  return `<article class="ssr-product" style="padding:24px 0">
  <h1 class="h-xl">${esc(p.nameKo || p.name)}</h1>
  ${p.name && p.nameKo ? `<p class="small">${esc(p.name)}</p>` : ""}
  <p class="lede" style="margin-top:12px"><b>${esc(price)}원</b>${isFullyOutOfStock(p) ? " · 품절" : ""}</p>
  ${img ? `<img src="${esc(img)}" alt="${esc(p.nameKo || p.name)}" style="max-width:420px;width:100%;margin-top:16px">` : ""}
  ${p.short ? `<p style="margin-top:16px">${esc(p.short)}</p>` : ""}
  ${p.desc ? `<p style="margin-top:8px">${esc(p.desc)}</p>` : ""}
  ${(p.details || []).length ? `<ul style="margin-top:12px">${p.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
  ${(p.sizes || []).length ? `<p class="small" style="margin-top:12px">사이즈: ${esc(p.sizes.join(" · "))} (남녀공용 오버핏)</p>` : ""}
</article>`;
}

/* 상품 목록 사전 렌더링 — shop.html 그리드 자리에 들어가고 브라우저에서 덮어써진다. 검색 로봇이 상품 링크를 따라가게. */
function shopSsrHtml(products) {
  return `<ul class="ssr-list" style="list-style:none;padding:0;display:grid;gap:8px">${products
    .map((p) => `<li><a href="product.html?id=${encodeURIComponent(p.id)}">${esc(p.nameKo || p.name)}</a> — ${esc(Number(p.price || 0).toLocaleString("ko-KR"))}원${isFullyOutOfStock(p) ? " (품절)" : ""}</li>`)
    .join("")}</ul>`;
}

function itemListJsonLd(products) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: products.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: productUrl(p), name: p.nameKo || p.name })),
  }).replace(/</g, "\\u003c");
}

/* ---------- 네이버쇼핑 EP 3.0 (전체 EP, TSV) ----------
   필수: id, title, price_pc, link, image_link, category_name1, shipping. 탭·줄바꿈은 값 안에 들어가면 안 된다.
   사진이 없거나 전부 품절인 상품은 네이버에 노출해도 살 수 없으니 뺀다(재입고되면 다음 수집 때 다시 들어감). */
const EP_COLUMNS = [
  "id", "title", "price_pc", "price_mobile", "normal_price", "link", "mobile_link", "image_link", "add_image_link",
  "category_name1", "category_name2", "category_name3", "condition", "brand", "maker", "search_tag", "shipping", "review_count",
];

function epCell(v) {
  return String(v ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

function naverEpTsv(products, { shippingFee = 3500, freeOver = 100000, reviewCountByProduct = new Map() } = {}) {
  const rows = products
    .filter((p) => productImages(p).length && !isFullyOutOfStock(p))
    .map((p) => {
      const images = productImages(p);
      const row = {
        id: p.id,
        title: `${BRAND} ${p.nameKo || p.name}`,
        price_pc: p.price,
        price_mobile: p.price,
        normal_price: p.price,
        link: productUrl(p),
        mobile_link: productUrl(p),
        image_link: images[0],
        add_image_link: images.slice(1, 11).join("|"),
        category_name1: "패션의류",
        category_name2: "남녀공용의류",
        category_name3: p.category || "",
        condition: "신상품",
        brand: BRAND,
        maker: BRAND,
        search_tag: ["라이딩", "바이크", "리플렉티브", "야간", p.category || ""].filter(Boolean).join("|"),
        shipping: Number(p.price) >= freeOver ? 0 : shippingFee,
        review_count: reviewCountByProduct.get(p.id) || 0,
      };
      return EP_COLUMNS.map((c) => epCell(row[c])).join("\t");
    });
  return [EP_COLUMNS.join("\t"), ...rows].join("\n") + "\n";
}

module.exports = {
  SITE_URL, productUrl, isFullyOutOfStock, productJsonLd, productSsrHtml, shopSsrHtml, itemListJsonLd, naverEpTsv, EP_COLUMNS,
};
