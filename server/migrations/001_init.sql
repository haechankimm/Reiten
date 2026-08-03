-- REITEN — Supabase 초기 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.

-- 1. 회원 프로필 (auth.users 확장)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  phone text,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "본인 프로필만 조회" on profiles
  for select using (auth.uid() = id);

-- 회원가입 시 프로필 자동 생성
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name) values (new.id, new.raw_user_meta_data ->> 'name');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 2. 주문 (orders.json 대체)
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique not null,
  user_id uuid references auth.users(id),
  customer jsonb not null,
  items jsonb not null,
  subtotal int not null,
  shipping int not null,
  total int not null,
  status text not null default '입금대기',
  created_at timestamptz not null default now()
);

alter table orders enable row level security;
-- 정책을 두지 않음 = anon/authenticated 키로는 아무것도 접근 불가.
-- 서버(server/)만 service role key로 RLS를 우회해 접근한다.

create index if not exists orders_user_id_idx on orders (user_id);

-- 3. 리뷰 (reviews.json 대체 + 사진/인스타 아이디)
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  name text not null,
  rating int not null check (rating between 1 and 5),
  comment text not null,
  photo_url text,
  instagram_handle text,
  created_at timestamptz not null default now()
);

alter table reviews enable row level security;

create index if not exists reviews_product_id_idx on reviews (product_id);

-- 4. 재고 (상품 x 사이즈별 수량)
create table if not exists inventory (
  product_id text not null,
  size text not null,
  qty int not null default 0,
  primary key (product_id, size)
);

alter table inventory enable row level security;

-- 5. 반품/교환 신청
create table if not exists return_requests (
  id uuid primary key default gen_random_uuid(),
  order_no text not null,
  user_id uuid references auth.users(id),
  contact_name text not null,
  contact_tel text not null,
  reason text not null,
  detail text,
  status text not null default '접수',
  created_at timestamptz not null default now()
);

alter table return_requests enable row level security;

create index if not exists return_requests_order_no_idx on return_requests (order_no);

-- 6. 재고 원자적 차감 — 동시 주문 시에도 한쪽만 성공하도록 하나의 트랜잭션으로 처리
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
        and size = it ->> 'size'
        and qty >= (it ->> 'qty')::int;

    get diagnostics affected = row_count;
    if affected = 0 then
      raise exception 'OUT_OF_STOCK:%:%', it ->> 'productId', it ->> 'size';
    end if;
  end loop;
end;
$$ language plpgsql;

-- 관리자 승격 예시 (회원가입 후, 본인 uuid는 Authentication 탭에서 확인):
-- update profiles set role = 'admin' where id = '<uuid>';

-- 재고 초기값 시드 예시 (상품별 사이즈에 맞게 직접 채워 넣으세요):
-- insert into inventory (product_id, size, qty) values
--   ('core-zip-hoodie', 'S', 20),
--   ('core-zip-hoodie', 'M', 20),
--   ('core-zip-hoodie', 'L', 20),
--   ('core-zip-hoodie', 'XL', 20);
