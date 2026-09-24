-- REITEN — 관리자 PIN(2단계 인증) + 직원별 권한 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--
-- admin_pins: 관리자마다 6자리 PIN 하나(로그인 비밀번호 다음 2단계). 원문이 아니라 scrypt 해시만 저장.
--             fail_count/locked_until은 PIN 무차별 대입 방지(5회 실패 시 15분 잠금).
-- admin_permissions: 직원(마스터 아님)별로 Works 영역마다 none/view/edit를 저장. 행이 없으면
--             기존처럼 전체 허용(기존 관리자가 갑자기 막히지 않게). 마스터 관리자는 이 표와 무관하게 항상 전체.
-- 둘 다 이 테이블이 아직 없어도 서버는 죽지 않고 기존 방식으로 동작한다(PIN 요구·권한 제한만 꺼짐).

create table if not exists admin_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  salt text not null,
  fail_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table admin_pins enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.

create table if not exists admin_permissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  permissions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table admin_permissions enable row level security;
