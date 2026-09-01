/* Supabase(PostgREST/Postgres)가 "마이그레이션이 아직 안 된 테이블/컬럼"을 만났을 때 돌려주는
   에러 코드를 한 곳에서 판단한다. 여러 라우트 파일이 이 판단을 각자 손으로
   (`error.code === "PGRST205"` 등) 반복해서 작성하고 있었는데, 코드 하나라도 잘못 베끼면
   "마이그레이션 미실행 시 조용히 저하" 원칙이 조용히 깨진다(2026-09-01 코드 감사에서
   8개 파일에 흩어져 있던 것을 발견해 하나로 모음).

   - PGRST205: PostgREST 스키마 캐시에 테이블 자체가 없음(SELECT/INSERT 공통).
   - 42P01: PostgREST를 거치지 않는 일부 RPC 등에서 나오는 "테이블 없음"의 raw Postgres 코드.
   - PGRST204: INSERT/UPDATE에서 존재하지 않는 컬럼을 지정.
   - 42703: SELECT에서 존재하지 않는 컬럼을 지정했을 때의 raw Postgres 코드 — PostgREST가
     INSERT/UPDATE와 SELECT에서 컬럼 누락을 서로 다른 코드 체계로 알려준다는 걸 직접 테스트로
     확인한 뒤 반영함(server.js/routes/dashboard.js 원래 주석 참고). */
function isMissingSchemaError(error) {
  return !!error && (error.code === "PGRST205" || error.code === "42P01");
}

function isMissingColumnError(error) {
  return !!error && (error.code === "PGRST204" || error.code === "42703");
}

module.exports = { isMissingSchemaError, isMissingColumnError };
