-- REITEN — 주문이 늘었을 때를 대비한 조회 색인 (2026-11-09)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (여러 번 실행해도 안전)
--
-- 지금은 주문이 적어 차이가 없지만, 런칭 후 주문이 수천~수만 건이 되면 아래 조회가 매번 표 전체를 훑게 된다:
--   · Works 주문 목록·내보내기(최신순), 대시보드 기간 집계 → orders(created_at)
--   · 매시 미입금 자동취소("입금대기"이면서 24시간 지난 주문) → orders(status, created_at)
--   · 30분마다 결제 이탈 리마인드(아직 안 보낸 결제창 이탈 건) → pending_payments(created_at) 일부 색인
-- 색인은 결과를 바꾸지 않고 찾는 속도만 빠르게 한다. 실행하지 않아도 사이트는 그대로 동작한다.
create index if not exists orders_created_at_idx on orders (created_at desc);
create index if not exists orders_status_created_at_idx on orders (status, created_at);
create index if not exists pending_payments_reminder_idx on pending_payments (created_at) where reminder_sent_at is null;
