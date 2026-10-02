/* ---------- 악성 회원 사이트 차단 ----------
   Works 회원 관리의 "차단"은 Supabase Auth의 ban_duration을 쓴다 — 그것만으로는 새 로그인만
   막히고, ① 이미 로그인해 있던 사람의 토큰은 만료(최대 1시간) 전까지 그대로 통하고 ② 로그아웃한
   뒤 같은 이메일로 비회원 주문을 넣는 길이 열려 있었다(2026-10-02 사용자 요청으로 보강).
   그래서 ①은 lib/auth.js가 매 요청 getUser() 결과의 banned_until을 보고 바로 막고, ②는 주문
   검증(validateAndPriceOrder)이 이 모듈의 isEmailBanned()로 주문자 이메일을 확인한다.
   차단된 이메일 목록은 listUsers() 한 번으로 만들고 5분 캐시한다(주문마다 Admin API를 부르지
   않기 위함) — 차단/해제 직후에는 routes/members.js가 invalidateBanCache()로 바로 비운다. */
const { supabaseAdmin } = require("./supabase");

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = null; // { emails: Set<string>, at: number }

function isUserBanned(user) {
  return !!(user && user.banned_until && new Date(user.banned_until) > new Date());
}

async function bannedEmailSet() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.emails;
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  /* 조회 실패 시에는 주문을 막지 않는다(차단 확인 실패로 정상 고객 주문까지 멈추는 게 더 큰 사고).
     캐시에도 쓰지 않아 다음 요청이 바로 다시 시도한다. */
  if (error || !data) return new Set();
  const emails = new Set(
    (data.users || []).filter(isUserBanned).map((u) => (u.email || "").trim().toLowerCase()).filter(Boolean)
  );
  cache = { emails, at: Date.now() };
  return emails;
}

async function isEmailBanned(email) {
  const needle = String(email || "").trim().toLowerCase();
  if (!needle) return false;
  return (await bannedEmailSet()).has(needle);
}

function invalidateBanCache() {
  cache = null;
}

const BANNED_MESSAGE = "이용이 제한된 계정입니다. 문의가 필요하시면 고객센터로 연락해 주세요.";

module.exports = { isUserBanned, isEmailBanned, invalidateBanCache, BANNED_MESSAGE };
