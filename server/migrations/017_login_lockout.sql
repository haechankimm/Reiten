-- REITEN — 관리자 로그인 실패 잠금 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--
-- 로그인은 브라우저가 Supabase Auth를 직접 호출한다(server/를 거치지 않음) — 이 테이블은
-- 그 시도 결과를 works/index.html이 우리 서버에 "보고"해서, 같은 이메일로 7번 연속 실패하면
-- 일정 시간 로그인 버튼 자체를 막는 용도다. 어디까지나 실제 로그인 화면을 쓰는 경우에 대한
-- 보완장치이고, Supabase Auth API를 직접 두드리는 진짜 무차별 대입 공격을 막는 근본 대책은
-- 아니다(그건 Supabase 대시보드의 Authentication > Rate Limits/Attack Protection에서
-- 별도로 설정해야 한다 — 코드로는 우회 불가능한 영역).
create table if not exists login_attempts (
  email text primary key,
  fail_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table login_attempts enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.
