const { Resend } = require("resend");
const { SITE } = require("../../소스 코드/assets/js/data.js");

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function won(n) {
  return Number(n || 0).toLocaleString("ko-KR") + "원";
}

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function itemsHtml(order) {
  return order.items
    .map((it) => `<li>${escHtml(it.name)} (${escHtml(it.options)}) × ${it.qty} — ${won(it.sum)}</li>`)
    .join("");
}

/* 주문 알림 메일 발송(관리자용) — 실패해도 주문 처리 자체를 막지 않도록 호출부에서 항상 catch할 것. */
async function sendOrderNotification(order) {
  if (!resend || !process.env.ADMIN_NOTIFY_EMAIL) {
    console.warn(
      "[mailer] RESEND_API_KEY 또는 ADMIN_NOTIFY_EMAIL이 설정되지 않아 주문 알림 메일을 건너뜁니다."
    );
    return;
  }

  await resend.emails.send({
    from: process.env.RESEND_FROM || "onboarding@resend.dev",
    to: process.env.ADMIN_NOTIFY_EMAIL,
    subject: `[REITEN] 새 주문 접수 — ${order.order_no}`,
    html: `
      <h2>새 주문이 접수되었습니다</h2>
      <p><b>주문번호</b> ${escHtml(order.order_no)}</p>
      <p><b>주문자</b> ${escHtml(order.customer.name)} (${escHtml(order.customer.tel)})</p>
      <p><b>입금자명</b> ${escHtml(order.customer.payer)}</p>
      <p><b>배송지</b> [${escHtml(order.customer.zip)}] ${escHtml(order.customer.addr)} ${escHtml(order.customer.addr2 || "")}</p>
      <p><b>메모</b> ${escHtml(order.customer.memo || "-")}</p>
      <ul>${itemsHtml(order)}</ul>
      <p><b>총 결제금액</b> ${won(order.total)} (상품 ${won(order.subtotal)} + 배송비 ${won(order.shipping)})</p>
    `,
  });
}

/* 주문 접수 확인 메일(고객용) — /api/order 처리 직후 1회 발송. 실패해도 호출부에서 항상 catch할 것. */
async function sendCustomerOrderReceived(order) {
  if (!resend || !order.customer.email) return;

  await resend.emails.send({
    from: process.env.RESEND_FROM || "onboarding@resend.dev",
    to: order.customer.email,
    subject: `[REITEN] 주문이 접수되었습니다 — ${order.order_no}`,
    html: `
      <h2>${escHtml(order.customer.name)}님, 주문이 접수되었습니다</h2>
      <p><b>주문번호</b> ${escHtml(order.order_no)}</p>
      <ul>${itemsHtml(order)}</ul>
      <p><b>총 결제금액</b> ${won(order.total)} (상품 ${won(order.subtotal)} + 배송비 ${won(order.shipping)})</p>
      <p style="margin-top:16px">
        <b>입금 계좌</b><br>
        ${escHtml(SITE.order.bankName)} ${escHtml(SITE.order.accountNo)} · 예금주 ${escHtml(SITE.order.holder)}<br>
        입금자명 ${escHtml(order.customer.payer)}
      </p>
      <p style="margin-top:16px;color:#666">입금 확인이 완료되면 다시 메일로 안내드립니다.</p>
    `,
  });
}

/* 입금 확인 메일(고객용) — 관리자가 주문 상태를 "입금확인"으로 바꾸는 순간 1회 발송. */
async function sendCustomerPaymentConfirmed(order) {
  if (!resend || !order.customer.email) return;

  await resend.emails.send({
    from: process.env.RESEND_FROM || "onboarding@resend.dev",
    to: order.customer.email,
    subject: `[REITEN] 입금이 확인되었습니다 — ${order.order_no}`,
    html: `
      <h2>${escHtml(order.customer.name)}님, 입금이 확인되었습니다</h2>
      <p><b>주문번호</b> ${escHtml(order.order_no)}</p>
      <ul>${itemsHtml(order)}</ul>
      <p><b>총 결제금액</b> ${won(order.total)}</p>
      <p style="margin-top:16px;color:#666">${escHtml(SITE.shipping.leadTime)}. 발송이 시작되면 운송장번호를 안내드립니다.</p>
    `,
  });
}

module.exports = { sendOrderNotification, sendCustomerOrderReceived, sendCustomerPaymentConfirmed };
