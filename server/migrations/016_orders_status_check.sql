-- REITEN — 주문 상태값 제약 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--
-- orders.status는 지금까지 그냥 자유 문자열이었다(001_init.sql) — 어딘가에서 오타로
-- "입금대기 "(뒤에 공백) 같은 값이 들어가면 필터·통계에서 조용히 빠져버릴 수 있었다.
-- 관리자 패널(works/index.html의 ORDER_STATUSES)이 실제로 쓰는 5개 값으로 제약을 건다.
--
-- ⚠️ 먼저 아래 쿼리로 이 5개 값 밖의 status가 이미 들어있는 주문이 있는지 확인하세요.
--    있다면 제약을 추가하기 전에 먼저 올바른 값으로 고쳐야 합니다(그래야 ALTER TABLE이 성공합니다):
--
--    select status, count(*) from orders
--    where status not in ('입금대기', '입금확인', '배송중', '완료', '취소')
--    group by status;

alter table orders add constraint orders_status_check
  check (status in ('입금대기', '입금확인', '배송중', '완료', '취소'));
