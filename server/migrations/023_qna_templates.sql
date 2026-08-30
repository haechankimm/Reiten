-- REITEN — CS 빠른 답변 템플릿 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- Q&A 답변창 옆에 자주 쓰는 답변을 버튼 한 번으로 채워 넣기 위한 템플릿 저장소.
-- 완전 자동응답이 아니라 관리자가 고르고 필요하면 고쳐서 등록하는 방식 — 답변 시간만 줄여준다.
create table if not exists qna_templates (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table qna_templates enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.
