-- REITEN — 미입금 자동취소 · 반품 재고복원 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- 1. 재고 복원 — decrement_inventory의 반대. 행이 없으면 새로 만들고, 있으면 더한다.
--    자동취소(재고를 되돌림)·반품 승인(재고를 되돌림) 양쪽에서 재사용한다.
create or replace function restore_inventory(p_items jsonb)
returns void as $$
declare
  it jsonb;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    insert into inventory (product_id, size, qty)
    values (it ->> 'productId', it ->> 'size', (it ->> 'qty')::int)
    on conflict (product_id, size)
    do update set qty = inventory.qty + excluded.qty;
  end loop;
end;
$$ language plpgsql;

-- 2. 주문이 취소된 이유를 남긴다 — 관리자가 수동으로 취소했는지, 미입금으로 자동 취소됐는지 구분.
alter table orders add column if not exists cancel_reason text;

-- 3. 반품 승인 시 재고를 이미 복원했는지 표시 — 중복 복원(재고가 두 번 늘어나는 사고) 방지.
alter table return_requests add column if not exists restocked boolean not null default false;
