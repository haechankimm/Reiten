-- REITEN — 감사 쿠폰 마일스톤 중복 방지 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.

-- 첫 구매/재구매 감사 쿠폰은 "이 고객이 방금 그 기준(첫 구매, 5번째 구매 등)에 도달했는지"를
-- SELECT로 확인한 뒤 쿠폰을 발급했는데, 같은 고객의 주문 두 건이 거의 동시에 확정되면
-- (카드결제 웹훅과 프론트엔드 확인이 겹치는 경우, 관리자가 여러 건을 연달아 입금확인 처리하는
-- 경우 등) 둘 다 SELECT를 통과해버려 같은 마일스톤 쿠폰이 중복 발급될 수 있었다(2026-09-01
-- 코드 감사에서 발견). tel+milestone 조합에 유니크 제약을 걸어, 두 요청 중 하나만 INSERT에
-- 성공하고 나머지는 유니크 위반(23505)으로 조용히 포기하도록 만든다.
create table if not exists coupon_milestones (
  id uuid primary key default gen_random_uuid(),
  tel text not null,
  milestone text not null,   -- 예: "first_purchase", "repeat_5"
  created_at timestamptz not null default now(),
  unique (tel, milestone)
);

alter table coupon_milestones enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.
