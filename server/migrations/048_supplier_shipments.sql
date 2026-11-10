-- REITEN — 공급처(프린트캔버스·나염·원단 도매 등) 출고 송장 기록 (2026-11-10)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (여러 번 실행해도 안전)
--
-- 비서 에이전트(피클)가 공급처 출고 메일에서 공급처명·주문번호·택배사·송장번호·품목을 뽑아
-- POST /api/bot/supplier-shipments(헤더 X-REITEN-BOT-KEY)로 보내면 이 표에 쌓이고, Works "재고" 탭
-- "공급처 입고·배송" 목록에 보인다. 고객 주문·환불과는 전혀 연결되지 않은 독립 표다.
-- 실행 전에는 봇 요청이 "마이그레이션 048 미실행"(503)으로 거절되고 Works 목록은 빈 칸으로 안내만 뜬다 — 다른 기능엔 영향 없음.
create table if not exists supplier_shipments (
  id uuid primary key default gen_random_uuid(),
  supplier_name varchar(50) not null,          -- 예: 'printcanvas', 'greennayeom'
  supplier_order_id varchar(100),              -- 예: '20261109-0000047'
  carrier_code varchar(50) not null,           -- 예: 'kr.cjlogistics', 'kr.epost', 'kr.hanjin'
  carrier_name varchar(50),                    -- 예: 'CJ대한통운'
  tracking_number varchar(100) not null,       -- 숫자·영문만(서버가 하이픈·공백 제거)
  items_summary text,                          -- 예: '오버핏 쭈리 후드(차콜) XL 1벌'
  recipient_name varchar(50),
  status varchar(30) not null default 'SHIPPED',
  shipped_at timestamptz,
  delivered_at timestamptz,
  metadata jsonb not null default '{}'::jsonb, -- 원본 메일 ID, 배송비 등
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_supplier_tracking unique (supplier_name, tracking_number)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_shipments_status_check') then
    alter table supplier_shipments add constraint supplier_shipments_status_check
      check (status in ('SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'RECEIVED', 'CANCELED'));
  end if;
end $$;

alter table supplier_shipments enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.

create index if not exists idx_supplier_shipments_status on supplier_shipments (status);
create index if not exists idx_supplier_shipments_created on supplier_shipments (created_at desc);
