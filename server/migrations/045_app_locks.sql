-- REITEN — 서버 여러 대에서도 안전한 처리 잠금 (2026-11-09)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (여러 번 실행해도 안전)
--
-- 결제 확정·환불·주문 상태 변경·PIN 확인은 "같은 건이 동시에 두 번 처리되지 않게" 서버 메모리 안에서 줄을 세워 왔다.
-- 서버가 한 대(Render 인스턴스 1개)일 때는 이걸로 충분하지만, 트래픽이 늘어 서버를 2대 이상으로 늘리면 서로의 줄을
-- 몰라서 이중 환불·이중 결제 확정이 다시 가능해지고, 매시 자동취소·주간 백업·월간 정산 같은 정기 작업도 대수만큼 중복 실행된다.
-- 이 표에 "지금 처리 중" 표시를 남겨 모든 서버가 같은 줄을 보게 한다(lib/dbLock.js).
-- 실행하지 않아도 사이트는 멈추지 않는다 — 지금처럼 서버 한 대 기준의 메모리 잠금만으로 동작한다(서버를 늘리기 전에는 꼭 실행).
create table if not exists app_locks (
  key text primary key,
  owner text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table app_locks enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.
create index if not exists app_locks_expires_idx on app_locks (expires_at);
