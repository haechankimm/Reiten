/* 배송 후 리뷰 요청 메일 — 배송이 시작된 지 REVIEW_REQUEST_DAYS일 지난 주문에 1회만 보낸다(매일 11:00 KST).
   취소된 주문, 이미 보낸 주문, 이미 그 주문으로 리뷰를 쓴 경우는 제외. 끄려면 Render 환경변수
   REVIEW_REQUEST_EMAIL=off. 041 마이그레이션(shipped_at·review_requested_at) 전이면 조용히 아무것도 안 한다. */
const { supabaseAdmin } = require("./supabase");
const { sendCustomerReviewRequest } = require("./mailer");

const REVIEW_REQUEST_DAYS = 5;
const MAX_AGE_DAYS = 30;

async function sendReviewRequests(now = Date.now()) {
  if (process.env.REVIEW_REQUEST_EMAIL === "off") return { sent: 0 };
  const { data: orders, error } = await supabaseAdmin
    .from("orders")
    .select("order_no, customer, items, status, shipped_at")
    .is("review_requested_at", null)
    .in("status", ["배송중", "완료"])
    .lte("shipped_at", new Date(now - REVIEW_REQUEST_DAYS * 86400000).toISOString())
    .gte("shipped_at", new Date(now - MAX_AGE_DAYS * 86400000).toISOString())
    .limit(50);
  if (error || !orders) return { sent: 0 };

  let sent = 0;
  for (const o of orders) {
    const { data: marked } = await supabaseAdmin
      .from("orders")
      .update({ review_requested_at: new Date(now).toISOString() })
      .eq("order_no", o.order_no)
      .is("review_requested_at", null)
      .select("order_no");
    if (!marked || !marked.length) continue; // 다른 인스턴스가 먼저 처리함

    const { data: existing } = await supabaseAdmin.from("reviews").select("id").eq("order_no", o.order_no).limit(1);
    if (existing && existing.length) continue;

    await sendCustomerReviewRequest({ customer: o.customer, orderNo: o.order_no, items: o.items });
    sent++;
  }
  return { sent };
}

module.exports = { sendReviewRequests, REVIEW_REQUEST_DAYS };
