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

/* 재입고 발주 알림(관리자용) — sendAdminLowStock은 "방금 0이 됐다"는 즉시 알림이고, 이건
   그 상태가 며칠째 이어지고 있는지(daysSince) 매주 한 번 모아서 다시 알려주는 용도다.
   품절 즉시 메일은 이미 가고 있으니 굳이 매일 또 보내면 스팸이 되므로 주간 다이제스트로 묶는다. */
async function sendAdminRestockAlert(items, thresholdDays) {
  if (!resend || !process.env.ADMIN_NOTIFY_EMAIL || !items.length) return;

  await resend.emails.send({
    from: process.env.RESEND_FROM || "onboarding@resend.dev",
    to: process.env.ADMIN_NOTIFY_EMAIL,
    subject: `[REITEN] 발주 필요 — ${items.length}개 조합이 장기 품절 상태입니다`,
    html: `
      <h2>${thresholdDays}일 이상 재고 소진 중인 상품이 있습니다</h2>
      <p>재입고(발주)를 검토해 주세요.</p>
      <ul>${items
        .map((it) => `<li>${escHtml(it.name)} — ${escHtml(it.color || "(공통)")} / ${escHtml(it.size)} · ${it.daysSince}일째 품절</li>`)
        .join("")}</ul>
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

/* 미입금 자동취소 안내 메일(고객용) — 크론이 24시간 지난 입금대기 주문을 취소하는 순간 1회 발송.
   재입금해서 다시 주문할 수 있다는 것도 함께 안내한다. */
async function sendCustomerAutoCancelled(order) {
  if (!resend || !order.customer.email) return;

  await resend.emails.send({
    from: process.env.RESEND_FROM || "onboarding@resend.dev",
    to: order.customer.email,
    replyTo: SITE.email,
    subject: `[REITEN] 미입금으로 주문이 취소되었습니다 — ${order.order_no}`,
    html: `
      <h2>${escHtml(order.customer.name)}님, 주문이 자동 취소되었습니다</h2>
      <p><b>주문번호</b> ${escHtml(order.order_no)}</p>
      <p style="margin-top:8px">입금 확인이 되지 않아 주문 접수 24시간 경과 후 자동으로 취소되었습니다.</p>
      <ul>${itemsHtml(order)}</ul>
      <p style="margin-top:16px;color:#666">다시 주문하고 싶으시면 사이트에서 새로 담아 주문해 주세요. 이미 입금하셨다면 회신 메일로 알려주세요 — 확인 후 복구해드립니다.</p>
    `,
  });
}

/* 카드결제 재고부족 취소 실패 긴급 알림(관리자용) — "결제는 됐는데 물건은 없고, 그 결제 취소마저
   실패한" 최악의 이중 실패 상황. 지금까지는 서버 로그에만 남고 관리자가 못 볼 수 있었다.
   실패해도(이메일조차 안 나가도) 호출부에서 항상 catch할 것 — 그래도 로그는 남아 있다. */
async function sendAdminCardCancelFailed({ paymentId, productId, size, cancelError }) {
  if (!resend || !process.env.ADMIN_NOTIFY_EMAIL) {
    console.warn("[mailer] RESEND_API_KEY 또는 ADMIN_NOTIFY_EMAIL이 설정되지 않아 결제취소 실패 긴급 알림을 건너뜁니다.");
    return;
  }

  await resend.emails.send({
    from: process.env.RESEND_FROM || "onboarding@resend.dev",
    to: process.env.ADMIN_NOTIFY_EMAIL,
    subject: `[REITEN] ⚠️ 긴급 — 카드결제 취소 실패 (재고부족 후)`,
    html: `
      <h2 style="color:#c00">결제는 완료됐는데 재고가 없어 취소를 시도했지만, 그 취소마저 실패했습니다.</h2>
      <p><b>결제 ID</b> ${escHtml(paymentId)}</p>
      <p><b>상품</b> ${escHtml(productId)} / ${escHtml(size)}</p>
      <p><b>취소 실패 사유</b> ${escHtml(cancelError || "-")}</p>
      <p style="margin-top:16px;color:#c00"><b>포트원 관리자 콘솔에서 이 결제를 직접 확인하고 수동으로 환불 처리해 주세요.</b></p>
    `,
  });
}

/* 반품 승인 환불 실패 긴급 알림(관리자용) — 반품을 "완료"로 승인하면서 자동으로 포트원 환불을
   시도했는데 실패한 경우. 고객은 이미 반품 승인 처리됐다고 알고 있을 수 있어 빠르게 확인이
   필요하다. 실패해도 호출부에서 항상 catch할 것. */
async function sendAdminRefundFailed({ orderNo, amount, error }) {
  if (!resend || !process.env.ADMIN_NOTIFY_EMAIL) {
    console.warn("[mailer] RESEND_API_KEY 또는 ADMIN_NOTIFY_EMAIL이 설정되지 않아 환불 실패 긴급 알림을 건너뜁니다.");
    return;
  }

  await resend.emails.send({
    from: process.env.RESEND_FROM || "onboarding@resend.dev",
    to: process.env.ADMIN_NOTIFY_EMAIL,
    subject: `[REITEN] ⚠️ 긴급 — 반품 자동환불 실패 (${orderNo})`,
    html: `
      <h2 style="color:#c00">반품을 승인 처리했지만, 카드결제 자동환불이 실패했습니다.</h2>
      <p><b>주문번호</b> ${escHtml(orderNo)}</p>
      <p><b>환불 예정 금액</b> ${won(amount)}</p>
      <p><b>실패 사유</b> ${escHtml(error || "-")}</p>
      <p style="margin-top:16px;color:#c00"><b>포트원 관리자 콘솔에서 이 결제를 직접 확인하고 수동으로 환불 처리해 주세요.</b></p>
    `,
  });
}

/* 관리자 로그인 잠금 알림(관리자용) — 같은 이메일로 로그인이 연속 실패해 잠긴 경우.
   본인이 비밀번호를 잊어 여러 번 틀린 것일 수도 있지만, 무차별 대입 시도의 신호일 수도 있어
   알려둔다. 실패해도 호출부에서 항상 catch할 것. */
async function sendAdminLoginLocked({ email, failCount }) {
  if (!resend || !process.env.ADMIN_NOTIFY_EMAIL) {
    console.warn("[mailer] RESEND_API_KEY 또는 ADMIN_NOTIFY_EMAIL이 설정되지 않아 로그인 잠금 알림을 건너뜁니다.");
    return;
  }

  await resend.emails.send({
    from: process.env.RESEND_FROM || "onboarding@resend.dev",
    to: process.env.ADMIN_NOTIFY_EMAIL,
    subject: `[REITEN] ⚠️ 관리자 로그인 ${failCount}회 연속 실패로 잠김 — ${email}`,
    html: `
      <h2 style="color:#c00">로그인이 연속으로 실패해 이 계정의 로그인 화면이 잠시 잠겼습니다.</h2>
      <p><b>이메일</b> ${escHtml(email)}</p>
      <p><b>연속 실패 횟수</b> ${failCount}회</p>
      <p style="margin-top:16px;color:#666">본인이 비밀번호를 여러 번 잘못 입력한 것이라면 무시해도 됩니다. 짐작 가는 시도가 아니라면 비밀번호를 바꾸는 것을 권장합니다.</p>
    `,
  });
}

module.exports = {
  sendOrderNotification,
  sendCustomerOrderReceived,
  sendCustomerPaymentConfirmed,
  sendCustomerShipped,
  sendAdminLowStock,
  sendAdminRestockAlert,
  sendAdminCardPaid,
  sendCustomerCardPaid,
  sendCustomerAutoCancelled,
  sendAdminCardCancelFailed,
  sendAdminRefundFailed,
  sendAdminLoginLocked,
};
