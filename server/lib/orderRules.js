/* 주문 규칙 상수 — 자동취소 크론(lib/scheduledJobs.js)과 관리자 취소 되돌리기(routes/adminOrders.js)가 함께 쓴다(2026-11-09 분리). */

/* 고객 화면에는 "24시간 내 미입금 시 자동 취소됩니다"라고 안내한다(2026-08-14부터 3일→24시간 단축). */
const PENDING_CANCEL_HOURS = 24;

module.exports = { PENDING_CANCEL_HOURS };
