-- REITEN — Works 기능 사용 통계 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--
-- "지금 Works에서 무슨 탭·기능을 자주 쓰고 뭘 안 쓰는지 통계로 보고 싶다"는 요청(2026-09) —
-- 중장기로 자주 쓰는 기능은 위쪽에, 안 쓰는 기능은 눈에 덜 띄게 재배치할 근거 자료로 쓸 목적.
-- key는 자유 텍스트라 새 탭·기능이 추가돼도 마이그레이션 없이 그대로 기록된다(inventory_log의
-- reason과 같은 패턴) — "tab:orders"처럼 탭 조회는 tab:, 내보내기 같은 개별 기능은 feature:
-- 접두어로 구분한다(works/js 쪽 규칙, DB는 그냥 문자열로만 취급).

create table if not exists admin_usage_log (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_usage_log_key_idx on admin_usage_log (key);
create index if not exists admin_usage_log_created_at_idx on admin_usage_log (created_at);
