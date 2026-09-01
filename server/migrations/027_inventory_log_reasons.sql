-- REITEN — 재고 변동 이력 사유 확장 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.

-- 012_inventory_log.sql의 reason CHECK 제약이 처음 5종(order/auto_cancel/admin_cancel/
-- return_restock/admin_adjust)만 허용하도록 만들어졌는데, 그 이후 코드에는
-- admin_uncancel(관리자 취소 되돌림 재차감)·order_finalize_duplicate(카드결제 중복 저장
-- 정리)·order_finalize_failed(주문 확정 실패 후 재고 복원) 3종이 추가로 쓰이고 있었다.
-- CHECK 제약에 없는 값이라 이 사유로 남기려던 INSERT가 전부 조용히 실패하고 있었음
-- (logInventoryChange가 결과를 기다리지 않는 fire-and-forget이라 에러가 서버 콘솔에만
-- 찍히고 아무도 눈치채지 못함 — 2026-09-01 코드 감사에서 실제 inventory_log 데이터를
-- 확인해 이 3종이 단 한 번도 기록된 적 없다는 것까지 확인함).

-- 기존 reason CHECK 제약을 이름과 무관하게 찾아서 제거한다(inline으로 선언돼 자동 생성된
-- 이름이라 정확한 이름을 가정하지 않고 안전하게 처리).
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
    'admin_uncancel', 'order_finalize_duplicate', 'order_finalize_failed'
  ));
