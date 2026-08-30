-- REITEN — 주문번호 충돌 근본 해결 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- 기존 주문번호는 "R+날짜+임의 4자리(1000~9999)"라 하루 주문이 많아지면 같은 번호가 나올 확률이
-- 무시 못할 수준이었다(생일수학 문제). orders.order_no가 UNIQUE라 겹치면 저장 자체가 실패하는데,
-- 카드결제는 이미 승인된 뒤 이 저장을 하므로 "결제는 됐는데 주문 기록이 없는" 사고로 이어진다.
-- 임의값의 폭을 넓히는 미봉책 대신, Postgres 시퀀스로 절대 겹치지 않는 일련번호를 발급받아
-- 날짜 뒤에 붙인다 — 시퀀스는 Postgres가 원자적으로 보장하므로 이 부분에서는 충돌이 원천적으로
-- 불가능해진다(하루 리셋 없이 계속 증가하는 값이라 날짜가 같아도 절대 안 겹침).
create sequence if not exists reiten_order_seq;

create or replace function next_order_seq()
returns bigint
language sql
as $$
  select nextval('reiten_order_seq');
$$;
