-- REITEN — 상품 사진마다 컬러 태그를 붙일 수 있게 하는 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.

-- images(사진 최대 4장)와 같은 길이·순서로 짝을 맞추는 배열. 각 칸은 컬러 키(예: "black")나
-- null(컬러 무관 공통 사진)이다. 상품 상세 페이지에서 컬러를 클릭했을 때 그 컬러가 태그된
-- 사진으로 바꿔 보여주는 데 쓴다(태그가 없으면 기존처럼 아무것도 안 바뀜 — 하위호환).
alter table products add column if not exists image_colors jsonb not null default '[]';
