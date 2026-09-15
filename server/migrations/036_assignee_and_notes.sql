-- REITEN — 담당자 지정 + 관리자 내부 메모 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--
-- 관리자가 2명 이상이 되면 "이 주문/반품/문의는 누가 처리 중인지", "왜 이렇게 처리했는지"가
-- 화면만 봐서는 안 보인다는 지적(2026-09) — 주문·반품/교환·QnA 세 곳에 담당자(assigned_to,
-- 관리자 계정 uuid)와 내부 메모(internal_note, 고객에게는 절대 노출되지 않는 텍스트)를 추가한다.
-- assigned_to는 auth.users를 참조하되, 담당자였던 관리자 계정이 나중에 삭제돼도(admins.js의
-- DELETE) 그 주문/반품/문의 자체가 지워지면 안 되므로 on delete set null로 둔다.

alter table orders add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table orders add column if not exists internal_note text;

alter table return_requests add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table return_requests add column if not exists internal_note text;

alter table qna add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table qna add column if not exists internal_note text;

create index if not exists orders_assigned_to_idx on orders (assigned_to);
create index if not exists return_requests_assigned_to_idx on return_requests (assigned_to);
create index if not exists qna_assigned_to_idx on qna (assigned_to);
