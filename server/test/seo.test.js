/* lib/seo.js — 검색 로봇용 사전 렌더링·구조화 데이터·네이버쇼핑 EP */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { productJsonLd, productSsrHtml, shopSsrHtml, naverEpTsv, EP_COLUMNS, isFullyOutOfStock } = require("../lib/seo");

const P = {
  id: "reflect-heart-hoodie", nameKo: "리플렉트 하트 후디", name: "Reflect Heart Hoodie", price: 89000, category: "후드티",
  images: ["https://res.cloudinary.com/x/a.jpg", "/assets/img/b.webp"], colors: ["black"], sizes: ["M", "L"], soldOut: [],
  outOfStockByColor: {}, short: "야간에 빛나는 하트", desc: "설명 <b>태그</b>", details: ["코튼 100%"],
};

test("JSON-LD — 가격·재고·이미지 절대주소, </script> 끊김 방지", () => {
  const ld = JSON.parse(productJsonLd(P, { reviewCount: 3, ratingAvg: 4.67 }));
  assert.equal(ld.offers.price, 89000);
  assert.equal(ld.offers.availability, "https://schema.org/InStock");
  assert.equal(ld.image[1], "https://reiten.kr/assets/img/b.webp");
  assert.equal(ld.aggregateRating.ratingValue, 4.7);
  assert.ok(!productJsonLd({ ...P, desc: "</script><script>alert(1)" }).includes("</script>"));
});

test("사전 렌더링 HTML은 사용자 입력을 이스케이프한다", () => {
  const html = productSsrHtml(P);
  assert.ok(html.includes("리플렉트 하트 후디"));
  assert.ok(html.includes("89,000원"));
  assert.ok(!html.includes("<b>태그</b>"));
  assert.ok(shopSsrHtml([P]).includes('href="product.html?id=reflect-heart-hoodie"'));
});

test("네이버 EP — 필수 열, 사진 없는/전부 품절 상품 제외, 무료배송 기준", () => {
  const soldOut = { ...P, id: "so", outOfStockByColor: { black: ["M", "L"] } };
  const noImage = { ...P, id: "noimg", images: [] };
  const cheap = { ...P, id: "tee", price: 39000 };
  const tsv = naverEpTsv([P, soldOut, noImage, cheap], { reviewCountByProduct: new Map([["reflect-heart-hoodie", 5]]) });
  const lines = tsv.trim().split("\n");
  assert.equal(lines[0], EP_COLUMNS.join("\t"));
  assert.equal(lines.length, 3); // 헤더 + 2개(품절·사진없음 제외)
  const cols = (line) => Object.fromEntries(EP_COLUMNS.map((c, i) => [c, line.split("\t")[i]]));
  const hoodie = cols(lines[1]);
  assert.equal(hoodie.shipping, "3500");
  assert.equal(hoodie.review_count, "5");
  assert.equal(hoodie.add_image_link, "https://reiten.kr/assets/img/b.webp");
  assert.equal(cols(lines[2]).shipping, "3500");
  assert.equal(isFullyOutOfStock(soldOut), true);
  const expensive = naverEpTsv([{ ...P, price: 120000 }]).trim().split("\n")[1];
  assert.equal(cols(expensive).shipping, "0");
});
