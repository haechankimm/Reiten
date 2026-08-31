/* 여러 라우트 파일(server.js, routes/*.js)이 똑같은 rate limiter 인스턴스를 같이 써야
   한다 — 파일마다 따로 rateLimit(...)를 새로 만들면 각자 별도의 카운터를 갖게 돼서
   "IP당 15분에 20회"라는 제한이 파일 수만큼 나눠져 사실상 느슨해진다(예: 파일 2개가 각자
   만들면 실질 허용치가 40회가 됨). 반드시 이 파일에서 만든 하나만 여기저기서 재사용한다. */
const rateLimit = require("express-rate-limit");

// 주문/리뷰/문의/반품/조회처럼 쓰기·조회 남용 여지가 큰 엔드포인트는 더 엄격하게: IP당 15분에 20회
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
});

module.exports = { writeLimiter };
