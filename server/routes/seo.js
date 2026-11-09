/* 검색·공유용 서버 렌더링(상품·상점 페이지 SSR, 네이버쇼핑 EP, 사이트맵) — server.js에서 분리(2026-11-09, 동작 변경 없음).
   express.static보다 먼저 마운트해야 한다. */
const fs = require("fs");
const path = require("path");
const express = require("express");
const { SITE } = require("../../소스 코드/assets/js/data.js");
const { supabaseAdmin } = require("../lib/supabase");
const { productJsonLd, productSsrHtml, shopSsrHtml, itemListJsonLd, naverEpTsv, productUrl: seoProductUrl } = require("../lib/seo");
const SITE_DIR = path.join(__dirname, "..", "..", "소스 코드");
const { getActiveProducts } = require("../lib/catalog");

const router = express.Router();

function escapeHtmlAttr(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* 카카오톡·페이스북 링크 카드는 가로 1.91:1(1200x630) 기준으로 미리보기를 만든다. 상품 사진은
   세로 4:5라 그대로 쓰면 위아래가 어색하게 잘린다 — Cloudinary의 c_fill,g_auto로 가로 1200x630에
   맞춰 미리 잘라서 내려준다. g_auto는 사진에서 시선이 가는 영역(그래픽·인물 등)을 자동으로 찾아
   그 부분이 잘리지 않도록 크롭 위치를 잡아주는 옵션이라, 그냥 가운데를 자르는 것보다 안전하다. */
function cloudinaryOgImage(url) {
  if (!url || !url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  return url.replace("/upload/", "/upload/c_fill,g_auto,w_1200,h_630,q_auto,f_auto/");
}

/* product.html은 순수 정적 파일(내용은 브라우저에서 JS가 채운다) — 그래서 og:title/og:image를
   JS로 아무리 잘 넣어도, 카카오톡·페이스북 같은 링크 미리보기 봇에는 전혀 반영되지 않는다.
   그 봇들은 JS를 실행하지 않고 서버가 응답한 raw HTML만 그대로 읽기 때문이다("함께 보면 좋은 것"
   추천처럼 화면에 보이는 것과, 크롤러가 보는 것은 다른 문제). express.static보다 먼저 이 라우트를
   등록해 GET /product.html?id=... 요청만 가로채서 <head>의 title·description·og 태그를 실제
   상품 정보로 바꿔치기한 뒤 돌려주고, id가 없거나 상품을 못 찾으면 next()로 넘겨 평소처럼
   정적 파일이 그대로 나가게 한다. */
router.get("/product.html", async (req, res, next) => {
  const id = req.query.id;
  if (!id) return next();

  let product;
  try {
    const products = await getActiveProducts();
    product = products.find((p) => p.id === id);
  } catch (e) {
    return next();
  }
  if (!product) return next();

  let html;
  try {
    html = await fs.promises.readFile(path.join(SITE_DIR, "product.html"), "utf8");
  } catch (e) {
    return next();
  }

  const title = `${product.nameKo} — REITEN`;
  const description = String(product.short || product.desc || "").slice(0, 150);
  const image = (product.images || []).find(Boolean);
  const imageUrl = image
    ? cloudinaryOgImage(new URL(image, `${req.protocol}://${req.get("host")}`).href)
    : "https://reiten.kr/assets/img/og-image.png";
  // og:url은 공유 링크의 utm 등 쿼리가 그대로 박히지 않도록 canonical과 같은 정식 상품 주소를 쓴다(2026-10-28 정기 감사).
  const pageUrl = seoProductUrl(product);

  const metaTags = [
    `<meta property="og:title" content="${escapeHtmlAttr(title)}">`,
    `<meta property="og:description" content="${escapeHtmlAttr(description)}">`,
    `<meta property="og:type" content="product">`,
    `<meta property="og:url" content="${escapeHtmlAttr(pageUrl)}">`,
    `<meta property="og:image" content="${escapeHtmlAttr(imageUrl)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join("\n");

  /* 검색 로봇용 사전 렌더링(lib/seo.js) — canonical·구조화 데이터(JSON-LD)와 상품명·가격·설명 HTML을 미리 넣는다.
     브라우저에서는 product.html 자바스크립트가 #root를 그대로 덮어써 손님 화면은 예전과 같다(2026-10-02). */
  const stats = await reviewStatsFor(product.id).catch(() => ({ reviewCount: 0, ratingAvg: 0 }));
  const seoHead = [
    `<link rel="canonical" href="${escapeHtmlAttr(seoProductUrl(product))}">`,
    `<script type="application/ld+json" id="ld-product">${productJsonLd(product, stats)}</script>`,
  ].join("\n");
  /* 바꿔 넣을 값은 전부 함수로 넘긴다 — 문자열로 넘기면 String.replace가 그 안의 $&·$`·$'·$1을 특수 패턴으로
     해석해서, 관리자가 입력한 상품명·설명에 "$&" 같은 글자가 있으면 원래 HTML 조각이 끼어들어 페이지가 깨졌다
     (2026-10-28 정기 감사). */
  html = html
    .replace(/<title>.*?<\/title>/, () => `<title>${escapeHtmlAttr(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escapeHtmlAttr(description)}">`)
    .replace("</head>", () => `${metaTags}\n${seoHead}\n</head>`)
    .replace('<div class="wrap" id="root"></div>', () => `<div class="wrap" id="root">${productSsrHtml(product)}</div>`);

  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

/* 상품 목록(shop.html)도 검색 로봇용으로 상품 링크·이름·가격 목록과 ItemList 구조화 데이터를 미리 넣는다(lib/seo.js).
   브라우저에서는 shop.html 자바스크립트가 그리드를 덮어쓴다. 카테고리·검색어(?cat=, ?q=)가 있으면 손대지 않는다. */
router.get("/shop.html", async (req, res, next) => {
  if (req.query.cat || req.query.q) return next();
  try {
    const products = await getActiveProducts();
    let html = await fs.promises.readFile(path.join(SITE_DIR, "shop.html"), "utf8");
    if (!html.includes('id="grid"')) return next();
    html = html
      // 상품 페이지와 같은 이유로 함수 치환자를 쓴다(상품명에 $& 등이 있어도 안전, 2026-10-28 정기 감사).
      .replace("</head>", () => `<link rel="canonical" href="https://reiten.kr/shop.html">\n<script type="application/ld+json">${itemListJsonLd(products)}</script>\n</head>`)
      .replace(/<div([^>]*)id="grid"([^>]*)><\/div>/, (_m, a, b) => `<div${a}id="grid"${b}>${shopSsrHtml(products)}</div>`);
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) {
    next();
  }
});

/* 네이버쇼핑 EP(상품 목록 파일, TSV) — 네이버 쇼핑파트너센터 "상품정보 수신 URL"에 https://reiten.kr/ep/naver.tsv 를
   등록하면 네이버가 주기적으로 가져간다(lib/seo.js). 사진 없거나 전부 품절인 상품은 뺀다. 10분 캐시. */
let naverEpCache = { body: null, at: 0 };
router.get("/ep/naver.tsv", async (req, res) => {
  if (!naverEpCache.body || Date.now() - naverEpCache.at > 10 * 60 * 1000) {
    const products = await getActiveProducts();
    const { data: reviewRows } = await supabaseAdmin.from("reviews").select("product_id").eq("approved", true);
    const reviewCountByProduct = new Map();
    (reviewRows || []).forEach((r) => reviewCountByProduct.set(r.product_id, (reviewCountByProduct.get(r.product_id) || 0) + 1));
    naverEpCache = { body: naverEpTsv(products, { shippingFee: SITE.shipping.fee, freeOver: SITE.shipping.freeOver, reviewCountByProduct }), at: Date.now() };
  }
  res.set("Content-Type", "text/tab-separated-values; charset=utf-8").set("Cache-Control", "public, max-age=600");
  res.send(naverEpCache.body);
});

/* 상품별 승인 리뷰 수·평균 별점(구조화 데이터 aggregateRating용) */
async function reviewStatsFor(productId) {
  const { data } = await supabaseAdmin.from("reviews").select("rating").eq("product_id", productId).eq("approved", true);
  const rows = data || [];
  const reviewCount = rows.length;
  const ratingAvg = reviewCount ? rows.reduce((s, r) => s + (Number(r.rating) || 0), 0) / reviewCount : 0;
  return { reviewCount, ratingAvg };
}

/* sitemap.xml — 페이지 목록은 정적 파일에서 가져오되 상품 URL은 지금 판매 중인 상품으로 매번 새로 만든다
   (정적 파일에 박혀 있던 상품 목록이 비공개 전환을 못 따라가 판매 종료 상품 6개가 검색엔진에 계속 노출되던 문제). */
router.get("/sitemap.xml", async (req, res, next) => {
  try {
    const base = await fs.promises.readFile(path.join(SITE_DIR, "sitemap.xml"), "utf8");
    const pageLocs = [...base.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => !u.includes("product.html?id="));
    const products = await getActiveProducts();
    const productLocs = products.map((p) => `https://reiten.kr/product.html?id=${encodeURIComponent(p.id)}`);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...pageLocs, ...productLocs]
      .map((u) => `  <url><loc>${escapeHtmlAttr(u)}</loc></url>`)
      .join("\n")}\n</urlset>\n`;
    res.set("Content-Type", "application/xml; charset=utf-8").set("Cache-Control", "public, max-age=3600").send(xml);
  } catch (err) {
    next();
  }
});

module.exports = router;
