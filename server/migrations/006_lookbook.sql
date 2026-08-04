-- REITEN — 룩북 관리(관리자 CRUD) 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- 룩북 슬롯. 서버(server/)가 떠 있으면 이 테이블이 소스가 되어
-- data.js의 정적 LOOKBOOK 배열을 대체한다(관리자 패널에서 추가·수정·삭제·사진 업로드 가능).
-- server/ 없이 정적 배포만 할 때는 이 테이블과 무관하게 data.js의 LOOKBOOK이 그대로 쓰인다.
create table if not exists lookbook (
  id uuid primary key default gen_random_uuid(),
  span text not null default 'w6',
  ratio text not null default '4/5',
  label text not null,
  note text,
  src text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table lookbook enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.
-- 공개 목록은 /api/lookbook이 대신 서빙하고, 쓰기(생성·수정·삭제)는 관리자 인증을 거친 /api/admin/lookbook이 담당한다.

create index if not exists lookbook_active_idx on lookbook (active);

-- 기존 data.js의 룩북 8칸을 그대로 시드한다(테이블이 비어 있을 때만 — 재실행해도 중복 삽입되지 않음).
insert into lookbook (span, ratio, label, note, sort_order)
select * from (values
  ('w8',  '16/10', '01 — Night Ride / 남산',     '헤드라이트 반사 컷', 0),
  ('w4',  '3/4',   '02 — Detail / 지퍼 참',       '클로즈업', 1),
  ('w4',  '3/4',   '03 — Back Print',             '주간 / 야간 대비', 2),
  ('w4',  '3/4',   '04 — Crop Hoodie',            '라이딩 자세', 3),
  ('w4',  '3/4',   '05 — Zip Hoodie / 6 Colors',  '컬러 랩업', 4),
  ('w12', '21/9',  '06 — Film Still',             '라이딩 필름 캡처', 5),
  ('w6',  '4/5',   '07 — Duo',                    '남녀 스타일링', 6),
  ('w6',  '4/5',   '08 — Garage',                 '정비 컷', 7)
) as v(span, ratio, label, note, sort_order)
where not exists (select 1 from lookbook);
