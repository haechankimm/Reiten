/* 첫 구매·재구매 감사 쿠폰 코드 접두사 — 쿠폰을 실제로 발급하는 server.js(maybeIssueFirstPurchaseCoupon/
   maybeIssueRepeatPurchaseCoupon)와, 발급/사용 현황을 집계하는 routes/dashboard.js
   (computeDashboardStats)가 같은 값을 봐야 해서 하나로 뽑았다. 접두사를 바꾸면 이미 발급된
   과거 쿠폰은 새 집계에 안 잡히니 주의. */
const FIRST_PURCHASE_COUPON_CODE_PREFIX = "THANKS-";
const REPEAT_PURCHASE_COUPON_CODE_PREFIX = "LOYAL-";

/* 첫 구매/재구매 감사 쿠폰의 할인율·기준 횟수는 새 설정 테이블 없이 Works "정보" 탭
   (admin_settings)의 자유 텍스트 항목을 재사용한다 — server.js가 이 정확한 문자열로
   `.eq("label", ...)` 매칭해서 값을 찾는다. server.js(쿠폰 발급)와 routes/settings.js
   (라벨 이름 변경/삭제 보호)가 같은 값을 봐야 해서 여기 하나로 모아둔다.
   ⚠️ admin_settings.label은 관리자가 자유롭게 고칠 수 있는 메모장 필드라, 여기 적힌 문자열과
   정확히 같지 않으면 조용히 못 찾고 기본값으로 되돌아간다(2026-09-01 코드 감사에서 발견) —
   그래서 routes/settings.js가 이 라벨들의 이름 변경·삭제만 막아둔다(값은 자유롭게 수정 가능). */
const FIRST_PURCHASE_COUPON_SETTING_LABEL = "첫 구매 감사 쿠폰 할인율(%)";
const REPEAT_PURCHASE_COUPON_THRESHOLD_LABEL = "재구매 감사 쿠폰 발급 기준(누적 구매 횟수)";
const REPEAT_PURCHASE_COUPON_PERCENT_LABEL = "재구매 감사 쿠폰 할인율(%)";
const PROTECTED_SETTING_LABELS = [
  FIRST_PURCHASE_COUPON_SETTING_LABEL,
  REPEAT_PURCHASE_COUPON_THRESHOLD_LABEL,
  REPEAT_PURCHASE_COUPON_PERCENT_LABEL,
];

module.exports = {
  FIRST_PURCHASE_COUPON_CODE_PREFIX,
  REPEAT_PURCHASE_COUPON_CODE_PREFIX,
  FIRST_PURCHASE_COUPON_SETTING_LABEL,
  REPEAT_PURCHASE_COUPON_THRESHOLD_LABEL,
  REPEAT_PURCHASE_COUPON_PERCENT_LABEL,
  PROTECTED_SETTING_LABELS,
};
