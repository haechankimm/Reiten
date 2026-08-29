-- REITEN — 시스템 오류 로그 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- 카드결제 이중실패(재고부족으로 결제취소 시도했는데 그 취소마저 실패)·환불 실패(주문취소·반품승인
-- 자동환불 실패)처럼 지금까지 관리자 이메일로만 가던 긴급 이벤트를, Works 알림센터에서도 바로 보이게
-- 하기 위한 로그. 관리자가 이메일을 놓쳐도 Works에 로그인만 하면 놓치지 않는다.
create table if not exists system_error_log (
  id uuid primary key default gen_random_uuid(),
  type text not null,            -- 예: "card_cancel_failed", "refund_failed"
  detail jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

alter table system_error_log enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.

create index if not exists system_error_log_resolved_idx on system_error_log (resolved, created_at desc);
