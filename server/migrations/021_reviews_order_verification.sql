-- REITEN — 리뷰 실구매 인증 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- 지금까지는 productId만 맞으면 구매 이력 확인 없이 누구나 리뷰를 등록할 수 있었다. 주문번호+
-- 연락처로 실제 그 상품을 산 주문이 맞는지 서버가 확인한 뒤에만 저장하도록 바꾸면서, 어느
-- 주문으로 작성한 리뷰인지 남겨 같은 주문으로 같은 상품에 중복 리뷰를 못 쓰게 막는다.
-- (기존 리뷰는 order_no가 비어있는 채로 남아도 무방 — null 허용, 제약도 null은 건너뜀.)
alter table reviews add column if not exists order_no text;

create unique index if not exists reviews_order_product_uidx
  on reviews (order_no, product_id)
  where order_no is not null;
