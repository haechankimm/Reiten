/* 미입금 주문 리마인드(2026-11-11, 마이그레이션 055) — 무통장입금 주문은 PENDING_CANCEL_HOURS(24시간) 안에 입금이 없으면
   자동 취소된다(lib/scheduledJobs.js). 깜빡해서 취소되는 주문을 줄이려고, 취소 REMIND_BEFORE_HOURS(6시간) 전쯤 한 번만
   메일(+알림톡이 켜져 있으면 알림톡)로 "아직 입금 전이에요"를 보낸다. 가상계좌·카드는 결제사가 따로 처리하므로 대상 아님.
   보낸 시각은 orders.deposit_reminded_at — 먼저 표시하고 보낸다(두 번 보내지 않게). 055 전이면 조용히 아무것도 안 한다.
   끄려면 Render 환경변수 DEPOSIT_REMINDER=off. */
const { supabaseAdmin } = require("./supabase");
const { SITE } = require("../../소스 코드/assets/js/data.js");
const { PENDING_CANCEL_HOURS } = require("./orderRules");

const REMIND_BEFORE_HOURS = 6;
const HOUR = 3600 * 1000;

/* 순수 함수 — 지금 리마인드를 보낼 시간대인지. 주문 후 (24-6)=18시간 지났고, 취소까지 1시간 넘게 남은 것만
   (매시 크론이 한 번은 반드시 잡는 2~6시간 폭). */
function reminderWindow(now = Date.now()) {
  return {
    from: new Date(now - (PENDING_CANCEL_HOURS - 1) * HOUR).toISOString(), // 이보다 오래된 건 곧 취소되니 안 보냄
    to: new Date(now - (PENDING_CANCEL_HOURS - REMIND_BEFORE_HOURS) * HOUR).toISOString(),
  };
}

function hoursLeftFor(createdAt, now = Date.now()) {
  return Math.max(1, Math.floor((new Date(createdAt).getTime() + PENDING_CANCEL_HOURS * HOUR - now) / HOUR));
}

async function remindUnpaidOrders({ db = supabaseAdmin, now = Date.now() } = {}) {
  if (process.env.DEPOSIT_REMINDER === "off") return { sent: 0, skipped: "off" };
  const w = reminderWindow(now);
  const { data: rows, error } = await db
    .from("orders")
    .select("id, order_no, items, customer, total, payment_method, created_at")
    .eq("status", "입금대기")
    .is("deposit_reminded_at", null)
    .gt("created_at", w.from)
    .lt("created_at", w.to)
    .limit(100);
  if (error || !rows) return { sent: 0 }; // 055 미실행(컬럼 없음) 포함 — 조용히 건너뜀

  const { sendCustomerDepositReminder } = require("./mailer");
  const kakao = require("./kakao");
  let sent = 0;
  for (const order of rows) {
    if (order.payment_method === "card" || order.payment_method === "virtual_account") continue;
    const { data: marked, error: markErr } = await db
      .from("orders")
      .update({ deposit_reminded_at: new Date(now).toISOString() })
      .eq("id", order.id)
      .eq("status", "입금대기")
      .is("deposit_reminded_at", null)
      .select("id");
    if (markErr || !marked || !marked.length) continue; // 그 사이 입금 확인됐거나 다른 서버가 먼저 보냄
    const hoursLeft = hoursLeftFor(order.created_at, now);
    try {
      await sendCustomerDepositReminder(order, { hoursLeft });
    } catch (err) {
      console.error("[deposit-reminder] 메일 발송 실패:", order.order_no, err.message);
    }
    if (order.customer && order.customer.tel) {
      kakao.sendAlimtalk("DEPOSIT_REMINDER", order.customer.tel, {
        name: order.customer.name, orderNo: order.order_no, amount: `${Number(order.total).toLocaleString("ko-KR")}원`,
        account: `${SITE.order.bankName} ${SITE.order.accountNo} (예금주 ${SITE.order.holder})`, hours: hoursLeft,
      }).catch(() => {});
    }
    sent++;
  }
  return { sent };
}

module.exports = { remindUnpaidOrders, reminderWindow, hoursLeftFor, REMIND_BEFORE_HOURS };
