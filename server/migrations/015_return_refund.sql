-- REITEN — 반품 승인 시 카드결제 자동환불 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.

-- 반품이 승인(완료)될 때 이미 포트원 환불을 시도했는지 표시 — 중복 환불(같은 결제를 두 번
-- 취소 시도하는 사고) 방지. restocked 컬럼(011_auto_cancel_and_restock.sql)과 같은 목적이다.
alter table return_requests add column if not exists refunded boolean not null default false;
