-- REITEN — 결제 이탈 리마인드 메일 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--
-- 결제창까지 갔다가 결제를 끝내지 않은 고객(pending_payments에 남은 행)에게 한 번만 리마인드 메일을
-- 보내기 위해, 이미 보낸 행을 표시하는 컬럼. 이 컬럼이 없어도 사이트는 정상 동작하고 리마인드
-- 기능만 조용히 꺼진다.
alter table pending_payments add column if not exists reminder_sent_at timestamptz;
