-- REITEN — 상품 관리(관리자 CRUD) 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- 상품 카탈로그. 서버(server/)가 떠 있으면 이 테이블이 소스가 되어
-- data.js의 정적 PRODUCTS 배열을 대체한다(관리자 패널에서 추가·수정·삭제 가능).
-- server/ 없이 정적 배포만 할 때는 이 테이블과 무관하게 data.js의 PRODUCTS가 그대로 쓰인다.
create table if not exists products (
  id text primary key,
  name text not null,
  name_ko text not null,
  type text not null,
  category text not null,
  price int not null,
  badge text,
  images jsonb not null default '[]',
  colors jsonb not null default '[]',
  sizes jsonb not null default '[]',
  sold_out jsonb not null default '[]',
  size_table text,
  short text,
  description text,
  details jsonb not null default '[]',
  charm_ready boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table products enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.
-- 공개 목록은 /api/products가 대신 서빙하고, 쓰기(생성·수정·삭제)는 관리자 인증을 거친 /api/admin/products가 담당한다.

create index if not exists products_active_idx on products (active);

-- 기존 data.js의 8개 상품을 그대로 시드한다(최초 1회) — 이미 있으면 건너뛴다.
insert into products (id, name, name_ko, type, category, price, badge, images, colors, sizes, sold_out, size_table, short, description, details, charm_ready, sort_order)
values
  ('reflect-heart-hoodie', 'Reflect Heart Hoodie', '리플렉트 하트 후디', 'hoodie', '후드티', 89000, 'Reflective',
   '[null,null,null,null]',
   '["black","white","pink","deepblue","sky","clay"]', '["XS","S","M","L","XL"]', '["XS"]', 'hoodie',
   '트라이벌 하트 스카치 전사 · 백 프린트',
   '등판 전체에 스카치라이트 리플렉티브 전사를 올린 헤비 후디입니다. 낮에는 무광 실버 그래픽으로 보이고, 야간 주행 중 헤드라이트를 받으면 그래픽 전체가 발광합니다.',
   '["겉감 : 코튼 80% / 폴리에스터 20% · 480g 헤비 기모","프린팅 : 3M 스카치라이트 계열 리플렉티브 전사","핏 : 남녀공용 오버핏 (드롭숄더)","부자재 : 두께감 있는 3겹 후드, 립 조직 밑단"]',
   false, 0),
  ('reflect-exhaust-hoodie', 'Reflect Exhaust Hoodie', '리플렉트 이그저스트 후디', 'hoodie', '후드티', 89000, 'Reflective',
   '[null,null,null,null]',
   '["black","white","pink","deepblue","sky","clay"]', '["XS","S","M","L","XL"]', '["XS","S"]', 'hoodie',
   '머플러 & 플레임 스카치 전사 · 백 프린트',
   '배기 머플러와 화염을 라인 드로잉으로 옮긴 백 그래픽. 라인이 가늘수록 반사 대비가 강해져서, 어두울수록 그림이 또렷해집니다.',
   '["겉감 : 코튼 80% / 폴리에스터 20% · 480g 헤비 기모","프린팅 : 3M 스카치라이트 계열 리플렉티브 전사","핏 : 남녀공용 오버핏 (드롭숄더)","부자재 : 두께감 있는 3겹 후드, 립 조직 밑단"]',
   false, 1),
  ('helmet-zip-hoodie', 'Helmet Zip Hoodie', '헬멧 집업 후디', 'zip', '후드집업', 129000, 'Washed',
   '[null,null,null,null]',
   '["black","white","pink","deepblue","sky","clay"]', '["XS","S","M","L","XL"]', '["XS"]', 'hoodie',
   '가먼트 워싱 · 프론트 드로잉 그래픽',
   '완성 후 워싱을 먹여 색이 한 톤 빠진 집업입니다. 가슴의 헬멧 드로잉과 소매 로고는 리플렉티브 전사로, 정면에서 빛을 받으면 그래픽만 떠오릅니다.',
   '["겉감 : 코튼 100% · 420g 가먼트 워싱","프린팅 : 리플렉티브 전사 (프론트 · 소매)","핏 : 남녀공용 오버핏 (드롭숄더)","부자재 : YKK 양방향 지퍼 · 참(charm) 탈부착 가능"]',
   true, 2),
  ('core-zip-hoodie', 'Core Zip Hoodie', '코어 집업 후디', 'zip', '후드집업', 119000, 'Customizable',
   '[null,null,null,null]',
   '["black","white","pink","deepblue","sky","clay"]', '["XS","S","M","L","XL"]', '["XS"]', 'hoodie',
   '6컬러 · 지퍼 참 커스텀 가능',
   '브랜드의 기본이 되는 집업입니다. 그래픽 없이 소매의 리플렉티브 스크립트 로고만 남겼습니다. 지퍼 슬라이더에 원하는 참(charm)을 달아 조합을 완성하세요.',
   '["겉감 : 코튼 100% · 420g","프린팅 : 소매 리플렉티브 스크립트 로고","핏 : 남녀공용 오버핏 (드롭숄더)","부자재 : YKK 양방향 지퍼 · 참(charm) 탈부착 가능"]',
   true, 3),
  ('reflect-crop-hoodie', 'Reflect Crop Zip Hoodie', '리플렉트 크롭 집업 후디', 'crop', '크롭 후드티', 89000, 'Customizable',
   '[null,null,null,null]',
   '["black","white","pink","deepblue","sky","clay"]', '["XS","S","M","L","XL"]', '["XS","XL"]', 'crop',
   '숏 기장 지퍼 집업 · 지퍼 참 커스텀 가능',
   '탱크에 엎드린 자세에서 밑단이 말려 올라가지 않도록 앞뒤 기장 차를 둔 크롭 집업입니다. 지퍼 슬라이더에 참(charm)을 달 수 있고, 소매에는 리플렉티브 스크립트 로고가 들어갑니다.',
   '["겉감 : 코튼 80% / 폴리에스터 20% · 400g","프린팅 : 소매 리플렉티브 스크립트 로고","핏 : 여유 있는 크롭 (남녀공용)","부자재 : YKK 양방향 지퍼 · 립 조직 밑단 · 참(charm) 탈부착 가능"]',
   true, 4),
  ('reflect-reiten-hoodie', 'Reflect Reiten Hoodie', '리플렉트 레이튼 후디', 'hoodie', '후드티', 89000, 'Coming',
   '[null,null,null,null]',
   '["black","white","pink","deepblue","sky","clay"]', '["XS","S","M","L","XL"]', '["XS"]', 'hoodie',
   'Reiten 워드마크 스카치 전사 · 백 프린트',
   '등판 전체에 브랜드 워드마크 ''Reiten''을 스카치라이트 리플렉티브 전사로 크게 올린 헤비 후디입니다. 낮에는 무광 실버 레터링으로 보이고, 야간 주행 중 헤드라이트를 받으면 글자 전체가 발광합니다.',
   '["겉감 : 코튼 80% / 폴리에스터 20% · 480g 헤비 기모","프린팅 : 3M 스카치라이트 계열 리플렉티브 전사","핏 : 남녀공용 오버핏 (드롭숄더)","부자재 : 두께감 있는 3겹 후드, 립 조직 밑단"]',
   false, 5),
  ('reflect-star-hoodie', 'Reflect Star Hoodie', '리플렉트 스타 후디', 'hoodie', '후드티', 89000, 'Coming',
   '[null,null,null,null]',
   '["black","white","pink","deepblue","sky","clay"]', '["XS","S","M","L","XL"]', '["XS"]', 'hoodie',
   '트라이벌 스타 스카치 전사 · 백 프린트',
   '별 모양을 트라이벌 라인으로 옮긴 백 그래픽입니다. 하트 후디와 같은 라인 굵기로 디자인해 시리즈로 매치하기 좋습니다. 어두울수록 라인이 또렷하게 발광합니다.',
   '["겉감 : 코튼 80% / 폴리에스터 20% · 480g 헤비 기모","프린팅 : 3M 스카치라이트 계열 리플렉티브 전사","핏 : 남녀공용 오버핏 (드롭숄더)","부자재 : 두께감 있는 3겹 후드, 립 조직 밑단"]',
   false, 6),
  ('reflect-flame-hand-hoodie', 'Reflect Flame Hand Hoodie', '리플렉트 플레임 핸드 후디', 'hoodie', '후드티', 89000, 'Coming',
   '[null,null,null,null]',
   '["black","white","pink","deepblue","sky","clay"]', '["XS","S","M","L","XL"]', '["XS"]', 'hoodie',
   '머플러를 쥔 손 · 플레임 스카치 전사 백 프린트',
   '이그저스트 후디의 화염 머플러 그래픽에 그것을 움켜쥔 손을 더한 버전입니다. 라인이 가늘수록 반사 대비가 강해져서, 어두울수록 그림이 또렷해집니다.',
   '["겉감 : 코튼 80% / 폴리에스터 20% · 480g 헤비 기모","프린팅 : 3M 스카치라이트 계열 리플렉티브 전사","핏 : 남녀공용 오버핏 (드롭숄더)","부자재 : 두께감 있는 3겹 후드, 립 조직 밑단"]',
   false, 7)
on conflict (id) do nothing;
