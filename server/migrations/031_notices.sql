-- REITEN — 관리자 공지·게시판 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- 관리자가 여러 명이 되면서(2026-09-01 마스터 관리자 도입) "정보" 탭의 단순 키-값 메모만으로는
-- 부족해졌다 — 누가 언제 무슨 공지를 남겼는지가 안 남아서, 작성자·날짜가 남는 간단한 게시판을
-- 따로 둔다. 수정·삭제는 본인 글이거나 마스터 관리자만 가능(server/routes/notices.js 참고).
create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id),
  author_email text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table notices enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.

create index if not exists notices_created_idx on notices (created_at desc);
