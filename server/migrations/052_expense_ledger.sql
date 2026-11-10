-- REITEN — 지출 장부·동업자 정산·정기 지출·예산·상품 원가 (2026-11-11)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (여러 번 실행해도 안전) — 050·051을 먼저 실행할 것.
--
-- 매입 장부(supplier_invoices)를 사업의 모든 지출(원자재·택배·광고·서버비·수수료 등)을 담는 "지출 장부"로 넓힌다.
-- 표 이름은 그대로 두고 칸만 더한다(실시간 에이전트 AI 기록·사람 확인·월간 정산 엑셀 연동이 그대로 이어진다).
-- 실행 전에는 Works "지출·정산" 화면이 안내만 띄우고, 기존 매입 기록은 그대로 남는다.

-- ① 지출 칸
alter table supplier_invoices add column if not exists category varchar(30) not null default 'purchase';     -- 분류(계정과목에 가까운 업계 통상 분류)
alter table supplier_invoices add column if not exists payment_method varchar(20);                           -- biz_check·biz_credit·personal_card·transfer·cash·auto_debit
alter table supplier_invoices add column if not exists card_last4 varchar(4);                                -- 카드 뒤 4자리만(전체 번호는 저장하지 않음)
alter table supplier_invoices add column if not exists funded_by varchar(40) not null default 'business';    -- 'business'(사업자 돈) 또는 동업자 id(개인 돈으로 냄 → 정산 대상)
alter table supplier_invoices add column if not exists evidence_type varchar(20);                            -- tax_invoice·card·cash_receipt·simple_receipt·none
alter table supplier_invoices add column if not exists memo text;
alter table supplier_invoices add column if not exists shared boolean not null default true;                 -- 동업자가 나눠 부담하는 사업 지출인지
alter table supplier_invoices add column if not exists settlement_id uuid;                                   -- 정산에 포함되면 그 정산 id
alter table supplier_invoices add column if not exists recurring_id uuid;                                    -- 정기 지출에서 자동으로 만든 줄
alter table supplier_invoices add column if not exists recurring_month varchar(7);                           -- 'YYYY-MM'
alter table supplier_invoices add column if not exists import_hash varchar(64);                              -- CSV 가져오기 중복 방지
alter table supplier_invoices add column if not exists product_id text;                                      -- 특정 상품 원가에 들어가는 지출이면(선택)
create unique index if not exists uq_expense_recurring_month on supplier_invoices (recurring_id, recurring_month) where recurring_id is not null;
create unique index if not exists uq_expense_import_hash on supplier_invoices (import_hash) where import_hash is not null;
create index if not exists idx_expense_settlement on supplier_invoices (settlement_id);

-- ② 동업자(지출을 나눠 부담하는 사람) — 기본 비율 50:50
create table if not exists expense_partners (
  id varchar(40) primary key,              -- 짧은 id(예: 'haechan', 'partner')
  name varchar(50) not null,
  email varchar(120),                      -- Works 로그인 이메일(내가 낸 지출 기본값용, 선택)
  share_percent numeric(5,2) not null default 50,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table expense_partners enable row level security;
-- 처음 두 사람(50:50). 이름·이메일은 Works "지출·정산 → 동업자 설정"에서 바꾼다.
insert into expense_partners (id, name, share_percent) values ('ceo', '대표', 50), ('partner', '동업자', 50) on conflict (id) do nothing;

-- ③ 동업자 정산 기록 — 이 정산에 포함된 지출에 settlement_id가 붙는다. 정산 취소 시 그 표시만 지운다.
create table if not exists expense_settlements (
  id uuid primary key default gen_random_uuid(),
  period_from date,
  period_to date,
  total_amount integer not null default 0,     -- 정산 대상(동업자 개인 돈으로 낸 공동 지출) 합계
  balances jsonb not null default '[]'::jsonb, -- [{partnerId, paid, share, balance}]
  transfers jsonb not null default '[]'::jsonb,-- [{from, to, amount}] 누가 누구에게 얼마
  memo text,
  created_by varchar(120),
  created_at timestamptz not null default now(),
  canceled_at timestamptz,
  canceled_by varchar(120)
);
alter table expense_settlements enable row level security;

-- ④ 정기 지출(서버비·도메인·구독료 등) — 매달 지정한 날에 "확인 대기"로 자동 기록
create table if not exists expense_recurring (
  id uuid primary key default gen_random_uuid(),
  name varchar(80) not null,                   -- 예: 'Render 서버', '도메인'
  supplier_name varchar(50) not null,
  category varchar(30) not null default 'software',
  amount integer not null,
  day_of_month integer not null default 1 check (day_of_month between 1 and 28),
  payment_method varchar(20),
  card_last4 varchar(4),
  funded_by varchar(40) not null default 'business',
  evidence_type varchar(20),
  active boolean not null default true,
  last_month varchar(7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table expense_recurring enable row level security;

-- ⑤ 분류별 월 예산 — 넘기 전(80%)에 Works·AI 브리핑에 알림
create table if not exists expense_budgets (
  category varchar(30) primary key,
  monthly_amount integer not null check (monthly_amount >= 0),
  updated_at timestamptz not null default now()
);
alter table expense_budgets enable row level security;

-- ⑥ 상품 원가(1벌당) — 상품별 마진 계산용
alter table products add column if not exists unit_cost integer;

-- 운영 점검용 DB 버전
create or replace function reiten_schema_version() returns integer language sql stable as $$ select 52 $$;
revoke execute on function reiten_schema_version() from public, anon, authenticated;
