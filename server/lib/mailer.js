const { Resend } = require("resend");
const { SITE, COURIERS } = require("../../소스 코드/assets/js/data.js");

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
    replyTo: SITE.email,
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
    replyTo: SITE.email,
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

/* 배송 시작 안내 메일(고객용) — 관리자가 운송장번호를 처음 입력하는 순간 1회 발송. */
async function sendCustomerShipped(order) {
  if (!resend || !order.customer.email) return;

  const courierInfo = COURIERS.find((c) => c.key === order.courier);
  const courierLabel = courierInfo ? courierInfo.label : order.courier || "";
  const trackingUrl =
    courierInfo && order.tracking_no
      ? courierInfo.urlTemplate.replace("{tracking}", encodeURIComponent(order.tracking_no))
      : null;

  await resend.emails.send({
    from: process.env.RESEND_FROM || "onboarding@resend.dev",
    to: order.customer.email,
    replyTo: SITE.email,
    subject: `[REITEN] 배송이 시작되었습니다 — ${order.order_no}`,
    html: `
      <h2>${escHtml(order.customer.name)}님, 배송이 시작되었습니다</h2>
      <p><b>주문번호</b> ${escHtml(order.order_no)}</p>
      <p><b>택배사</b> ${escHtml(courierLabel)}</p>
      <p><b>운송장번호</b> ${escHtml(order.tracking_no || "")}</p>
      ${trackingUrl ? `<p><a href="${escHtml(trackingUrl)}">배송조회 바로가기</a></p>` : ""}
      <ul>${itemsHtml(order)}</ul>
    `,
  });
}

/* 재고 소진 알림 메일(관리자용) — 주문 처리로 특정 상품·사이즈 재고가 0이 된 순간 발송. */
async function sendAdminLowStock(items) {
  if (!resend || !process.env.ADMIN_NOTIFY_EMAIL || !items.length) return;

  await resend.emails.send({
    from: process.env.RESEND_FROM || "onboarding@resend.dev",
    to: process.env.ADMIN_NOTIFY_EMAIL,
    subject: `[REITEN] 재고 소진 — ${items.map((it) => `${it.name} ${it.size}`).join(", ")}`,
    html: `
      <h2>재고가 0이 된 상품이 있습니다</h2>
      <ul>${items.map((it) => `<li>${escHtml(it.name)} — ${escHtml(it.size)}</li>`).join("")}</ul>
    `,
  });
}

/* 카드결제 완료 알림(관리자용) — sendOrderNotification과 거의 같지만 무통장입금 전용인
   "입금자명" 줄 대신 결제수단을 보여준다. 카드결제는 접수 시점에 이미 결제가 끝난 상태라
   sendOrderNotification(접수만 알림)이 아니라 이 함수를 쓴다. */
async function sendAdminCardPaid(order) {
  if (!resend || !process.env.ADMIN_NOTIFY_EMAIL) {
    console.warn("[mailer] RESEND_API_KEY 또는 ADMIN_NOTIFY_EMAIL이 설정되지 않아 카드결제 알림 메일을 건너뜁니다.");
    return;
  }

  await resend.emails.send({
    from: process.env.RESEND_FROM || "onboarding@resend.dev",
    to: process.env.ADMIN_NOTIFY_EMAIL,
    subject: `[REITEN] 카드결제 완료 — ${order.order_no}`,
    html: `
      <h2>카드결제가 완료된 새 주문이 접수되었습니다</h2>
      <p><b>주문번호</b> ${escHtml(order.order_no)}</p>
      <p><b>주문자</b> ${escHtml(order.customer.name)} (${escHtml(order.customer.tel)})</p>
      <p><b>결제수단</b> 카드결제 (포트원)</p>
      <p><b>배송지</b> [${escHtml(order.customer.zip)}] ${escHtml(order.customer.addr)} ${escHtml(order.customer.addr2 || "")}</p>
      <p><b>메모</b> ${escHtml(order.customer.memo || "-")}</p>
      <ul>${itemsHtml(order)}</ul>
      <p><b>총 결제금액</b> ${won(order.total)} (상품 ${won(order.subtotal)} + 배송비 ${won(order.shipping)})</p>
    `,
  });
}

/* 카드결제 완료 확인 메일(고객용) — /api/order가 포트원 결제를 검증한 직후 1회 발송.
   sendCustomerOrderReceived(입금 대기 안내)와 달리 이미 결제가 끝났다고 안내한다. */
async function sendCustomerCardPaid(order) {
  if (!resend || !order.customer.email) return;

  await resend.emails.send({
    from: process.env.RESEND_FROM || "onboarding@resend.dev",
    to: order.customer.email,
    replyTo: SITE.email,
    subject: `[REITEN] 결제가 완료되었습니다 — ${order.order_no}`,
    html: `
      <h2>${escHtml(order.customer.name)}님, 결제가 완료되었습니다</h2>
      <p><b>주문번호</b> ${escHtml(order.order_no)}</p>
      <ul>${itemsHtml(order)}</ul>
      <p><b>총 결제금액</b> ${won(order.total)}</p>
      <p style="margin-top:16px;color:#666">${escHtml(SITE.shipping.leadTime)}. 발송이 시작되면 운송장번호를 안내드립니다.</p>
    `,
  });
}

module.exports = {
  sendOrderNotification,
  sendCustomerOrderReceived,
  sendCustomerPaymentConfirmed,
  sendCustomerShipped,
  sendAdminLowStock,
  sendAdminCardPaid,
  sendCustomerCardPaid,
};
