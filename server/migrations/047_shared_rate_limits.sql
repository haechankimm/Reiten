-- REITEN — 서버 여러 대가 함께 쓰는 요청 횟수 제한 카운터 (2026-11-09)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (여러 번 실행해도 안전)
--
-- 요청 횟수 제한(주문·조회·쿠폰 확인 등 "15분에 N번")은 지금 서버 메모리에서 센다. 서버가 한 대면 정확하지만,
-- 두 대 이상이면 서버마다 따로 세서 한도가 사실상 대수만큼 늘어난다. 이 표에 모든 서버가 함께 센다.
-- 실행만 해서는 바뀌는 게 없다 — Render 환경변수 RATE_LIMIT_SHARED=on 을 넣어야 이 표를 쓴다(요청마다 DB를 한 번 더
-- 거치므로 서버가 한 대일 때는 켜지 않는 편이 빠르다). 서버를 늘릴 때 045와 함께 실행하고 켠다.
create table if not exists rate_limits (
  key text primary key,
  hits integer not null default 0,
  reset_at timestamptz not null
);
alter table rate_limits enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.
create index if not exists rate_limits_reset_idx on rate_limits (reset_at);

-- 한 번 세기: 창(window)이 지났으면 1부터 다시, 아니면 +1. 동시에 여러 요청이 와도 한 문장(upsert)이라 정확하다.
create or replace function rate_limit_hit(p_key text, p_window_ms integer)
returns table(out_hits integer, out_reset_at timestamptz)
language sql
as $$
  insert into rate_limits as r (key, hits, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_ms / 1000.0))
  on conflict (key) do update set
    hits = case when r.reset_at <= now() then 1 else r.hits + 1 end,
    reset_at = case when r.reset_at <= now() then now() + make_interval(secs => p_window_ms / 1000.0) else r.reset_at end
  returning r.hits, r.reset_at;
$$;

-- 성공한 요청을 세지 않는 제한(skipSuccessfulRequests 등)용 되돌리기
create or replace function rate_limit_undo(p_key text)
returns void
language sql
as $$
  update rate_limits set hits = greatest(hits - 1, 0) where key = p_key;
$$;

-- 브라우저 키(anon·로그인 회원)로는 부르지 못하게 — 서버(service role)만 사용
revoke execute on function rate_limit_hit(text, integer) from public, anon, authenticated;
revoke execute on function rate_limit_undo(text) from public, anon, authenticated;
