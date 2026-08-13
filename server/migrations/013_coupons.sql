-- REITEN — 쿠폰(할인코드) 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.

-- 코드 자체를 기본키로 쓴다(대소문자 구분 없이 항상 대문자로 저장·조회).
-- scope='all'이면 전체 상품에, scope='products'면 product_ids에 담긴 상품에만 적용된다.
create table if not exists coupons (
  code text primary key,
  discount_type text not null check (discount_type in ('percent', 'amount')),
  discount_value int not null check (discount_value > 0),
  scope text not null default 'all' check (scope in ('all', 'products')),
  product_ids text[] not null default '{}',
  min_subtotal int not null default 0,
  usage_limit int,                  -- null = 무제한
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table coupons enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.

-- 주문에 실제 적용된 쿠폰·할인액을 남긴다(사용 횟수 집계에도 이 컬럼을 그대로 쓴다).
alter table orders add column if not exists coupon_code text references coupons(code);
alter table orders add column if not exists discount int not null default 0;

alter table pending_payments add column if not exists coupon_code text;
alter table pending_payments add column if not exists discount int not null default 0;
