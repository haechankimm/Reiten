-- REITEN — 공급처 입고 취소(재고 되돌리기) 이력 사유 추가 (2026-11-11)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (여러 번 실행해도 안전)
--
-- Works 재고 탭에서 잘못 누른 "입고 처리"를 "입고 취소"로 되돌릴 수 있게 했다(그때 더한 재고를 다시 뺌).
-- 재고 변동 이력(inventory_log)의 사유 목록에 'supplier_receipt_undo'를 추가한다(050 목록 + 1).
-- 실행 전에도 입고 취소 자체는 되지만, 그 재고 변동이 "이력 보기"에 남지 않는다.
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
    'supplier_receipt', 'supplier_receipt_undo'
  ));

-- 운영 점검용 DB 버전 표시(2026-11-11) — 제약 변경처럼 조회로 확인할 수 없는 마이그레이션도 "지금 점검하기"가 알 수 있게.
-- 앞으로 마이그레이션마다 이 숫자만 올린다.
create or replace function reiten_schema_version() returns integer language sql stable as $$ select 51 $$;
revoke execute on function reiten_schema_version() from public, anon, authenticated;
