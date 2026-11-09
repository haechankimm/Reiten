/* 정기 작업(크론): 미입금·가상계좌 자동취소, 배송조회, 자동 구매확정, 결제 이탈·리뷰 요청 메일, 재입고 발주 알림,
   주간 백업, 아침 요약, 월간 정산 — server.js에서 분리(2026-11-09, 동작 변경 없음). require하는 순간 크론이 등록된다. */
const cron = require("node-cron");
const { supabaseAdmin } = require("./supabase");
const { sendAdminRestockAlert, sendCustomerAutoCancelled, sendAdminSettlementReport, sendAdminBackup } = require("./mailer");
const kakao = require("./kakao");
const { runExclusive } = require("./dbLock");
const { sharedEnabled } = require("./rateLimitStore");

const { releaseCouponUsage } = require("./coupons");
const { reversePointsForOrder } = require("./loyaltyPoints");
const portone = require("./portone");
const { kstMonthRangeISO } = require("./kst");
const { restoreItemsFromOrder, findOutOfStockSinceFromLogs } = require("./inventory");
const { logInventoryChange, logSystemError } = require("./adminLog");
const { remindAbandonedCarts } = require("./abandonedCart");
const { sendReviewRequests } = require("./reviewRequest");
const { isMissingColumnError } = require("./pgErrors");
const { sendMorningBriefing } = require("./briefing");
const { buildBackup } = require("./backup");
const { checkDeliveries, autoConfirmOrders } = require("./purchaseConfirm");
const { buildSettlement } = require("./settlement");
const { PENDING_CANCEL_HOURS } = require("./orderRules");

/* 서버가 여러 대면 크론도 서버마다 울린다 — 먼저 잡은 한 대만 실행하고 나머지는 건너뛴다(lib/dbLock.js runExclusive,
   마이그레이션 045 전이면 예전처럼 그냥 실행). 서버 1대일 때 동작은 그대로다(2026-11-09). */
function scheduleExclusive(name, spec, fn, opts) {
  return cron.schedule(spec, () => runExclusive(`cron:${name}`, fn).catch((err) => console.error(`[cron:${name}] 실행 실패:`, err.message)), opts);
}

/* ---------- 미입금 주문 자동취소 ----------
   고객 화면에는 "24시간 내 미입금 시 자동 취소됩니다"라고 안내한다(2026-08-14부터 3일→24시간
   으로 단축). 매시 정각에 24시간 넘게 "입금대기" 상태인 주문을 찾아 취소하고 재고를 되돌린다. */

async function cancelStalePendingOrders() {
  const cutoff = new Date(Date.now() - PENDING_CANCEL_HOURS * 3600 * 1000).toISOString();
  /* 가상계좌는 여기서 다루지 않는다 — 발급 시 받은 실제 입금기한(virtual_account_due_at)이
     이 24시간 고정값과 다를 수 있어(관리자가 더 길게 설정 가능) closeExpiredVirtualAccounts()가
     따로 그 값을 기준으로 처리한다. 여기서 같이 잡으면 아직 기한이 안 지난 가상계좌 주문을
     "생성된 지 24시간 지났다"는 이유만으로 잘못 취소해버릴 수 있다. */
  let { data: stale, error } = await supabaseAdmin
    .from("orders")
    .select("id, order_no, items, customer, subtotal, shipping, total, points_used, coupon_code, created_at")
    .eq("status", "입금대기")
    .neq("payment_method", "virtual_account")
    .lt("created_at", cutoff);

  // points_used 컬럼이 아직 없음(034_loyalty_points.sql 미실행) — 그 컬럼 없이 재조회.
  if (isMissingColumnError(error)) {
    ({ data: stale, error } = await supabaseAdmin
      .from("orders")
      .select("id, order_no, items, customer, subtotal, shipping, total, created_at")
      .eq("status", "입금대기")
      .neq("payment_method", "virtual_account")
      .lt("created_at", cutoff));
  }

  if (error) {
    console.error("[auto-cancel] 미입금 주문 조회 실패:", error.message);
    return;
  }
  if (!stale.length) return;

  for (const order of stale) {
    /* SELECT와 이 UPDATE 사이(메일 발송 등으로 시간이 걸림)에 관리자가 이미 "입금확인"으로
       바꿨을 수 있다 — update 조건에도 status="입금대기"를 다시 걸어서, 그 사이 상태가
       바뀐 주문은 여기서 건드리지 않는다(걸지 않으면 방금 정상 처리된 결제를 자동취소로
       덮어쓰는 경쟁 상태가 생김). .select()로 실제 몇 건이 갱신됐는지 확인한다. */
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("orders")
      .update({ status: "취소", cancel_reason: `미입금 ${PENDING_CANCEL_HOURS}시간 경과 자동 취소` })
      .eq("id", order.id)
      .eq("status", "입금대기")
      .select("id");
    if (updateError) {
      console.error("[auto-cancel] 주문 취소 실패:", order.order_no, updateError.message);
      continue;
    }
    if (!updated || !updated.length) {
      console.log(`[auto-cancel] ${order.order_no} — 그 사이 상태가 바뀌어 건너뜀(경쟁 상태 방지)`);
      continue;
    }

    const restoreItems = restoreItemsFromOrder(order.items);
    if (restoreItems.length) {
      const { error: restoreError } = await supabaseAdmin.rpc("restore_inventory", { p_items: restoreItems });
      if (restoreError) {
        console.error("[auto-cancel] 재고 복원 실패:", order.order_no, restoreError.message);
      } else {
        logInventoryChange(
          restoreItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: it.qty, reason: "auto_cancel", ref: order.order_no }))
        );
      }
    }
    // 미입금으로 자동취소된 주문이 포인트를 썼었다면 그대로 돌려준다(관리자 수동 취소와 같은 원칙).
    if (order.points_used) {
      reversePointsForOrder(supabaseAdmin, order.order_no).catch((err) => console.error("[points] 자동취소 시 되돌리기 실패:", err.message));
    }
    // 주문 때 올린 쿠폰 사용 횟수도 돌려준다 — 안 하면 1회용 감사 쿠폰을 미입금 취소 후 다시 못 썼다(2026-10-28 정기 감사).
    if (order.coupon_code) {
      releaseCouponUsage(supabaseAdmin, order.coupon_code).catch((err) => console.error("[coupon] 자동취소 시 사용 횟수 반환 실패:", err.message));
    }

    sendCustomerAutoCancelled(order).catch((err) => console.error("[mailer] 자동취소 안내 메일 발송 실패:", err.message));
    kakao.sendAlimtalk("ORDER_CANCELLED", order.customer.tel, { name: order.customer.name, orderNo: order.order_no }).catch(() => {});
    console.log(`[auto-cancel] ${order.order_no} 미입금 자동 취소 처리 완료`);
  }
}

/* ---------- 가상계좌 입금기한 만료 자동취소 ----------
   위 무통장입금 자동취소와 같은 크론에서 같이 돈다. 다른 점은 기준 시각 — 무통장입금은
   "생성 후 PENDING_CANCEL_HOURS시간"이 고정이지만, 가상계좌는 발급 시 실제로 받은 입금기한
   (virtual_account_due_at)이 주문마다 다를 수 있어 그 값을 그대로 기준으로 쓴다. 계좌 자체도
   더 이상 쓰지 못하게 폐쇄한다(closeVirtualAccount — 아직 돈이 안 들어온 상태라 "취소·환불"이
   아니라 "폐쇄", finalizeVirtualAccountOrder 주석 참고). */
async function closeExpiredVirtualAccounts() {
  const now = new Date().toISOString();
  const { data: expired, error } = await supabaseAdmin
    .from("orders")
    .select("id, order_no, payment_id, items, customer, subtotal, shipping, total, points_used, coupon_code, created_at")
    .eq("status", "입금대기")
    .eq("payment_method", "virtual_account")
    .lt("virtual_account_due_at", now);

  if (error) {
    if (!isMissingColumnError(error)) console.error("[auto-cancel] 만료 가상계좌 조회 실패:", error.message);
    return; // virtual_account_due_at 컬럼 없음(035 미실행) — 조용히 건너뜀
  }
  if (!expired.length) return;

  for (const order of expired) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("orders")
      .update({ status: "취소", cancel_reason: "가상계좌 입금기한 만료 자동 취소" })
      .eq("id", order.id)
      .eq("status", "입금대기")
      .select("id");
    if (updateError) {
      console.error("[auto-cancel] 가상계좌 만료 취소 실패:", order.order_no, updateError.message);
      continue;
    }
    if (!updated || !updated.length) continue; // 그 사이 입금 확인됨(경쟁 상태 방지) — 정상 케이스

    const restoreItems = restoreItemsFromOrder(order.items);
    if (restoreItems.length) {
      const { error: restoreError } = await supabaseAdmin.rpc("restore_inventory", { p_items: restoreItems });
      if (restoreError) {
        console.error("[auto-cancel] 재고 복원 실패:", order.order_no, restoreError.message);
      } else {
        logInventoryChange(
          restoreItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: it.qty, reason: "auto_cancel", ref: order.order_no }))
        );
      }
    }
    if (order.points_used) {
      reversePointsForOrder(supabaseAdmin, order.order_no).catch((err) => console.error("[points] 자동취소 시 되돌리기 실패:", err.message));
    }
    // 주문 때 올린 쿠폰 사용 횟수도 돌려준다 — 안 하면 1회용 감사 쿠폰을 미입금 취소 후 다시 못 썼다(2026-10-28 정기 감사).
    if (order.coupon_code) {
      releaseCouponUsage(supabaseAdmin, order.coupon_code).catch((err) => console.error("[coupon] 자동취소 시 사용 횟수 반환 실패:", err.message));
    }
    try {
      await portone.closeVirtualAccount(order.payment_id);
    } catch (closeErr) {
      console.error("[auto-cancel] ⚠️ 가상계좌 폐쇄 실패 — 수동 확인 필요:", order.order_no, closeErr.message);
      // 계좌가 열린 채 남으면 취소된 주문에 입금이 들어올 수 있어 긴급 알림으로 남긴다(2026-10-28)
      logSystemError("virtual_account_close_failed", { orderNo: order.order_no, error: closeErr.message, source: "auto_cancel" });
    }

    sendCustomerAutoCancelled({ ...order, payment_method: "virtual_account" }).catch((err) => console.error("[mailer] 자동취소 안내 메일 발송 실패:", err.message));
    kakao.sendAlimtalk("ORDER_CANCELLED", order.customer.tel, { name: order.customer.name, orderNo: order.order_no }).catch(() => {});
    console.log(`[auto-cancel] ${order.order_no} 가상계좌 입금기한 만료 자동 취소 처리 완료`);
  }
}

scheduleExclusive("review-request", "0 11 * * *", () => {
  sendReviewRequests().catch((err) => console.error("[review-request] 실행 실패:", err.message));
}, { timezone: "Asia/Seoul" });

/* 배송조회 자동화(SWEETTRACKER_API_KEY가 있을 때만) — 매시 15분, 배송완료면 주문 "완료" + delivered_at */
scheduleExclusive("tracking", "15 * * * *", () => {
  checkDeliveries().catch((err) => console.error("[tracking] 실행 실패:", err.message));
});

/* 자동 구매확정 — 매일 03:40(KST), 배송완료 7일·출고 14일 지난 주문(반품·교환 처리 중 제외) 확정 + 적립금 지급 */
scheduleExclusive("purchase-confirm", "40 3 * * *", () => {
  autoConfirmOrders().catch((err) => console.error("[purchase-confirm] 실행 실패:", err.message));
}, { timezone: "Asia/Seoul" });

scheduleExclusive("abandoned-cart", "30 * * * *", () => {
  remindAbandonedCarts().catch((err) => console.error("[abandoned-cart] 실행 실패:", err.message));
});

scheduleExclusive("auto-cancel", "0 * * * *", () => {
  cancelStalePendingOrders().catch((err) => console.error("[auto-cancel] 실행 실패:", err.message));
  closeExpiredVirtualAccounts().catch((err) => console.error("[auto-cancel] 가상계좌 만료 처리 실행 실패:", err.message));
});

/* ---------- 재입고 발주 알림 ----------
   재고가 0이 되는 "순간"은 이미 sendAdminLowStock으로 즉시 알리고 있다. 하지만 그 상태가
   방치되는 경우(발주를 깜빡함)를 잡아주는 알림은 없었다. inventory_log(재고 변동 이력,
   012_inventory_log.sql)를 거꾸로 훑어서 재고가 마지막으로 "0 이하로 떨어진" 시점을 역산하고,
   그게 RESTOCK_ALERT_DAYS일 이상 지난 조합만 매주 한 번 모아서 알린다(매일 보내면 같은 품절
   건이 몇 주씩 반복 발송되어 스팸이 되므로 주간 다이제스트로 묶는다). */
const RESTOCK_ALERT_DAYS = 7;
/* 발주 추천 수량 계산에 쓰는 조회 기간 — "얼마나 발주해야 할지 모르겠다"는 피드백으로 추가.
   정교한 수요예측 모델이 아니라 "최근 이 정도 팔렸다"를 그대로 보여주는 참고치라 단순하게
   간다(과도한 엔지니어링 지양). */
const RESTOCK_SALES_LOOKBACK_DAYS = 30;

async function findOutOfStockSince(productId, color, size, currentQty) {
  const { data: logs, error } = await supabaseAdmin
    .from("inventory_log")
    .select("delta, created_at")
    .eq("product_id", productId)
    .eq("color", color)
    .eq("size", size)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !logs) return null; // 이력이 없으면 언제부터 품절인지 알 수 없어 건너뛴다
  return findOutOfStockSinceFromLogs(logs, currentQty);
}

/* 최근 RESTOCK_SALES_LOOKBACK_DAYS일간 이 조합이 "주문(order)"으로 얼마나 팔렸는지 합산 —
   발주 추천 수량의 기준치로 쓴다. 품절 기간이 이 창보다 길면 그동안은 못 판 것까지 포함되니
   실제 수요보다 적게 나올 수 있음(메일 문구에도 명시). */
async function recentSalesQty(productId, color, size) {
  const cutoff = new Date(Date.now() - RESTOCK_SALES_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("inventory_log")
    .select("delta")
    .eq("product_id", productId)
    .eq("color", color)
    .eq("size", size)
    .eq("reason", "order")
    .gte("created_at", cutoff);
  if (error || !data) return 0;
  return data.reduce((sum, r) => sum + Math.abs(r.delta), 0);
}

async function checkRestockNeeded() {
  const { data: rows, error } = await supabaseAdmin.from("inventory").select("product_id, color, size, qty").lte("qty", 0);
  if (error) {
    console.error("[restock-alert] 재고 조회 실패:", error.message);
    return;
  }
  if (!rows.length) return;

  /* 판매 중(active)인 상품의 지금 판매하는 컬러만 대상 — 비공개 상품·빠진 컬러의 옛 재고행(0개)까지
     매주 "발주하라"고 알리던 문제(2026-09 점검에서 발견). */
  const { data: activeProducts } = await supabaseAdmin.from("products").select("id, colors").eq("active", true);
  const sellable = new Map((activeProducts || []).map((p) => [p.id, new Set(p.colors || [])]));
  const candidates = rows.filter((r) => sellable.has(r.product_id) && sellable.get(r.product_id).has(r.color));
  if (!candidates.length) return;

  const cutoff = Date.now() - RESTOCK_ALERT_DAYS * 24 * 3600 * 1000;
  const overdue = [];
  for (const row of candidates) {
    const since = await findOutOfStockSince(row.product_id, row.color, row.size, row.qty);
    if (since && new Date(since).getTime() <= cutoff) overdue.push({ ...row, since });
  }
  if (!overdue.length) return;

  const ids = [...new Set(overdue.map((r) => r.product_id))];
  const { data: products } = await supabaseAdmin.from("products").select("id, name_ko").in("id", ids);
  const nameOf = (id) => products?.find((p) => p.id === id)?.name_ko || id;

  const items = [];
  for (const r of overdue) {
    items.push({
      name: nameOf(r.product_id),
      color: r.color,
      size: r.size,
      daysSince: Math.floor((Date.now() - new Date(r.since).getTime()) / (24 * 3600 * 1000)),
      recommendedQty: await recentSalesQty(r.product_id, r.color, r.size),
    });
  }

  sendAdminRestockAlert(items, RESTOCK_ALERT_DAYS).catch((err) => console.error("[mailer] 재입고 알림 메일 발송 실패:", err.message));
}

scheduleExclusive("restock-alert", "0 9 * * 1", () => {
  checkRestockNeeded().catch((err) => console.error("[restock-alert] 실행 실패:", err.message));
}, { timezone: "Asia/Seoul" });

/* ---------- 월간 정산 리포트 ----------
   매달 1일 09:00에 "지난달"(KST 기준) 주문·쿠폰·환불 내역 엑셀을 관리자에게 메일로 보낸다(세무사 전달용).
   리포트 생성은 lib/settlement.js — Works "대시보드" 탭의 정산 리포트 다운로드·재발송 버튼(routes/reports.js)도
   같은 함수를 쓴다(메일이 실패해도 Works에서 바로 받을 수 있게, 2026-10-02). */
async function sendMonthlySettlement() {
  const { monthKey } = kstMonthRangeISO(1);
  const report = await buildSettlement(monthKey);
  if (report.error) {
    console.error("[settlement] 생성 실패:", report.error);
    return;
  }
  sendAdminSettlementReport({ monthLabel: report.monthLabel, summary: report.summary, buffer: report.buffer }).catch((err) =>
    console.error("[mailer] 정산 리포트 메일 발송 실패:", err.message)
  );
}

/* 주간 전체 백업 — 매주 월요일 04:20(KST), 관리자 메일로 gzip JSON(lib/backup.js). 끄려면 BACKUP_EMAIL=off */
scheduleExclusive("backup", "20 4 * * 1", async () => {
  if (process.env.BACKUP_EMAIL === "off") return;
  try {
    const backup = await buildBackup();
    await sendAdminBackup(backup);
  } catch (err) {
    console.error("[backup] 주간 백업 실패:", err.message);
    logSystemError("backup_failed", { error: err.message });
  }
}, { timezone: "Asia/Seoul" });

/* 아침 업무 요약 — 매일 08:57(KST), 입금 확인·출고 대기·미답변 문의·반품 처리·시스템 오류 건수를 폰 푸시(+텔레그램)로 */
scheduleExclusive("briefing", "57 8 * * *", () => {
  sendMorningBriefing().catch((err) => console.error("[briefing] 실행 실패:", err.message));
}, { timezone: "Asia/Seoul" });

scheduleExclusive("settlement", "0 9 1 * *", () => {
  sendMonthlySettlement().catch((err) => console.error("[settlement] 실행 실패:", err.message));
}, { timezone: "Asia/Seoul" });


/* 공유 요청 제한(RATE_LIMIT_SHARED=on, 마이그레이션 047)의 지난 카운터 정리 — 매일 04:50(KST), 하루 지난 것만 */
scheduleExclusive("rate-limit-cleanup", "50 4 * * *", async () => {
  if (!sharedEnabled()) return;
  const { error } = await supabaseAdmin.from("rate_limits").delete().lt("reset_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  if (error) console.error("[rate-limit] 지난 카운터 정리 실패:", error.message);
}, { timezone: "Asia/Seoul" });

module.exports = { cancelStalePendingOrders, closeExpiredVirtualAccounts, checkRestockNeeded, sendMonthlySettlement };
