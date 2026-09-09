-- REITEN — 적립금(포인트) 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--
-- 잔액을 별도 컬럼으로 두지 않고 거래 내역(ledger)만 쌓아서 SUM으로 계산한다 — inventory_log·
-- payment_log와 같은 원칙("현재 값 하나"보다 "무슨 일이 있었는지 이력"을 남기면 잔액이 실제
-- 값과 어긋나는 사고를 원천적으로 막고, 나중에 "왜 이 잔액이 됐는지"도 그대로 추적된다).
-- 비회원 주문은 적립금을 받을 계정 자체가 없으므로 회원(user_id NOT NULL)에게만 적용된다.

-- order_no는 일부러 orders에 FK를 걸지 않는다(inventory_log.ref·payment_log.order_no와 같은
-- 이유) — 포인트 사용(redeem_points)은 재고 차감·쿠폰 소진과 같은 자리에서, 즉 주문 행이 아직
-- INSERT되기 전에 먼저 확정되므로 그 시점엔 order_no가 orders 테이블에 아직 존재하지 않는다.
create table if not exists loyalty_points_ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users(id),
  order_no text,
  delta int not null,
  reason text not null check (reason in ('earn_purchase', 'redeem_order', 'admin_adjust', 'refund_reversal')),
  created_at timestamptz not null default now()
);

alter table loyalty_points_ledger enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.

create index if not exists loyalty_points_ledger_user_idx on loyalty_points_ledger (user_id);

-- 카드결제 웹훅 재전송, 관리자가 같은 버튼을 두 번 누르는 실수 등으로 한 주문에 같은 종류의
-- 적립/사용이 중복 기록되지 않게 한다(관리자 수동 조정·환불 반환은 여러 번 있을 수 있어 제외).
create unique index if not exists loyalty_points_ledger_order_reason_idx
  on loyalty_points_ledger (order_no, reason)
  where order_no is not null and reason in ('earn_purchase', 'redeem_order');

alter table orders add column if not exists points_earned int not null default 0;
alter table orders add column if not exists points_used int not null default 0;
alter table pending_payments add column if not exists points_used int not null default 0;

-- 사용(차감) — 마지막 남은 포인트를 두 주문이 동시에 쓰면 잔액이 마이너스로 내려갈 수 있는
-- 경쟁 상태를 막는다(032_coupon_usage_lock.sql과 같은 문제, 같은 이유로 pg_advisory_xact_lock
-- 사용 — 잔액이 SUM으로 계산돼 usage_limit처럼 단일 UPDATE로 원자화할 "행"이 없기 때문).
create or replace function redeem_points(p_user_id uuid, p_amount int, p_order_no text)
returns table(ok boolean, balance int) as $$
declare
  v_balance int;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));
  select coalesce(sum(delta), 0) into v_balance from loyalty_points_ledger where user_id = p_user_id;
  if p_amount <= 0 then
    return query select true, v_balance;
    return;
  end if;
  if v_balance < p_amount then
    return query select false, v_balance;
    return;
  end if;
  insert into loyalty_points_ledger (user_id, order_no, delta, reason)
    values (p_user_id, p_order_no, -p_amount, 'redeem_order')
    on conflict (order_no, reason) where order_no is not null and reason in ('earn_purchase', 'redeem_order') do nothing;
  return query select true, (v_balance - p_amount);
end;
$$ language plpgsql;

-- 적립 — 사용과 달리 잔액을 깎는 게 아니라 늘리기만 하므로 잠금 없이도 안전하다(동시에
-- 여러 건이 적립돼도 각자 더해질 뿐 서로 방해하지 않음). 중복 방지는 위 유니크 인덱스가 맡는다.
create or replace function award_points(p_user_id uuid, p_amount int, p_order_no text, p_reason text)
returns void as $$
begin
  if p_amount <= 0 then return; end if;
  insert into loyalty_points_ledger (user_id, order_no, delta, reason)
    values (p_user_id, p_order_no, p_amount, p_reason)
    on conflict (order_no, reason) where order_no is not null and reason in ('earn_purchase', 'redeem_order') do nothing;
end;
$$ language plpgsql;

-- 주문취소 시 되돌리기 — 이 주문으로 적립됐던 포인트는 회수하고, 이 주문에서 사용했던 포인트는
-- 돌려준다. 호출부(server.js의 주문취소 처리)가 status가 처음으로 "취소"가 될 때만 부르므로
-- 여기서는 별도 중복 방지 없이 단순하게 반대 부호로 한 행씩 남긴다.
create or replace function reverse_points_for_order(p_order_no text)
returns void as $$
declare
  v_row record;
begin
  for v_row in
    select user_id, delta from loyalty_points_ledger
    where order_no = p_order_no and reason in ('earn_purchase', 'redeem_order')
  loop
    insert into loyalty_points_ledger (user_id, order_no, delta, reason)
    values (v_row.user_id, p_order_no, -v_row.delta, 'refund_reversal');
  end loop;
end;
$$ language plpgsql;
