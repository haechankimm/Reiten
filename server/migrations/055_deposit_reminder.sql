-- 055: 미입금 주문 리마인드(2026-11-11)
-- 무통장입금 주문이 자동 취소(24시간)되기 약 6시간 전에 "아직 입금 전이에요" 안내를 한 번만 보내려고,
-- 보낸 시각을 orders.deposit_reminded_at에 남긴다(중복 발송 방지). 여러 번 실행해도 안전하다.
alter table orders add column if not exists deposit_reminded_at timestamptz;

create or replace function reiten_schema_version() returns integer language sql stable as $$ select 55 $$;
revoke execute on function reiten_schema_version() from public, anon, authenticated;
