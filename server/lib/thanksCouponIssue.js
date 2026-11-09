/* 첫 구매·재구매 감사 쿠폰 자동 발급 — server.js에서 분리(2026-11-09, 동작 변경 없음). */
const crypto = require("crypto");
const { supabaseAdmin } = require("./supabase");
const { sendCustomerFirstPurchaseThanks, sendCustomerRepeatPurchaseThanks } = require("./mailer");

const { logSystemError } = require("./adminLog");
const {
  FIRST_PURCHASE_COUPON_CODE_PREFIX,
  REPEAT_PURCHASE_COUPON_CODE_PREFIX,
  FIRST_PURCHASE_COUPON_SETTING_LABEL,
  REPEAT_PURCHASE_COUPON_THRESHOLD_LABEL,
  REPEAT_PURCHASE_COUPON_PERCENT_LABEL,
} = require("./thanksCoupons");
const { isMissingSchemaError } = require("./pgErrors");
const { normalizeTel } = require("./phone");

/* 고객 전용 1회용 감사 쿠폰(THANKS-/LOYAL- 접두사)에 공통으로 쓰는 고유 코드 생성 — 첫 구매·
   재구매 감사 쿠폰 둘 다 같은 규칙(접두사+무작위 6자리 hex, 충돌 시 최대 5회 재시도)이라
   하나로 뽑았다(재고 차감 로직을 통합했던 것과 같은 원칙 — 위 운영 규칙 2번 참고). */
async function generateUniqueCouponCode(prefix) {
  for (let i = 0; i < 5; i++) {
    const candidate = `${prefix}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const { data: exists } = await supabaseAdmin.from("coupons").select("code").eq("code", candidate).maybeSingle();
    if (!exists) return candidate;
  }
  return null;
}

/* 첫 구매/재구매 감사 쿠폰이 "이 고객이 이 마일스톤(첫 구매, 5번째 구매 등)에 도달했다"는
   판정을 두 번 하지 않도록 원자적으로 선점한다(028_coupon_milestones.sql). SELECT로 먼저
   확인하고 나서 INSERT하는 방식은 두 주문이 거의 동시에 확정되면(카드결제 웹훅과 프론트엔드
   확인이 겹치는 경우, 관리자가 여러 건을 빠르게 입금확인 처리하는 경우 등) 둘 다 SELECT를
   통과해버려 같은 마일스톤 쿠폰이 중복 발급될 수 있다(2026-09-01 코드 감사에서 발견) —
   tel+milestone에 유니크 제약을 건 테이블에 INSERT를 시도해서, 유니크 위반(23505)이 나면
   "이미 다른 요청이 선점했다"는 뜻으로 조용히 포기한다. 마이그레이션 미실행 시엔 잠금 없이
   진행(예전과 같은 경합 위험이 남지만, 이 기능 자체가 막히지는 않음 — 다른 선택 기능과 같은
   "미실행 시 조용히 저하" 원칙). */
async function claimCouponMilestone(tel, milestone) {
  const { error } = await supabaseAdmin.from("coupon_milestones").insert({ tel, milestone });
  if (!error) return true;
  if (error.code === "23505") return false;
  if (isMissingSchemaError(error)) {
    console.warn("[coupon-milestone] coupon_milestones 테이블 없음(마이그레이션 028 미실행) — 잠금 없이 진행");
    return true;
  }
  console.error("[coupon-milestone] 잠금 시도 실패:", error.message);
  return true;
}

/* ---------- 첫 구매 감사 쿠폰 ----------
   카드결제(finalizeCardOrder, 결제 즉시 "입금확인")와 무통장입금(관리자가 PATCH로 "입금확인"
   처리) 양쪽에서 공통으로 부른다. 이 고객의 확정 주문(취소·입금대기 제외)이 이번이 처음이면,
   그 고객 전용 1회용 쿠폰을 새로 만들어 coupons 테이블에 저장하고(Works "쿠폰" 탭에도 그대로
   보임 — usage_limit=1이라 자연히 "한 번만" 쓸 수 있게 됨, 새 검증 로직 없이 기존
   resolveCoupon()이 그대로 처리) 메일로 안내한다.
   할인율은 새 설정 테이블을 만들지 않고 기존 admin_settings(Works "정보" 탭)를 재사용한다 —
   관리자가 그 탭에서 이 라벨의 값을 숫자로 바꾸면 다음 발급부터 바로 반영된다. 설정 자체가
   없으면(처음 배포 시) 기본값 1%로 폴백한다.
   코드 접두사(THANKS-)는 Works 대시보드 "첫 구매 쿠폰 발급 현황"(computeDashboardStats)이
   발급/사용 건수를 집계할 때도 그대로 쓰인다 — 접두사를 바꾸면 그쪽 집계도 같이 바꿔야 한다.
   ⚠️ 이 항목의 label은 free-text인 admin_settings에서 정확히 문자열이 일치해야 찾아진다 —
   routes/settings.js가 이 라벨(과 아래 재구매 라벨)의 이름 변경·삭제를 막아둔 이유가 이것
   (2026-09-01 코드 감사에서 발견: 이름을 조금이라도 고치면 조용히 기본값으로 되돌아감). */
const FIRST_PURCHASE_COUPON_DEFAULT_PERCENT = 1;

/* hasPriorOrder는 호출부(issueThanksCouponsIfEligible)가 한 번의 쿼리로 미리 계산해서 넘겨준다
   — 재구매 감사 쿠폰과 거의 같은 대상 집합을 각자 따로 조회하던 것을 통합함(2026-09-01 코드
   감사에서 발견한 비효율). */
async function maybeIssueFirstPurchaseCoupon(order, hasPriorOrder) {
  if (hasPriorOrder) return;

  const telDigits = normalizeTel(order.customer && order.customer.tel);
  if (!telDigits) return;
  if (!(await claimCouponMilestone(telDigits, "first_purchase"))) return;

  const { data: setting } = await supabaseAdmin
    .from("admin_settings")
    .select("value")
    .eq("label", FIRST_PURCHASE_COUPON_SETTING_LABEL)
    .maybeSingle();
  const parsedPercent = Math.floor(Number(setting && setting.value));
  const percent = Number.isFinite(parsedPercent) && parsedPercent > 0 && parsedPercent <= 100 ? parsedPercent : FIRST_PURCHASE_COUPON_DEFAULT_PERCENT;

  const code = await generateUniqueCouponCode(FIRST_PURCHASE_COUPON_CODE_PREFIX);
  if (!code) {
    console.error("[first-purchase-coupon] 고유 코드 생성 실패(5회 시도)");
    logSystemError("first_purchase_coupon_failed", { orderNo: order.order_no, stage: "code_generation" });
    return;
  }

  const { error: insertError } = await supabaseAdmin.from("coupons").insert({
    code,
    discount_type: "percent",
    discount_value: percent,
    scope: "all",
    usage_limit: 1,
    active: true,
  });
  if (insertError) {
    console.error("[first-purchase-coupon] 쿠폰 생성 실패:", insertError.message);
    logSystemError("first_purchase_coupon_failed", { orderNo: order.order_no, stage: "coupon_insert", error: insertError.message });
    return;
  }

  await sendCustomerFirstPurchaseThanks({ customer: order.customer, code, discountValue: percent }).catch((err) =>
    console.error("[mailer] 첫 구매 감사 쿠폰 메일 발송 실패:", err.message)
  );
}

/* ---------- 재구매 감사 쿠폰 ----------
   첫 구매 감사 쿠폰과 똑같은 자리(카드결제 확정·관리자의 "입금확인" 처리)에서 같이 호출된다.
   이 고객의 확정 주문 수(취소·입금대기 제외, 이번 주문 포함)가 정확히 기준 횟수(기본 5회)에
   "막 도달한" 순간에만 1회 발급한다 — 매번 세는 게 아니라 "==threshold"로만 판정해서 6번째·
   7번째 구매에서 또 발급되는 걸 막는다(그 다음은 10번째·15번째처럼 다음 단계를 원하면 관리자가
   기준 횟수 자체를 나중에 조정하면 된다 — 지금은 "5번째"만 지원). 할인율·기준 횟수 모두 첫
   구매 쿠폰과 같은 원칙으로 새 테이블 없이 admin_settings를 재사용한다. */
const REPEAT_PURCHASE_COUPON_DEFAULT_THRESHOLD = 5;
const REPEAT_PURCHASE_COUPON_DEFAULT_PERCENT = 5;

/* confirmedCount도 호출부가 미리 계산해서 넘겨준다(위 첫 구매 쿠폰 참고). */
async function maybeIssueRepeatPurchaseCoupon(order, confirmedCount) {
  const telDigits = normalizeTel(order.customer && order.customer.tel);
  if (!telDigits) return;

  const { data: thresholdSetting } = await supabaseAdmin
    .from("admin_settings")
    .select("value")
    .eq("label", REPEAT_PURCHASE_COUPON_THRESHOLD_LABEL)
    .maybeSingle();
  const parsedThreshold = Math.floor(Number(thresholdSetting && thresholdSetting.value));
  const threshold = Number.isFinite(parsedThreshold) && parsedThreshold > 1 ? parsedThreshold : REPEAT_PURCHASE_COUPON_DEFAULT_THRESHOLD;

  if (confirmedCount !== threshold) return;
  if (!(await claimCouponMilestone(telDigits, `repeat_${threshold}`))) return;

  const { data: percentSetting } = await supabaseAdmin
    .from("admin_settings")
    .select("value")
    .eq("label", REPEAT_PURCHASE_COUPON_PERCENT_LABEL)
    .maybeSingle();
  const parsedPercent = Math.floor(Number(percentSetting && percentSetting.value));
  const percent = Number.isFinite(parsedPercent) && parsedPercent > 0 && parsedPercent <= 100 ? parsedPercent : REPEAT_PURCHASE_COUPON_DEFAULT_PERCENT;

  const code = await generateUniqueCouponCode(REPEAT_PURCHASE_COUPON_CODE_PREFIX);
  if (!code) {
    console.error("[repeat-purchase-coupon] 고유 코드 생성 실패(5회 시도)");
    logSystemError("repeat_purchase_coupon_failed", { orderNo: order.order_no, stage: "code_generation" });
    return;
  }

  const { error: insertError } = await supabaseAdmin.from("coupons").insert({
    code,
    discount_type: "percent",
    discount_value: percent,
    scope: "all",
    usage_limit: 1,
    active: true,
  });
  if (insertError) {
    console.error("[repeat-purchase-coupon] 쿠폰 생성 실패:", insertError.message);
    logSystemError("repeat_purchase_coupon_failed", { orderNo: order.order_no, stage: "coupon_insert", error: insertError.message });
    return;
  }

  await sendCustomerRepeatPurchaseThanks({ customer: order.customer, code, discountValue: percent, purchaseCount: threshold }).catch((err) =>
    console.error("[mailer] 재구매 감사 쿠폰 메일 발송 실패:", err.message)
  );
}

/* 첫 구매·재구매 감사 쿠폰 둘 다 "이 고객의 확정 주문이 몇 건이고 그중 이번 주문이 처음인지"를
   판단해야 하는데, 예전엔 거의 같은 조건(입금확인/배송중/완료 상태의 orders 전체)으로 각자
   따로 조회하고 있었다(2026-09-01 코드 감사에서 발견한 비효율 — 주문이 확정될 때마다 매번
   두 번 왕복). 한 번만 조회해서 두 판정에 그대로 나눠 쓴다. */
async function issueThanksCouponsIfEligible(order) {
  const telDigits = normalizeTel(order.customer && order.customer.tel);
  if (!telDigits) return;

  const { data: matchingOrders, error } = await supabaseAdmin
    .from("orders")
    .select("order_no, customer")
    .in("status", ["입금확인", "배송중", "완료"]);
  if (error) {
    console.error("[thanks-coupon] 기존 주문 조회 실패:", error.message);
    logSystemError("thanks_coupon_failed", { orderNo: order.order_no, stage: "order_lookup", error: error.message });
    return;
  }

  const sameCustomer = (matchingOrders || []).filter((o) => normalizeTel(o.customer && o.customer.tel) === telDigits);
  const hasPriorOrder = sameCustomer.some((o) => o.order_no !== order.order_no);
  const confirmedCount = sameCustomer.length;

  await Promise.all([
    maybeIssueFirstPurchaseCoupon(order, hasPriorOrder).catch((err) => console.error("[first-purchase-coupon] 처리 실패:", err.message)),
    maybeIssueRepeatPurchaseCoupon(order, confirmedCount).catch((err) => console.error("[repeat-purchase-coupon] 처리 실패:", err.message)),
  ]);
}

module.exports = { issueThanksCouponsIfEligible, generateUniqueCouponCode };
