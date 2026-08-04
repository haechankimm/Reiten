-- REITEN — 리뷰 승인제 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- 이미 등록된 리뷰는 그대로 노출되도록 true로 채워 넣고(백필),
-- 앞으로 등록되는 새 리뷰는 서버(server.js)가 항상 approved=false로 저장해 관리자 승인 전까지 숨긴다.
alter table reviews add column if not exists approved boolean not null default true;

create index if not exists reviews_approved_idx on reviews (approved);
