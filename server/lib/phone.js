/* 전화번호를 숫자만 남겨 비교용으로 통일 — 주문 조회·리뷰/반품 실구매 인증·감사 쿠폰 중복 발급
   판정 등 여러 라우트 파일에서 공통으로 쓰여 하나로 뽑았다. */
function normalizeTel(s) {
  return String(s || "").replace(/\D/g, "");
}

module.exports = { normalizeTel };
