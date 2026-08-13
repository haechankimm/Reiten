-- REITEN — 재고를 "사이즈" 단위에서 "컬러 + 사이즈" 단위로 세분화
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--
-- ⚠️ 실행하는 즉시 기존 재고 수량이 전부 지워지고(컬러 구분이 없어 그대로 옮길 수 없음),
--    관리자가 재고 탭에서 상품 × 컬러 × 사이즈 조합별로 실제 수량을 다시 입력하기 전까지는
--    사이트의 모든 상품이 "품절"로 표시됩니다. 트래픽이 적은 시간에 실행하고,
--    실행 직후 바로 재고 탭에서 수량을 채워 넣으세요.

truncate table inventory;

alter table inventory add column if not exists color text not null default '';
alter table inventory drop constraint if exists inventory_pkey;
alter table inventory add primary key (product_id, color, size);

-- 재고 원자적 차감 — 컬러까지 함께 확인하도록 재정의(001_init.sql의 버전을 대체한다).
create or replace function decrement_inventory(p_items jsonb)
returns void as $$
declare
  it jsonb;
  affected int;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    update inventory
      set qty = qty - (it ->> 'qty')::int
      where product_id = it ->> 'productId'
        and color = coalesce(it ->> 'color', '')
        and size = it ->> 'size'
        and qty >= (it ->> 'qty')::int;

    get diagnostics affected = row_count;
    if affected = 0 then
      raise exception 'OUT_OF_STOCK:%:%:%', it ->> 'productId', coalesce(it ->> 'color', ''), it ->> 'size';
    end if;
  end loop;
end;
$$ language plpgsql;

-- 재고 복원 — 마찬가지로 컬러까지 포함해서 되돌린다(011_auto_cancel_and_restock.sql의 버전을 대체한다).
create or replace function restore_inventory(p_items jsonb)
returns void as $$
declare
  it jsonb;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    insert into inventory (product_id, color, size, qty)
    values (it ->> 'productId', coalesce(it ->> 'color', ''), it ->> 'size', (it ->> 'qty')::int)
    on conflict (product_id, color, size)
    do update set qty = inventory.qty + excluded.qty;
  end loop;
end;
$$ language plpgsql;

-- 재고 초기값 시드 예시(상품·컬러·사이즈에 맞게 직접 채워 넣으세요):
-- insert into inventory (product_id, color, size, qty) values
--   ('core-zip-hoodie', 'black', 'S', 20),
--   ('core-zip-hoodie', 'black', 'M', 20),
--   ('core-zip-hoodie', 'white', 'S', 15);
