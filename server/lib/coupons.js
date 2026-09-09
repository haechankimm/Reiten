const { couponDiscount } = require("./pricing");
const { isMissingSchemaError } = require("./pgErrors");

/* 쿠폰 유효성 검사 + 할인액 계산 — db는 supabaseAdmin과 같은 인터페이스(.from().select().eq()...)를
   가진 클라이언트를 주입받는다(운영에서는 실제 Supabase, 테스트에서는 가벼운 가짜 클라이언트,
   server/test/helpers/fakeSupabase.js 참고). server.js에 그대로 둘 수도 있었지만, Supabase에
   의존하지 않고 이 함수만 단독으로 통합 테스트할 수 있도록 분리했다(pricing.js/orderExport.js와
   같은 원칙 — "순수 로직은 lib로 분리해 테스트하기 쉽게 한다").

   /api/payments/prepare(카드결제 사전검증)와 /api/order(무통장입금) 양쪽, 그리고
   /api/coupons/validate(장바구니 미리보기)가 이 함수 하나만 부르면 되게 해서, 할인 규칙이
   세 곳에서 따로 놀지 않게 한다. 반환값은 { code, discount } — 쿠폰을 안 썼으면
   { code: null, discount: 0 }, 유효하지 않으면 에러를 throw한다(e.status로 HTTP 상태 코드를 겸함). */
async function resolveCoupon(db, rawCode, { rawItems, items, subtotal }) {
  if (!rawCode) return { code: null, discount: 0 };

  const code = String(rawCode).trim().toUpperCase().slice(0, 40);
  if (!code) return { code: null, discount: 0 };

  const { data: coupon, error } = await db.from("coupons").select("*").eq("code", code).maybeSingle();
  if (error || !coupon || !coupon.active) {
    throw Object.assign(new Error("유효하지 않은 쿠폰 코드입니다."), { status: 400 });
  }

  const now = new Date();
  if (coupon.starts_at && now < new Date(coupon.starts_at)) {
    throw Object.assign(new Error("아직 사용할 수 없는 쿠폰입니다."), { status: 400 });
  }
  if (coupon.ends_at && now > new Date(coupon.ends_at)) {
    throw Object.assign(new Error("기간이 만료된 쿠폰입니다."), { status: 400 });
  }
  if (subtotal < coupon.min_subtotal) {
    throw Object.assign(
      new Error(`이 쿠폰은 ${coupon.min_subtotal.toLocaleString("ko-KR")}원 이상 주문부터 사용할 수 있습니다.`),
      { status: 400 }
    );
  }
  if (coupon.usage_limit != null) {
    /* 동시에 마지막 1장을 두 주문이 같이 쓰면 usage_limit을 살짝 넘길 수 있는 이론적 여지가 있다
       (재고 차감처럼 원자적 락을 걸지 않음) — 소규모 쿠폰 운영 규모에서는 감수할 만한 수준이라
       단순 카운트 조회로 처리한다. */
    const { count } = await db.from("orders").select("id", { count: "exact", head: true }).eq("coupon_code", coupon.code);
    if ((count || 0) >= coupon.usage_limit) {
      throw Object.assign(new Error("쿠폰 사용 횟수가 모두 소진되었습니다."), { status: 400 });
    }
  }

  const discount = couponDiscount(coupon, { subtotal, items, rawItems });
  if (discount <= 0) {
    throw Object.assign(new Error("이 쿠폰은 장바구니에 담긴 상품에 적용할 수 없습니다."), { status: 400 });
  }

  return { code: coupon.code, discount };
}

/* resolveCoupon()의 usage_limit 확인(SELECT count)은 주문이 실제로 만들어지기 전 미리보기
   (/api/coupons/validate, /api/payments/prepare)에도 그대로 쓰이기 때문에, 거기서 원자적으로
   슬롯을 미리 차지해버리면 결제를 끝까지 안 한 손님들 몫으로 자리가 조용히 소진된다. 그래서
   실제 "차감"은 주문이 실제로 확정되는 시점(무통장입금 /api/order, 카드결제 finalizeCardOrder)
   에만 이 함수로 한 번 더 호출한다 — 032_coupon_usage_lock.sql의 claim_coupon_usage()가
   UPDATE ... WHERE used_count < usage_limit 한 문장으로 확인+증가를 원자적으로 처리해서,
   두 주문이 마지막 1장을 동시에 확정해도 하나만 성공한다(resolveCoupon의 count 기반 확인은
   이론상 두 요청이 모두 통과할 수 있었음 — 2026-09 코드 감사에서 발견).
   반환값: true면 정상 차감, false면 이미 소진됨(호출부가 주문을 계속 진행할지 결정). 마이그레이션
   미실행이거나 DB 오류면 다른 선택 기능과 같은 원칙으로 "조용히 통과"시킨다(쿠폰 자체가
   막히는 것보다 usage_limit이 살짝 초과되는 게 덜 나쁜 실패라고 판단). */
async function claimCouponUsage(db, code) {
  if (!code) return true;
  const { data, error } = await db.rpc("claim_coupon_usage", { p_code: code });
  if (error) {
    if (isMissingSchemaError(error)) {
      console.warn("[coupon] claim_coupon_usage 함수 없음(마이그레이션 032 미실행) — 잠금 없이 진행");
    } else {
      console.error("[coupon] 사용 횟수 차감 실패:", error.message);
    }
    return true;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return !!(row && row.claimed);
}

/* claimCouponUsage()로 차감한 슬롯을 되돌린다 — 카드결제 웹훅과 프론트엔드 확인 요청이 거의
   동시에 도착해 finalizeCardOrder가 두 번 실행된 경우(재고를 restore_inventory로 되돌리는 것과
   같은 지점)에만 쓴다. 실패해도 fire-and-forget으로 로그만 남긴다 — 실제 결제·주문 자체는
   이미 끝난 뒤라 여기서 막을 이유가 없다(다른 정리 작업들과 같은 원칙). */
async function releaseCouponUsage(db, code) {
  if (!code) return;
  const { error } = await db.rpc("release_coupon_usage", { p_code: code });
  if (error && !isMissingSchemaError(error)) {
    console.error("[coupon] 사용 횟수 복원 실패:", error.message);
  }
}

module.exports = { resolveCoupon, claimCouponUsage, releaseCouponUsage };
