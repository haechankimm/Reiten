/* server.js와 여러 routes/*.js가 공통으로 쓰는 로그 3종 — 전부 fire-and-forget 원칙(로그
   적재 실패가 본작업을 막으면 안 됨)과 "마이그레이션 미실행이면 조용히 실패" 원칙을 공유해서
   한 파일로 묶었다. */
const { supabaseAdmin } = require("./supabase");
const { sendAdminWebhookAlert } = require("./adminWebhook");

/* server.js의 GET /api/admin/system-errors·알림센터가 같은 라벨을 쓰므로 여기 한 곳에 모아둔다
   (예전엔 server.js에만 있어서 아래 웹훅 문구가 raw type 슬러그로만 나갔었다). */
const SYSTEM_ERROR_LABEL = {
  card_cancel_failed: "카드결제 취소 실패(이중실패)",
  refund_failed: "환불 실패",
  virtual_account_close_failed: "가상계좌 폐쇄 실패",
  order_finalize_failed: "카드결제 후 주문 확정 실패",
  bank_order_finalize_failed: "무통장입금 주문 저장 실패(재고 확인 필요)",
  notification_failed: "알림 발송 실패",
  coupon_usage_exceeded: "쿠폰 사용 한도 초과(결제 후 확정 단계)",
  points_balance_exceeded: "적립금 잔액 초과(결제 후 확정 단계)",
  order_finalize_duplicate_not_found: "결제 확정 시 기존 주문을 찾지 못함(중복 확정 의심)",
  first_purchase_coupon_failed: "첫구매 감사쿠폰 발급 실패",
  repeat_purchase_coupon_failed: "재구매 감사쿠폰 발급 실패",
  thanks_coupon_failed: "감사쿠폰 처리 실패",
  order_uncancel_inventory_conflict: "취소 되돌리기 시 재고 재차감 실패",
  order_uncancelled_card_payment_not_restored: "취소 되돌리기 시 카드 환불 복원 불가(수동 확인 필요)",
};

/* ---------- 관리자 감사 로그 ----------
   관리자가 2명 이상이 되면 "누가 언제 무엇을 바꿨는지"를 추적할 방법이 필요해진다.
   008_admin_admin_log.sql 미실행 시에도 본작업에는 지장이 없도록 에러를 조용히 삼킨다. */
function logAdminAction(req, action, targetType, targetId, detail) {
  supabaseAdmin
    .from("admin_audit_log")
    .insert({
      admin_id: req.user.id,
      admin_email: req.user.email || "",
      action,
      target_type: targetType,
      target_id: String(targetId),
      detail: detail || null,
    })
    .then(({ error }) => {
      if (error) console.error("[audit-log] 적재 실패:", error.message);
    });
}

/* ---------- 재고 변동 이력 ----------
   inventory 테이블은 현재 수량만 갖고 있어 "왜 줄었는지"를 알 수 없었다(012_inventory_log.sql).
   재고를 바꾸는 모든 지점(주문 차감, 자동취소·반품 복원, 관리자 수기 수정)에서 이 함수로 한 줄씩
   남긴다. rows: [{ productId, size, delta, reason, ref?, adminEmail? }] */
function logInventoryChange(rows) {
  if (!rows || !rows.length) return;
  supabaseAdmin
    .from("inventory_log")
    .insert(
      rows.map((r) => ({
        product_id: r.productId,
        color: r.color || "",
        size: r.size,
        delta: r.delta,
        reason: r.reason,
        ref: r.ref || null,
        admin_email: r.adminEmail || null,
      }))
    )
    .then(({ error }) => {
      if (error) console.error("[inventory-log] 적재 실패:", error.message);
    });
}

/* ---------- 시스템 오류 로그 ----------
   카드결제 이중실패·환불 실패처럼 지금까지 관리자 이메일로만 가서 놓치기 쉬웠던 긴급 이벤트를
   Works 알림센터(/api/admin/notifications)에서도 바로 보이게 한다(019_system_error_log.sql).
   마이그레이션 미실행 시에도 조용히 실패해 사이트 동작에는 지장이 없다. */
function logSystemError(type, detail) {
  supabaseAdmin
    .from("system_error_log")
    .insert({ type, detail: detail || null })
    .then(({ error }) => {
      if (error) console.error("[system-error-log] 적재 실패:", error.message);
    });

  /* 시스템 오류는 정의상 전부 "critical"(알림센터 severity 참고) — 벨 아이콘을 열어봐야만
     아는 걸로는 부족하다는 요청(2026-09)으로, 설정해둔 웹훅이 있으면 곧바로도 흘려보낸다. */
  const label = SYSTEM_ERROR_LABEL[type] || type;
  const detailText = detail
    ? Object.entries(detail)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")
    : "";
  sendAdminWebhookAlert(`🚨 [REITEN] ${label}${detailText ? "\n" + detailText : ""}`);
}

/* ---------- 결제 트랜잭션 로그 ----------
   지금까지는 포트원 검증 실패·금액 불일치·조회 에러가 전부 console.error로만 남고 어디에도
   저장되지 않아서, 주문으로 안 이어진 결제 시도는 사실상 흔적이 없었다(030_payment_log.sql,
   2026-09 "결제 트랜잭션 로그" 요청). 성공(paid)은 finalizeCardOrder가, 실패·불일치·에러는
   웹훅과 /api/order 카드 분기 양쪽이 각자 이 함수로 남긴다. */
function logPaymentAttempt({ paymentId, orderNo, status, amount, method, reason }) {
  supabaseAdmin
    .from("payment_log")
    .insert({
      payment_id: paymentId,
      order_no: orderNo || null,
      status,
      amount: amount ?? null,
      method: method || "card",
      reason: reason || null,
    })
    .then(({ error }) => {
      if (error) console.error("[payment-log] 적재 실패:", error.message);
    });
}

module.exports = { logAdminAction, logInventoryChange, logSystemError, logPaymentAttempt, SYSTEM_ERROR_LABEL };
