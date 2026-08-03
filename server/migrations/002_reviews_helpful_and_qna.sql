-- REITEN — 리뷰 공감 + 상품 Q&A 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- 1. 리뷰 공감(도움돼요) 수
alter table reviews add column if not exists helpful_count int not null default 0;

-- 공감 수 원자적 증가 — 동시에 여러 명이 눌러도 카운트가 안전하게 올라간다
create or replace function increment_helpful(p_id uuid)
returns int as $$
  update reviews set helpful_count = helpful_count + 1
    where id = p_id
    returning helpful_count;
$$ language sql;

-- 2. 상품 Q&A
create table if not exists qna (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,           -- 'general' 허용
  user_id uuid references auth.users(id),
  name text not null,
  question text not null,
  secret boolean not null default false,   -- 비밀글이면 목록에서 질문/답변 내용이 가려짐(작성자 본인·관리자만 열람)
  answer text,
  status text not null default '답변대기' check (status in ('답변대기', '답변완료')),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

alter table qna enable row level security;
-- 정책 없음 = anon/authenticated 키로는 직접 접근 불가. 서버(server/)가 service role key로만 접근하고,
-- 비밀글 가림 처리는 server.js의 toQnaDto()가 담당한다.

create index if not exists qna_product_id_idx on qna (product_id);
