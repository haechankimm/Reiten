-- REITEN — 부분 환불·교환 재발송·배송추적·구매확정·비회원 문의 이메일·사진 리뷰 적립 마이그레이션 (2026-10-02)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요. (여러 번 실행해도 안전)
--
-- 이 파일을 아직 실행하지 않아도 사이트는 멈추지 않는다(다른 선택 기능과 같은 원칙) — 다만 아래 기능이 꺼지거나
-- 줄어든 채로 동작한다: 부분 환불 이력 저장(여러 번 나눠 환불), 교환 재발송 운송장 칸(대신 내부 메모에 남김),
-- 배송추적 자동 배송완료·자동 구매확정(적립금은 예전처럼 결제 확인 즉시 지급), 비회원 비밀 문의 답변 메일,
-- 사진 리뷰 적립금.

-- 1) 주문 — 누적 환불액(부분 환불 합계), 배송완료·구매확정 시각, 배송조회 마지막 확인 시각·상태
alter table orders add column if not exists refunded_amount int not null default 0;
alter table orders add column if not exists delivered_at timestamptz;
alter table orders add column if not exists confirmed_at timestamptz;
alter table orders add column if not exists tracking_checked_at timestamptz;
alter table orders add column if not exists tracking_status text;
create index if not exists orders_status_delivered_idx on orders (status, delivered_at);

-- 2) 환불 이력 — 부분 반품·출고 전 부분 취소 한 건마다 한 행(어떤 상품을 몇 개, 얼마, 배송비 차감, 적립금 처리).
--    order_no에 FK를 걸지 않는 이유는 inventory_log·payment_log와 같다(주문 삭제·정리와 무관하게 기록 보존).
create table if not exists order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_no text not null,
  kind text not null check (kind in ('return', 'partial_cancel')),
  return_request_id uuid,
  lines jsonb not null default '[]'::jsonb,
  goods_amount int not null default 0,
  shipping_refund int not null default 0,
  shipping_deduction int not null default 0,
  refund_amount int not null default 0,
  points_restored int not null default 0,
  points_reclaimed int not null default 0,
  method text,
  payment_cancelled boolean not null default false,
  restocked boolean not null default false,
  fault text,
  admin_email text,
  note text,
  created_at timestamptz not null default now()
);
alter table order_refunds enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.
create index if not exists order_refunds_order_no_idx on order_refunds (order_no);

-- 3) 반품 신청 — 교환 상품 재발송 운송장
alter table return_requests add column if not exists reship_courier text;
alter table return_requests add column if not exists reship_tracking_no text;
alter table return_requests add column if not exists reshipped_at timestamptz;

-- 4) 문의 — 비회원이 비밀 문의를 남길 때 답변 받을 이메일(공개 목록에는 절대 내려가지 않음)
alter table qna add column if not exists email text;

-- 5) 적립금 — 사진 리뷰 적립(earn_review)과, 같은 리뷰로 두 번 적립되지 않게 리뷰 id를 담는 ref 칸
alter table loyalty_points_ledger add column if not exists ref text;
alter table loyalty_points_ledger drop constraint if exists loyalty_points_ledger_reason_check;
alter table loyalty_points_ledger add constraint loyalty_points_ledger_reason_check
  check (reason in ('earn_purchase', 'redeem_order', 'admin_adjust', 'refund_reversal', 'earn_review'));
create unique index if not exists loyalty_points_ledger_review_ref_idx
  on loyalty_points_ledger (ref) where reason = 'earn_review' and ref is not null;
