-- REITEN — 실시간 에이전트 AI 승인함(AI가 제안 → 사람이 승인 → 서버가 그 작업만 실행) + AI 권한 설정 (2026-11-11)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (여러 번 실행해도 안전) — 053을 먼저 실행할 것.
--
-- AI(피클)는 Works에 로그인하지 않는다. 운송장 입력·입금 확인 같은 작업을 "제안"만 하고, 사람이 Works "AI 승인함"에서
-- 승인하면 서버가 승인한 사람의 권한으로 그 작업 하나만 실행한다(활동 로그에 "AI 제안 #번호, 승인: 누구"로 남음).
-- 실행 전에는 AI의 제안 통로가 503으로 막히고 Works 승인함은 안내만 띄운다.

create table if not exists agent_actions (
  id bigserial primary key,
  action_type varchar(40) not null,          -- tracking_input·deposit_confirm·supplier_receive·qna_answer·expense_confirm·product_active·inventory_adjust·review_approve
  params jsonb not null default '{}'::jsonb,  -- 실행에 쓸 값(서버가 검증·정리한 것)
  target varchar(120),                        -- 사람이 알아보는 대상(주문번호·상품 등)
  reason text,                                -- AI가 적은 근거(예: "국민은행 입금 알림 89,000원 일치")
  preview jsonb not null default '{}'::jsonb, -- 바뀌기 전 → 후
  status varchar(20) not null default 'PENDING',
  dedupe_key varchar(200),                    -- 같은 대상에 대한 같은 작업이 대기 중이면 새로 만들지 않음
  source varchar(20) not null default 'pickle',
  auto_approved boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  decided_by varchar(120),
  decided_at timestamptz,
  decision_note text,
  executed_at timestamptz,
  result jsonb,
  error text,
  undone_at timestamptz,
  undone_by varchar(120)
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_actions_status_check') then
    alter table agent_actions add constraint agent_actions_status_check
      check (status in ('PENDING', 'EXECUTED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELED', 'UNDONE'));
  end if;
end $$;
create unique index if not exists uq_agent_actions_pending on agent_actions (dedupe_key) where status = 'PENDING' and dedupe_key is not null;
create index if not exists idx_agent_actions_status on agent_actions (status, created_at desc);
alter table agent_actions enable row level security;

-- AI 권한 설정(한 줄) — 전체 켜기/끄기, 작업별 허용·자동 승인 조건. 메인 관리자만 바꾼다.
create table if not exists agent_policy (
  id integer primary key default 1 check (id = 1),
  policy jsonb not null default '{}'::jsonb,
  updated_by varchar(120),
  updated_at timestamptz not null default now()
);
alter table agent_policy enable row level security;

create or replace function reiten_schema_version() returns integer language sql stable as $$ select 54 $$;
revoke execute on function reiten_schema_version() from public, anon, authenticated;
