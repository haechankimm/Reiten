/* 여러 라우트 파일(products/reviews/orders)이 똑같은 형태로 쓰는 "일괄 처리 대상 id 목록"
   파싱 — 상품 일괄 처리 때 만든 걸 그대로 공용화했다. */
function parseBulkIds(body) {
  const ids = Array.isArray(body && body.ids) ? body.ids.filter((id) => typeof id === "string" && id) : [];
  return [...new Set(ids)];
}

module.exports = { parseBulkIds };
