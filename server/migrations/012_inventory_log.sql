-- REITEN — 재고 변동 이력 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.

-- inventory 테이블은 현재 수량(qty)만 갖고 있어서, 재고가 왜 바뀌었는지(주문 차감인지,
-- 자동취소·반품으로 복원된 건지, 관리자가 손으로 고친 건지) 추적할 방법이 없었다.
-- 모든 재고 변동을 여기에 한 줄씩 남긴다(감소는 음수, 증가는 양수).
create table if not exists inventory_log (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  size text not null,
  delta int not null,
  reason text not null check (reason in ('order', 'auto_cancel', 'admin_cancel', 'return_restock', 'admin_adjust')),
  ref text,              -- 관련 주문번호 등(있으면)
  admin_email text,      -- 관리자가 직접 수정한 경우만 채움
  created_at timestamptz not null default now()
);

alter table inventory_log enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.

create index if not exists inventory_log_product_size_idx on inventory_log (product_id, size, created_at desc);
