-- REITEN — 카드결제(포트원 V2) 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- 주문에 결제수단·포트원 결제 건 아이디를 남긴다. 기존 무통장입금 주문은 전부 'bank_transfer'로 채워진다.
alter table orders add column if not exists payment_method text not null default 'bank_transfer';
alter table orders add column if not exists payment_id text;

create unique index if not exists orders_payment_id_idx on orders (payment_id) where payment_id is not null;

-- 결제창을 열기 전, 서버가 재계산한 금액을 잠깐 저장해두는 곳.
-- "결제 요청 전 사전검증"용 — 클라이언트가 결제창에 보내는 금액과 결제 완료 후 검증할 금액을
-- 둘 다 이 테이블의 값(서버가 계산한 값)으로 고정해서, 브라우저에서 금액을 조작해도 통하지 않게 한다.
-- 결제가 완료되면(POST /api/order) 이 행은 지워진다 — 오래 남아있는 행은 결제가 중단된 시도들이다.
create table if not exists pending_payments (
  payment_id text primary key,
  customer jsonb not null,
  raw_items jsonb not null,   -- 재고 차감에 필요한 원본 장바구니 항목(productId/size 등)
  items jsonb not null,        -- 서버가 재계산한 표시용 항목(name/options/qty/unit/sum)
  subtotal int not null,
  shipping int not null,
  total int not null,
  created_at timestamptz not null default now()
);

alter table pending_payments enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.

-- 결제창을 열어놓고 이탈한 시도들이 계속 쌓이지 않도록, 오래된(24시간 지난) 행은 새 요청이 들어올 때마다
-- server.js가 정리한다(별도 크론 없이 간단하게 처리 — 트래픽이 적은 초기 단계에는 이 정도로 충분).
