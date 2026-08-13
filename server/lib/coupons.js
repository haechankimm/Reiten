const { couponDiscount } = require("./pricing");

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

module.exports = { resolveCoupon };
