-- REITEN — 컬러별 상품 사진·상세 콘텐츠, 모델 정보, 리뷰 요청 메일 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요. (여러 번 실행해도 안전)
--
-- products.media: 상품 사진·상세 콘텐츠 목록. 항목마다
--   { kind: "gallery"(상단 사진) | "detail"(상세 사진) | "video"(상세 영상) | "text"(상세 문구),
--     src(사진/영상 주소), text(문구), color(컬러 키, 비우면 공통) }
--   → 상품 페이지에서 고른 컬러의 항목 + 공통 항목만 보여준다. 비어 있으면 예전 images 4칸을 그대로 쓴다.
-- products.model_info: "모델 178cm · 70kg / L 착용" 같은 착용 정보(사이즈 선택 옆에 표시).
-- orders.shipped_at: "배송중"으로 바뀐 시각. orders.review_requested_at: 리뷰 요청 메일을 보낸 시각(중복 발송 방지).
-- 이 컬럼들이 아직 없어도 사이트는 정상 동작하고 해당 기능만 꺼진다.

alter table products add column if not exists media jsonb not null default '[]'::jsonb;
alter table products add column if not exists model_info text;
alter table orders add column if not exists shipped_at timestamptz;
alter table orders add column if not exists review_requested_at timestamptz;
create index if not exists orders_review_request_idx on orders (shipped_at) where review_requested_at is null;
