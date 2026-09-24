/* 결제 이탈 리마인드 — pending_payments에 남은 "결제창까지 갔지만 완료 안 된" 행 중,
   생성 후 REMIND_AFTER_HOURS 지나고 아직 안 보낸 것에 1회만 메일을 보낸다.
   pending_payments는 24시간 지나면 새 요청 때 정리되므로 그 안에 보낸다.
   기본은 꺼져 있고 환경변수 ABANDONED_CART_EMAIL=on 일 때만 동작한다(수신 동의·광고성 여부는
   운영자가 확인하고 켜도록). 마이그레이션 039가 없으면 조용히 아무것도 안 한다. */
const { supabaseAdmin } = require("./supabase");
const { sendCustomerAbandonedCart } = require("./mailer");

const REMIND_AFTER_HOURS = 2;
const MAX_AGE_HOURS = 23;

async function remindAbandonedCarts() {
  if (process.env.ABANDONED_CART_EMAIL !== "on") return { sent: 0 };

  const now = Date.now();
  const { data: rows, error } = await supabaseAdmin
    .from("pending_payments")
    .select("payment_id, customer, items, total, created_at")
    .is("reminder_sent_at", null)
    .lt("created_at", new Date(now - REMIND_AFTER_HOURS * 3600 * 1000).toISOString())
    .gt("created_at", new Date(now - MAX_AGE_HOURS * 3600 * 1000).toISOString())
    .limit(50);
  if (error || !rows) return { sent: 0 };

  let sent = 0;
  for (const row of rows) {
    const email = row.customer && row.customer.email;
    // 먼저 표시해서(중복 발송 방지) 같은 행을 두 번 처리하지 않는다.
    const { error: markError } = await supabaseAdmin
      .from("pending_payments")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("payment_id", row.payment_id)
      .is("reminder_sent_at", null);
    if (markError || !email) continue;

    // 같은 이메일로 그 뒤에 이미 주문이 들어왔다면(다시 시도해서 결제 성공) 보내지 않는다.
    const { data: later } = await supabaseAdmin
      .from("orders")
      .select("order_no")
      .eq("customer->>email", email)
      .gte("created_at", row.created_at)
      .limit(1);
    if (later && later.length) continue;

    await sendCustomerAbandonedCart({ customer: row.customer, items: row.items, total: row.total });
    sent++;
  }
  return { sent };
}

module.exports = { remindAbandonedCarts };
