-- REITEN — Works 브라우저 푸시 알림 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.

-- 관리자가 Works에서 "브라우저 알림 켜기"를 누르면 브라우저가 만들어준 구독 정보
-- (endpoint + 암호화 키)를 여기 저장한다. 같은 관리자가 여러 기기/브라우저에서 켤 수 있어
-- endpoint 자체를 기본키로 쓴다(브라우저마다 고유한 값이라 중복 구독이 자연히 걸러짐).
create table if not exists push_subscriptions (
  endpoint text primary key,
  admin_id uuid not null references auth.users(id) on delete cascade,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.

create index if not exists push_subscriptions_admin_idx on push_subscriptions (admin_id);
