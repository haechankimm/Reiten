-- REITEN — 상품 1벌 원가 구성(본체·인쇄·포장·배송 등) (2026-11-11)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (여러 번 실행해도 안전) — 052를 먼저 실행할 것.
--
-- Works "지출·정산 → 상품별 마진"에서 상품마다 원가 항목을 적는다(예: 후디 본체 18,000 / 인쇄 4,000 / 포장 500 /
-- 배송 3,000원을 10벌 기준 → 1벌 300원). 항목 합계가 products.unit_cost(1벌 원가)로 저장돼 마진 계산에 쓰인다.
-- 실행 전에는 "1벌 원가" 한 칸만 쓸 수 있다.
create table if not exists product_cost_items (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  name varchar(60) not null,              -- 예: '후디 본체(무지)', '실크 인쇄', '택배(10벌 묶음)'
  kind varchar(20) not null default 'other', -- body·material·print·labor·packaging·shipping·other
  amount integer not null check (amount >= 0),  -- 이 금액이
  per_qty integer not null default 1 check (per_qty >= 1), -- 몇 벌 기준인지(1벌당이면 1)
  basis varchar(120),                     -- 메모: 거래처·조건(예: '프린트캔버스, 30벌 이상 무료배송')
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_product_cost_items_product on product_cost_items (product_id, sort);
alter table product_cost_items enable row level security;

create or replace function reiten_schema_version() returns integer language sql stable as $$ select 53 $$;
revoke execute on function reiten_schema_version() from public, anon, authenticated;
