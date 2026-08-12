-- REITEN — 관리자 참고정보(설정) 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- Works 관리자 패널의 "정보" 탭에서 관리자가 직접 채우는 참고용 메모.
-- 사업자 정보 요약, Supabase/Render/Resend/Cloudinary 같은 운영 사이트 링크 등을
-- README나 각 서비스 대시보드를 뒤지지 않고 관리자 패널 안에서 바로 확인하려는 용도.
-- 비밀번호·API 키 등 민감정보는 절대 여기 넣지 않는다(관리자 전원이 볼 수 있음).
create table if not exists admin_settings (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  value text not null default '',
  note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table admin_settings enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.

create index if not exists admin_settings_sort_idx on admin_settings (sort_order);
