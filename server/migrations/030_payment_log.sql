-- REITEN — 결제 트랜잭션 로그 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql · 009_card_payments.sql을 먼저 실행한 상태여야 합니다.)

-- pending_payments는 결제 전 스테이징 행일 뿐이라(상태 컬럼 없음, 성공 시 삭제됨) 결제 원장으로
--못 쓴다. 지금까지는 포트원 검증 실패·불일치·에러가 전부 console.error로만 남고 어디에도
-- 저장되지 않았다 — 2026-09 "결제 트랜잭션 로그" 요청으로, orders에 안 남는(=주문이 안 된) 결제
-- 시도까지 전부 흔적을 남기기 위한 insert-only 로그. 성공 건은 finalizeCardOrder가, 실패·불일치·
-- 에러는 웹훅과 /api/order 카드 분기 양쪽이 각자 남긴다(server.js 참고).
create table if not exists payment_log (
  id uuid primary key default gen_random_uuid(),
  payment_id text not null,
  order_no text,                 -- 성공(paid)한 건만 채워짐
  status text not null check (status in ('paid', 'failed', 'mismatch', 'error')),
  amount int,
  method text,                   -- 예: "card" — 현재는 카드결제(포트원)만 이 로그를 거침
  reason text,                   -- 실패·불일치·에러 사유(사람이 읽을 수 있는 요약)
  created_at timestamptz not null default now()
);

alter table payment_log enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.

create index if not exists payment_log_created_idx on payment_log (created_at desc);
create index if not exists payment_log_status_idx on payment_log (status);
create index if not exists payment_log_payment_id_idx on payment_log (payment_id);
