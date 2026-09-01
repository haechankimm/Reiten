/* 상품 ID 존재 여부 확인용 — QnA·리뷰 등록 시 "이 상품이 실제로 있는지"만 가볍게 확인하는
   용도라 전체 상품 정보(withRealSoldOut 등)는 필요 없다. server.js·routes/qna.js·
   routes/reviews.js가 전부 이 함수를 썼는데 각자 복붙돼 있던 것을 하나로 뽑았다
   (2026-09-01, 라우트 분리 다음 라운드 — qna.js에 남아있던 메모 참고). */
const { PRODUCTS: STATIC_PRODUCTS } = require("../../소스 코드/assets/js/data.js");
const { supabaseAdmin } = require("./supabase");

async function getAllProductIds() {
  const { data, error } = await supabaseAdmin.from("products").select("id");
  if (error) return STATIC_PRODUCTS.map((p) => p.id);
  return data.map((r) => r.id);
}

module.exports = { getAllProductIds };
