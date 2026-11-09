-- REITEN — 상품 영어·일본어 이름·설명 (2026-10-28 정기 감사)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (여러 번 실행해도 안전)
--
-- 관리자가 Works에서 입력한 상품 설명(한 줄 소개·상세 설명·디테일 목록)은 한국어 하나뿐이라, 영어·일본어로 보는
-- 손님에게도 한국어로 나왔다. 상품마다 { "en": { name, short, desc, details[] }, "ja": {...} } 형태로 번역을 넣을 수
-- 있게 칸을 하나 추가한다. 비워 두면 예전처럼 한국어(또는 사전에 있는 번역)로 나온다.
-- 실행하지 않아도 사이트는 멈추지 않는다 — Works에서 번역을 저장할 때만 "번역은 저장되지 않음" 안내가 뜬다.
alter table products add column if not exists translations jsonb not null default '{}'::jsonb;

-- 관리자가 Works에서 새로 추가한 색상(product_colors)도 이름이 한국어(+독일어)뿐이라 영어·일본어 화면에서 한국어로
-- 나왔다(2026-10-29). 색상마다 영어·일본어 이름 칸을 추가한다 — 비워 두면 예전처럼 한국어 이름으로 나온다.
alter table product_colors add column if not exists label_en text;
alter table product_colors add column if not exists label_ja text;
