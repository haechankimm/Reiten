-- REITEN — 쿠폰 사용 횟수(usage_limit) 원자적 차감 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--
-- 문제: lib/coupons.js의 resolveCoupon()은 지금까지 "SELECT count(*) FROM orders WHERE
-- coupon_code = ?"로 사용 횟수를 세고 나서 usage_limit과 비교했다. 이 확인과 실제 주문 INSERT
-- 사이에 원자적 잠금이 없어서, 마지막 1장을 두 주문이 거의 동시에 확정하면(선착순 쿠폰 이벤트처럼
-- 트래픽이 몰릴 때) 카운트를 둘 다 통과해버려 usage_limit을 실제로 넘길 수 있었다(028_coupon_
-- milestones.sql로 감사쿠폰 중복 발급은 이미 막았지만, 일반 쿠폰의 발급 수량 제한은 그대로였음).
--
-- 해결: coupons.used_count를 두고, "주문이 실제로 확정되는 시점"(무통장입금은 /api/order,
-- 카드결제는 finalizeCardOrder)에 UPDATE ... WHERE used_count < usage_limit RETURNING으로
-- 한 문장 안에서 확인+증가를 원자적으로 처리한다(Postgres는 단일 UPDATE 문 자체가 행 잠금으로
-- 보호되므로 두 트랜잭션이 동시에 실행돼도 하나만 성공한다).

alter table coupons add column if not exists used_count int not null default 0;

-- 기존에 이미 쌓인 주문 기준으로 초기값을 채운다(이후로는 claim_coupon_usage()만 이 값을 바꾼다).
-- resolveCoupon()의 기존 사용 횟수 집계와 같은 기준(주문 상태와 무관하게 그 코드로 주문이
-- 한 번이라도 만들어졌으면 사용된 것으로 침) — 마이그레이션 실행 시점에 한 번만 백필한다.
update coupons c set used_count = (
  select count(*) from orders o where o.coupon_code = c.code
);

create or replace function claim_coupon_usage(p_code text)
returns table(claimed boolean) as $$
declare
  v_count int;
begin
  update coupons
    set used_count = used_count + 1
    where code = p_code and (usage_limit is null or used_count < usage_limit);
  get diagnostics v_count = row_count;
  return query select v_count > 0;
end;
$$ language plpgsql;

-- 카드결제 웹훅과 프론트엔드 확인 요청이 거의 동시에 도착해 finalizeCardOrder가 두 번 실행되면
-- (server.js 주석의 "경쟁 상태" 참고, payment_id 유니크 제약으로 나중 요청만 여기로 옴) 재고는
-- restore_inventory로 이미 되돌리고 있었는데 쿠폰 사용 횟수는 되돌리는 코드가 없었다 — 그대로
-- 두면 실제로는 한 번만 쓰인 쿠폰이 두 번 차감된 것처럼 남는다. 재고 복원과 같은 지점에서 같이 부른다.
create or replace function release_coupon_usage(p_code text)
returns void as $$
begin
  update coupons set used_count = greatest(0, used_count - 1) where code = p_code;
end;
$$ language plpgsql;
