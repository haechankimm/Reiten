-- REITEN — 배송 조회(운송장번호) 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- 관리자가 입력하는 택배사 키(data.js의 COURIERS 참고)와 운송장번호.
-- 사이트는 이 값으로 각 택배사의 조회 페이지 링크만 만들어 보여준다(사이트 내 실시간 조회는 하지 않음).
alter table orders add column if not exists courier text;
alter table orders add column if not exists tracking_no text;
