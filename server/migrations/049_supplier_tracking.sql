-- REITEN — 공급처 송장 배송조회 + 배송조회 API 월간 사용량 (2026-11-10)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (여러 번 실행해도 안전) — 048을 먼저 실행할 것.
--
-- ① supplier_shipments에 배송조회 결과 칸 추가: 공급처 표시 이름(supplier_label), 마지막 조회 시각·상태·단계 기록·오류.
--    스마트택배 키(SWEETTRACKER_API_KEY)가 있으면 매시 크론과 Works "배송조회" 버튼이 이 칸을 채운다.
-- ② api_usage_monthly: 스마트택배 무료 플랜은 한 달 100건이라, 고객 주문·공급처 송장 조회를 합쳐 이번 달 몇 건 썼는지 센다
--    (한도는 Render SWEETTRACKER_MONTHLY_LIMIT, 기본 100). 이 표가 없으면 서버 메모리로 세서 재시작 때 0으로 돌아간다.
-- 실행 안 해도 다른 기능은 그대로 — 공급처 배송조회 결과만 저장되지 않는다.
alter table supplier_shipments add column if not exists supplier_label varchar(80);
alter table supplier_shipments add column if not exists tracking_checked_at timestamptz;
alter table supplier_shipments add column if not exists tracking_status varchar(60);
alter table supplier_shipments add column if not exists tracking_events jsonb;
alter table supplier_shipments add column if not exists tracking_error text;
create index if not exists idx_supplier_shipments_supplier on supplier_shipments (supplier_name);

create table if not exists api_usage_monthly (
  key text primary key,                 -- 'sweettracker:2026-11'
  provider text not null,
  month text not null,                  -- KST 기준 'YYYY-MM'
  calls integer not null default 0,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table api_usage_monthly enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.
