-- REITEN — 상품 색상 팔레트(관리자 CRUD) 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- 지금까지 data.js에 6종으로 고정돼 있던 COLORS를 관리자 패널(Works)에서 자유롭게
-- 추가·수정·삭제할 수 있게 만드는 테이블. 서버(server/)가 떠 있으면 이 테이블이 소스가
-- 되어 data.js의 정적 COLORS를 대체한다. key는 기존 상품들의 products.colors 배열이
-- 이미 참조하고 있는 값이라 그대로 유지해야 한다(시드 참고).
create table if not exists product_colors (
  key text primary key,
  label text not null,
  label_de text,
  hex text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table product_colors enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.
-- 공개 목록은 /api/colors가 대신 서빙하고, 쓰기(생성·수정·삭제)는 관리자 인증을 거친
-- /api/admin/colors가 담당한다.

create index if not exists product_colors_sort_idx on product_colors (sort_order);

-- 기존 data.js의 6개 색상을 그대로 시드한다(최초 1회) — 이미 있으면 건너뛴다.
insert into product_colors (key, label, hex, sort_order)
values
  ('black',    '블랙',        '#16161a', 0),
  ('white',    '화이트',      '#f3f1e9', 1),
  ('pink',     '핑크',        '#dba3ac', 2),
  ('deepblue', '딥블루',      '#22334f', 3),
  ('sky',      '스카이 블루', '#9dbdd8', 4),
  ('clay',     '클레이',      '#b08574', 5)
on conflict (key) do nothing;
