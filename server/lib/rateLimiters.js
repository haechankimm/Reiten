/* ---------- 남용 방지 제한(rate limit) — 반드시 이 파일의 인스턴스만 쓴다 ----------
   여러 라우트 파일(server.js, routes/*.js)이 똑같은 limiter 인스턴스를 같이 써야 한다 — 파일마다
   rateLimit(...)를 새로 만들면 각자 별도의 카운터를 갖게 돼서 제한이 파일 수만큼 나눠져 느슨해진다.

   2026-10-02 재구성: 예전엔 writeLimiter(IP당 15분 20회) 하나를 주문·결제·쿠폰 확인·주문 조회·리뷰·
   문의·반품까지 전부 같이 써서, ① 쿠폰을 몇 번 눌러본 손님이 정작 주문 단계에서 막히고 ② 통신사
   공유 IP(LTE·5G는 수많은 고객이 같은 공인 IP를 씀) 뒤의 정상 고객끼리 한도를 나눠 쓰는 문제가
   있었다. 이제 용도별로 카운터를 나누고, 로그인한 회원은 IP가 아니라 회원 id로 센다(라우트에서
   optionalAuth/requireAuth 뒤에 둬야 req.user가 채워져 있다 — 앞에 두면 그냥 IP로 센다).
   한도 초과 문구는 번역 사전(i18n.js)에 들어 있어 영어·일본어 화면에서도 번역돼 보인다(apiErrorText). */
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const WINDOW_MS = 15 * 60 * 1000;
const TOO_MANY = {
  error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  code: "RATE_LIMITED",
};

function memberOrIpKey(req) {
  if (req.user && req.user.id) return `user:${req.user.id}`;
  return `ip:${ipKeyGenerator(req.ip || "")}`;
}

function makeLimiter(max, { skip } = {}) {
  return rateLimit({
    windowMs: WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: memberOrIpKey,
    skip,
    message: TOO_MANY,
  });
}

/* 주문 접수·결제 준비 — 돈이 걸린 경로라 넉넉히 두되(결제창을 몇 번 다시 열어도 막히지 않게),
   무통장 주문으로 재고를 잔뜩 잡아두는 장난은 막을 수준. 카드결제 "확인" 요청(paymentId만 보냄)은
   이미 결제가 끝난 뒤라 절대 막지 않는다(막히면 결제는 됐는데 주문완료 화면을 못 보는 사고). */
const orderLimiter = makeLimiter(30, { skip: (req) => !!(req.body && req.body.paymentId) });

/* 비회원 주문 조회(주문번호+연락처) — 무차별 대입 대상이라 따로 센다. */
const lookupLimiter = makeLimiter(30);

/* 장바구니 쿠폰 확인 — 코드 대입 방지용으로만 제한, 주문 한도와는 별개. */
const couponLimiter = makeLimiter(30);

/* 글쓰기류(문의·리뷰·반품 신청·품절 알림 신청·공감) — 기존 writeLimiter 이름 그대로. */
const writeLimiter = makeLimiter(20);

/* 로그인 잠금 보고·회원 탈퇴처럼 계정 보안과 직결된 경로. */
const authLimiter = makeLimiter(20);

/* 전체 /api 기본 한도 — 공유 IP 환경과 Works(관리자 화면은 요청이 많음)를 감안해 넉넉하게. */
const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
});

module.exports = { orderLimiter, lookupLimiter, couponLimiter, writeLimiter, authLimiter, apiLimiter, memberOrIpKey };
