-- REITEN — 고객 띠배너 · 상품 공개 예약 · 배송지 주소록 · 단체 주문 문의 (2026-11-21)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (여러 번 실행해도 안전) — 055를 먼저 실행할 것.
--
-- ① site_banners: Works "고객 공지 배너" 탭에서 관리하는 고객 사이트 맨 위 띠배너(휴무·배송 지연 안내 등).
--    starts_at·ends_at을 비우면 켜져 있는 동안 계속, 채우면 그 기간에만 보인다. 영어·일본어 문구가 비면 한국어가 나간다.
-- ② products.publish_at: 공개 예약 시각. 이 시각이 되면 서버가 상품을 자동으로 공개(active=true)하고 이 칸을 비운다.
-- ③ customer_addresses: 회원 배송지 주소록(회원당 최대 10개). 회원 탈퇴 시 함께 지워진다(on delete cascade).
-- ④ group_inquiries: 라이딩 크루·동호회 단체 주문 문의(고객 사이트 "단체 주문 문의" → Works "단체 문의" 탭).
-- 출고 전 고객 셀프 배송지 변경은 새 칸 없이 orders.customer(jsonb)에 바뀐 주소와 이전 주소 기록을 남긴다.
-- 표는 전부 RLS를 켜고 정책을 두지 않는다 = 브라우저 공개 키로는 못 읽음, 서버만 접근.

create table if not exists site_banners (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  message_en text,
  message_ja text,
  link_url text,
  tone varchar(10) not null default 'info' check (tone in ('info', 'warning')),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table site_banners enable row level security;

alter table products add column if not exists publish_at timestamptz;
create index if not exists products_publish_at_idx on products (publish_at) where publish_at is not null;

create table if not exists customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  name text not null,
  tel text not null,
  zip text not null,
  addr text not null,
  addr2 text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_addresses_user_idx on customer_addresses (user_id);
alter table customer_addresses enable row level security;

create table if not exists group_inquiries (
  id uuid primary key default gen_random_uuid(),
  team_name text not null,
  contact_name text not null,
  tel text not null,
  email text not null,
  quantity integer not null,
  products text,
  customization text,
  desired_date date,
  message text,
  status varchar(10) not null default '접수' check (status in ('접수', '상담중', '견적발송', '확정', '종료')),
  admin_memo text,
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists group_inquiries_status_idx on group_inquiries (status, created_at desc);
alter table group_inquiries enable row level security;

create or replace function reiten_schema_version() returns integer language sql stable as $$ select 56 $$;
revoke execute on function reiten_schema_version() from public, anon, authenticated;
