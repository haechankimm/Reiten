/* 관리자 목록 API 공용 페이지네이션 — ?page=(1부터)&pageSize= 쿼리를 Supabase .range()용 from/to로 바꾼다. */
function paginationParams(query, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Math.floor(Number(query.pageSize)) || defaultSize));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return { page, pageSize, from, to };
}

module.exports = { paginationParams };
