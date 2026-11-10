-- REITEN — 비서 에이전트(피클) 업무 확장: 공급처 배송조회 출처·입고 품목·매입 장부·문의 답변 초안 (2026-11-10)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (여러 번 실행해도 안전) — 048·049를 먼저 실행할 것.
--
-- ① supplier_shipments: 입고 품목 초안(receipt_items, 피클이 메일에서 채움)·입고 처리 시각·배송조회 출처(pickle/sweettracker)
-- ② inventory_log 사유에 'supplier_receipt'(공급처 입고로 재고 증가) 추가 — 027의 목록 + 1
-- ③ supplier_invoices: 매입 장부(거래명세서·세금계산서·영수증). 피클이 메일에서 금액을 뽑아 '기록됨'으로 넣고 사람이 Works에서 '확인'
-- ④ qna.ai_draft: 피클이 만든 답변 초안(고객에게는 안 보임 — 관리자가 Works에서 고쳐서 직접 등록해야 나간다)
-- 실행 전에는 각 기능만 꺼진 채(Works에 안내) 나머지는 그대로 동작한다.

-- ① 공급처 송장
alter table supplier_shipments add column if not exists receipt_items jsonb;
alter table supplier_shipments add column if not exists received_at timestamptz;
alter table supplier_shipments add column if not exists tracking_source varchar(20);

-- ② 재고 변동 사유
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'inventory_log'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%reason%'
  loop
    execute format('alter table inventory_log drop constraint %I', con.conname);
  end loop;
end $$;

alter table inventory_log add constraint inventory_log_reason_check
  check (reason in (
    'order', 'auto_cancel', 'admin_cancel', 'return_restock', 'admin_adjust',
    'admin_uncancel', 'order_finalize_duplicate', 'order_finalize_failed',
    'supplier_receipt'
  ));

-- ③ 매입 장부
create table if not exists supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_name varchar(50) not null,
  supplier_label varchar(80),
  doc_type varchar(20) not null default 'statement',   -- statement(거래명세서)·tax_invoice(세금계산서)·receipt(영수증)·other
  doc_number varchar(100),                              -- 승인번호·명세서 번호(없으면 비움)
  issued_on date not null,
  supply_amount integer,                                -- 공급가액
  vat_amount integer,                                   -- 부가세
  total_amount integer not null,                        -- 합계(원)
  items_summary text,
  shipment_id uuid references supplier_shipments(id) on delete set null,
  status varchar(20) not null default 'RECORDED',      -- RECORDED(피클 기록)·CONFIRMED(사람 확인)·REJECTED(잘못 기록)
  source varchar(20) not null default 'pickle',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_invoices_status_check') then
    alter table supplier_invoices add constraint supplier_invoices_status_check check (status in ('RECORDED', 'CONFIRMED', 'REJECTED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_invoices_doc_type_check') then
    alter table supplier_invoices add constraint supplier_invoices_doc_type_check check (doc_type in ('statement', 'tax_invoice', 'receipt', 'other'));
  end if;
end $$;
-- 같은 공급처의 같은 문서 번호는 한 줄(번호가 없는 영수증은 여러 줄 허용)
create unique index if not exists uq_supplier_invoice_doc on supplier_invoices (supplier_name, doc_number) where doc_number is not null;
create index if not exists idx_supplier_invoices_issued on supplier_invoices (issued_on desc);
alter table supplier_invoices enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.

-- ④ 문의 답변 초안
alter table qna add column if not exists ai_draft text;
alter table qna add column if not exists ai_draft_at timestamptz;
