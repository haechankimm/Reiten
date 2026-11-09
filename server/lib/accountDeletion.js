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
  // 확인이 실패하면 "진행 중 주문 있음"으로 본다 — 예전엔 DB 오류 때 탈퇴가 그냥 진행됐다(2026-10-28)
  if (error) return true;
  return (count || 0) > 0;
}

/* 정리 → 계정 삭제 순서는 그대로지만(외래키 때문에 먼저 끊어야 함), 계정 삭제가 실패하면 끊었던 연결과 적립금 원장을
   되돌린다 — 예전엔 마지막 단계만 실패해도 계정은 남았는데 주문 내역·적립금만 사라졌다(2026-10-28 정기 감사). */
const UNLINK_TABLES = [
  { table: "orders", key: "order_no" },
  { table: "return_requests", key: "id" },
  { table: "qna", key: "id" },
  { table: "pending_payments", key: "payment_id" },
];

async function deleteCustomerAccount(userId) {
  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email = userData && userData.user ? (userData.user.email || "").toLowerCase() : "";

  // ① 되돌릴 수 있게 지금 연결된 행과 적립금 원장을 기억해 둔다
  const linked = {};
  for (const { table, key } of UNLINK_TABLES) {
    const { data, error } = await supabaseAdmin.from(table).select(key).eq("user_id", userId);
    if (!tolerable(error)) return { ok: false, error: "연결된 기록 정리에 실패했습니다: " + error.message };
    linked[table] = (data || []).map((r) => r[key]);
  }
  const { data: ledgerRows, error: ledgerReadErr } = await supabaseAdmin.from("loyalty_points_ledger").select("*").eq("user_id", userId);
  if (!tolerable(ledgerReadErr)) return { ok: false, error: "연결된 기록 정리에 실패했습니다: " + ledgerReadErr.message };

  async function rollback() {
    for (const { table, key } of UNLINK_TABLES) {
      const ids = linked[table] || [];
      if (ids.length) await supabaseAdmin.from(table).update({ user_id: userId }).in(key, ids);
    }
    if (ledgerRows && ledgerRows.length) await supabaseAdmin.from("loyalty_points_ledger").insert(ledgerRows);
  }

  // ② 연결 끊기·원장 삭제
  const steps = [
    ...UNLINK_TABLES.map(({ table }) => supabaseAdmin.from(table).update({ user_id: null }).eq("user_id", userId)),
    supabaseAdmin.from("loyalty_points_ledger").delete().eq("user_id", userId),
  ];
  const results = await Promise.all(steps);
  const failed = results.find((r) => !tolerable(r.error));
  if (failed) {
    await rollback();
    return { ok: false, error: "연결된 기록 정리에 실패했습니다: " + failed.error.message };
  }

  // ③ 계정 삭제 — 실패하면 되돌린다
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    await rollback();
    return { ok: false, error: "계정 삭제에 실패했습니다: " + error.message };
  }
  // ④ 품절 알림 신청은 계정이 실제로 지워진 뒤에 정리(개인정보)
  if (email) await supabaseAdmin.from("restock_subscriptions").delete().eq("email", email);
  return { ok: true };
}

module.exports = { deleteCustomerAccount, hasActiveOrders };
