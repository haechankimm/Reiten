/* Supabase(PostgREST/Postgres)가 "마이그레이션이 아직 안 된 테이블/컬럼"을 만났을 때 돌려주는
   에러 코드를 한 곳에서 판단한다. 여러 라우트 파일이 이 판단을 각자 손으로
   (`error.code === "PGRST205"` 등) 반복해서 작성하고 있었는데, 코드 하나라도 잘못 베끼면
   "마이그레이션 미실행 시 조용히 저하" 원칙이 조용히 깨진다(2026-09-01 코드 감사에서
   8개 파일에 흩어져 있던 것을 발견해 하나로 모음).

   - PGRST205: PostgREST 스키마 캐시에 테이블 자체가 없음(SELECT/INSERT 공통).
   - 42P01: PostgREST를 거치지 않는 일부 RPC 등에서 나오는 "테이블 없음"의 raw Postgres 코드.
   - PGRST202: PostgREST 스키마 캐시에 RPC 함수 자체가 없음(마이그레이션에 새 함수를
     추가했는데 아직 실행 안 한 경우 — claim_coupon_usage 등).
   - PGRST204: INSERT/UPDATE에서 존재하지 않는 컬럼을 지정.
   - 42703: SELECT에서 존재하지 않는 컬럼을 지정했을 때의 raw Postgres 코드 — PostgREST가
     INSERT/UPDATE와 SELECT에서 컬럼 누락을 서로 다른 코드 체계로 알려준다는 걸 직접 테스트로
     확인한 뒤 반영함(server.js/routes/dashboard.js 원래 주석 참고). */
function isMissingSchemaError(error) {
  return !!error && (error.code === "PGRST205" || error.code === "PGRST202" || error.code === "42P01");
}

function isMissingColumnError(error) {
  return !!error && (error.code === "PGRST204" || error.code === "42703");
}

/* PGRST204/42703 에러의 message에는 실제 어떤 컬럼이 없는지가 사람이 읽는 문장으로 들어있다
   (PostgREST: "Could not find the 'foo' column of 'orders' in the schema cache", raw
   Postgres: "column orders.foo does not exist" 또는 "column \"foo\" of relation \"orders\"
   does not exist"). insertOrderRow(server.js)처럼 "선택 컬럼 여러 개 중 없는 것만 하나씩
   빼고 재시도"하는 코드가 이 이름을 모르면, 정말 없는 컬럼이 아니라 앞에서부터 순서대로
   찍어 넘기다가 실제로는 존재하는 다른 선택 컬럼까지 잘못 빼버릴 위험이 있다(2026-09
   코드 감사에서 발견 — 마이그레이션 034/035만 안 돌린 배포에서 032/033은 이미 적용된 값까지
   같이 날아갈 뻔함). 못 찾으면 null을 반환해 호출부가 예전처럼 순서대로 시도하는 폴백을
   쓰게 한다. */
function extractMissingColumnName(error) {
  const msg = (error && error.message) || "";
  const byPostgrest = /Could not find the '([a-zA-Z0-9_]+)' column/.exec(msg);
  if (byPostgrest) return byPostgrest[1];
  const byTableDotCol = /column ([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+) does not exist/.exec(msg);
  if (byTableDotCol) return byTableDotCol[2];
  const byRelation = /column "([a-zA-Z0-9_]+)" of relation/.exec(msg);
  if (byRelation) return byRelation[1];
  return null;
}

module.exports = { isMissingSchemaError, isMissingColumnError, extractMissingColumnName };
