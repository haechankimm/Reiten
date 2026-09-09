-- REITEN — 주문취소 신청(고객 사유 선택) 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--
-- 지금까지 고객이 스스로 "주문을 취소해 달라"고 신청할 방법이 없었다 — CS 채팅·전화로
-- 요청하면 관리자가 Works에서 수동으로 상태를 "취소"로 바꾸면서 사유(cancel_reason,
-- 011_auto_cancel_and_restock.sql)를 직접 입력하는 식이었다. 이번에 order-lookup.html에
-- "주문취소 신청" 폼을 추가하면서, 반품·교환(return_requests, 001_init.sql)과 같은 테이블을
-- 재사용하되 "이게 반품인지 교환인지 취소 신청인지" 구분이 필요해져 request_type을 추가한다.
-- custom_reason은 사유를 "기타"로 고르고 직접 입력한 텍스트를 담는다(reason 자체는 계속
-- "기타"로 남아 있어 통계 집계 시 카테고리가 잘게 쪼개지지 않는다).

alter table return_requests add column if not exists request_type text not null default 'return'
  check (request_type in ('return', 'exchange', 'cancel'));
alter table return_requests add column if not exists custom_reason text;

create index if not exists return_requests_request_type_idx on return_requests (request_type);
