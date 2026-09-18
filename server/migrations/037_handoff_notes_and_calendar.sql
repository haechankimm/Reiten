-- REITEN — 인수인계 노트 + 사내 캘린더 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--
-- 인수인계 노트(admin_handoff_notes): 로그인 직후 "오늘" 홈 화면에서 관리자끼리 "오늘 특이사항"을
-- 남기는 용도. 대화형이 아니라 짧은 메모를 시간순으로 쌓아두는 게시판이라 새 테이블 하나로
-- 충분하다(수정 없이 삭제만 가능 — 감사 로그와 같은 원칙, 지운 사람은 admin_audit_log에 남음).
--
-- 사내 캘린더(calendar_events): figlo 등 다른 관리자 툴의 "캘린더" 탭을 참고해, 발매일·행사·
-- 휴무 같은 일정을 색으로 구분해 한 화면에서 보는 용도. 반복 일정은 처음부터 만들지 않음
-- (매주/매월 반복 규칙까지 가면 복잡도가 크게 늘어나는데 이 규모에서 필요성이 낮음 — 필요해지면
-- 별도로 추가).

create table if not exists admin_handoff_notes (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  admin_email text not null,
  created_at timestamptz not null default now()
);
alter table admin_handoff_notes enable row level security;
-- 정책 없음 = anon/authenticated 키로는 접근 불가. 서버(server/)만 service role key로 접근한다.
create index if not exists admin_handoff_notes_created_at_idx on admin_handoff_notes (created_at desc);

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_date date not null,
  color text not null default 'blue' check (color in ('blue', 'green', 'orange', 'purple', 'red', 'gray')),
  memo text,
  created_by text,
  created_at timestamptz not null default now()
);
alter table calendar_events enable row level security;
create index if not exists calendar_events_date_idx on calendar_events (event_date);
