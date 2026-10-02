/* 고객 계정 삭제(관리자 삭제·고객 셀프 탈퇴 공용). auth.users를 cascade 없이 참조하는 테이블이 하나라도
   남아 있으면 삭제가 외래키 위반으로 실패하므로 먼저 정리한다:
   - 주문·반품·문의·결제대기: user_id만 끊는다(레코드는 customer jsonb에 이름·연락처가 있어 그대로 유효 — 전자상거래법상 보관 대상)
   - 적립금 원장: user_id가 NOT NULL이라 행을 지운다(탈퇴 시 적립금 소멸)
   - 품절 알림 신청: 그 이메일로 신청한 건 삭제(개인정보 정리)
   마이그레이션이 덜 된 테이블·컬럼은 건너뛴다. */
const { supabaseAdmin } = require("./supabase");
const { isMissingSchemaError, isMissingColumnError } = require("./pgErrors");

const ACTIVE_ORDER_STATUSES = ["입금대기", "입금확인", "배송중"];

const tolerable = (error) => !error || isMissingSchemaError(error) || isMissingColumnError(error);

async function hasActiveOrders(userId) {
  const { count, error } = await supabaseAdmin
    .from("orders")
    .select("order_no", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ACTIVE_ORDER_STATUSES);
  return !error && (count || 0) > 0;
}

async function deleteCustomerAccount(userId) {
  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email = userData && userData.user ? (userData.user.email || "").toLowerCase() : "";

  const steps = [
    supabaseAdmin.from("orders").update({ user_id: null }).eq("user_id", userId),
    supabaseAdmin.from("return_requests").update({ user_id: null }).eq("user_id", userId),
    supabaseAdmin.from("qna").update({ user_id: null }).eq("user_id", userId),
    supabaseAdmin.from("pending_payments").update({ user_id: null }).eq("user_id", userId),
    supabaseAdmin.from("loyalty_points_ledger").delete().eq("user_id", userId),
  ];
  if (email) steps.push(supabaseAdmin.from("restock_subscriptions").delete().eq("email", email));
  const results = await Promise.all(steps);
  const failed = results.find((r) => !tolerable(r.error));
  if (failed) return { ok: false, error: "연결된 기록 정리에 실패했습니다: " + failed.error.message };

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: "계정 삭제에 실패했습니다: " + error.message };
  return { ok: true };
}

module.exports = { deleteCustomerAccount, hasActiveOrders };
