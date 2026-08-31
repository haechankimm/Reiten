-- REITEN — CS 빠른 답변 템플릿 키워드 자동매칭 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (023_qna_templates.sql을 먼저 실행한 상태여야 합니다.)

-- 문의 본문에 이 키워드 중 하나라도 포함되면 QnA 답변창에서 이 템플릿을 기본 선택해준다
-- (관리자가 매번 드롭다운에서 고르지 않아도 되게). 완전 자동응답은 아니고 기본값만 채워주는
-- 용도라 관리자가 언제든 다른 템플릿으로 바꾸거나 직접 수정할 수 있다.
alter table qna_templates add column if not exists keywords text[] not null default '{}';
