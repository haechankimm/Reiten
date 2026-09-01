-- REITEN — 품절 알림 신청 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.

-- 고객이 상품 상세에서 "이 색상·사이즈 재입고 시 알림받기"를 신청하면 여기 한 줄씩 쌓인다.
-- notified_at이 null인 동안만 "아직 알림을 안 보낸 신청"이고, 관리자가 재고 탭에서 그 조합을
-- 0 이하 → 1 이상으로 바꾸는 순간 서버가 이메일을 보내고 notified_at을 채운다(한 번만 발송).
create table if not exists restock_subscriptions (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  color text not null,
  size text not null,
  email text not null,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);

alter table restock_subscriptions enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.

-- 같은 사람이 같은 조합을 중복 신청하는 것만 막는다(대소문자 구분 없이) — 알림을 이미
-- 보낸 뒤(notified_at이 채워진 뒤)에는 다시 신청할 수 있어야 하므로 조건부 유니크 인덱스로 제한.
create unique index if not exists restock_subscriptions_pending_uidx
  on restock_subscriptions (product_id, color, size, lower(email))
  where notified_at is null;

create index if not exists restock_subscriptions_lookup_idx
  on restock_subscriptions (product_id, color, size)
  where notified_at is null;
