/* server.js와 여러 routes/*.js가 공통으로 쓰는 로그 3종 — 전부 fire-and-forget 원칙(로그
   적재 실패가 본작업을 막으면 안 됨)과 "마이그레이션 미실행이면 조용히 실패" 원칙을 공유해서
   한 파일로 묶었다. */
const { supabaseAdmin } = require("./supabase");

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
}

module.exports = { logAdminAction, logInventoryChange, logSystemError };
