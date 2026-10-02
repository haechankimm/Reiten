-- REITEN — 캘린더 기간 일정(여러 날) 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요. (여러 번 실행해도 안전)
--
-- calendar_events.end_date: 일정이 끝나는 날(비우면 하루짜리). 10/3~10/15처럼 기간을 한 건으로 저장한다.
-- 이 컬럼이 없어도 Works는 기간 일정을 "하루당 한 건"씩 나눠 저장하는 방식으로 동작한다.
alter table calendar_events add column if not exists end_date date;
create index if not exists calendar_events_end_date_idx on calendar_events (end_date);
