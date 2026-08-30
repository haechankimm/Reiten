-- REITEN — 주문 기기 정보(기기별 실제 매출 집계용) 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
-- (001_init.sql을 먼저 실행한 상태여야 합니다.)

-- GA4는 "몇 명이 방문했는지"만 알려주고 "그중 누가 실제로 결제까지 했는지"는 알려주지 않는다
-- (GA4 이커머스 이벤트를 새로 연동하지 않는 한). 이미 우리 DB에 있는 실제 결제 완료 기록에
-- 기기 정보만 하나 같이 저장해두면, GA4보다 더 정확한(쿠키 차단에 영향받지 않는) "기기별
-- 실제 매출·구매 건수"를 알 수 있다. 값은 mobile/tablet/desktop/unknown 중 하나(브라우저에서
-- navigator.userAgent로 간단히 판별, app.js의 detectDeviceType() 참고).
alter table orders add column if not exists device text;
alter table pending_payments add column if not exists device text;
