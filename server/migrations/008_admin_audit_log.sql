-- REITEN — 관리자 감사 로그 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- 관리자가 2명 이상이 되는 시점부터 "누가 언제 무엇을 바꿨는지" 추적하기 위한 로그.
-- 서버(server/)가 관리자 API 응답을 저장할 때마다 한 줄씩 남긴다(service role key로만 접근).
create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,
  admin_email text not null,
  action text not null,          -- 예: "order.status", "product.create", "product.delete"
  target_type text not null,     -- 예: "order", "product", "lookbook", "return", "review", "qna", "setting", "inventory"
  target_id text not null,
  detail jsonb,
  at timestamptz not null default now()
);

alter table admin_audit_log enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.

create index if not exists admin_audit_log_at_idx on admin_audit_log (at desc);
