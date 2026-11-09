/* 관리자 주문 목록·내보내기·일괄 수정·상태 변경 — server.js에서 분리(2026-11-09, 동작 변경 없음). */
const express = require("express");
const { COURIERS } = require("../../소스 코드/assets/js/data.js");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");

const { claimCouponUsage } = require("../lib/coupons");
const { paginationParams } = require("../lib/pagination");
const { toCsv, toXlsxBuffer, toPdfBuffer } = require("../lib/orderExport");
const { applyKstDateRangeFilter } = require("../lib/kst");
const { restoreItemsFromOrder } = require("../lib/inventory");
const { logAdminAction, logInventoryChange, logSystemError } = require("../lib/adminLog");
const { isMissingColumnError, extractMissingColumnName } = require("../lib/pgErrors");
const { updateWithOptionalColumnFallback } = require("../lib/dbUpdate");
const { applyOrderCancelSideEffects } = require("../lib/orderCancel");
const { loadPreviousRefunds, refundedQtyByIndex } = require("../lib/refunds");
const { hasAreaPermission } = require("../lib/adminGuard");
const { ASSIGNEE_NOTE_OPTIONAL_COLUMNS } = require("../lib/dbUpdate");
const { PENDING_CANCEL_HOURS } = require("../lib/orderRules");
const { notifyOrderStatusSideEffects } = require("../lib/orderNotify");
const { serializeByOrder } = require("../lib/orderLock");

const router = express.Router();

/* ---------- 관리자 ---------- */
/* 필터: q(주문번호·주문자명·연락처·이메일 중 아무 데나 부분 일치) · status(정확히 일치) ·
   dateFrom/dateTo(그 날짜의 KST 00:00~23:59:59, YYYY-MM-DD). q는 PostgREST의 or 필터로
   네 컬럼(주소값은 jsonb라 ->> 로 텍스트 추출)을 한 번에 검색한다. 이메일 검색은 2026-09-01에
   추가 — "회원 계정 관리" 탭에서 특정 회원의 주문 내역으로 바로 넘어올 수 있게 하려면 이메일로도
   찾아져야 했다(works/js/members.js의 "주문 보기" 참고).
   목록(GET /api/admin/orders)과 내보내기(GET /api/admin/orders/export)가 이 로직을 공유한다. */
function applyOrderFilters(query, reqQuery, requestUserId) {
  const { q, status, dateFrom, dateTo, assignedTo } = reqQuery;
  if (q) {
    const v = String(q).trim().slice(0, 60).replace(/[%,()]/g, "");
    if (v) query = query.or(`order_no.ilike.%${v}%,customer->>name.ilike.%${v}%,customer->>tel.ilike.%${v}%,customer->>email.ilike.%${v}%`);
  }
  if (status) query = query.eq("status", status);
  // "내 담당 건만 보기" — assignedTo=me면 지금 로그인한 관리자 id로, 그 외 값이면 그 id로 정확히 일치.
  if (assignedTo === "me" && requestUserId) query = query.eq("assigned_to", requestUserId);
  else if (assignedTo) query = query.eq("assigned_to", assignedTo);
  query = applyKstDateRangeFilter(query, "created_at", dateFrom, dateTo);
  return query;
}

/* 목록/내보내기 둘 다 결제수단·쿠폰·적립금·가상계좌 정보를 같이 보여줘야 하는데, 적립금·
   가상계좌 컬럼(034/035)은 그 마이그레이션을 아직 안 돌린 배포엔 없을 수 있다 —
   insertOrderRow와 같은 원칙으로, 없는 컬럼만 하나씩 빼며 재조회한다("주문 목록 자체가
   결제수단도 안 보여준다"던 감사 지적을 고치면서, 마이그레이션 미실행 배포에서 주문 목록
   자체가 통째로 죽는 새 사고를 만들면 안 되므로). payment_method/coupon_code/discount는
   013 이후 오래전부터 있던 기본 컬럼이라 폴백 대상에 넣지 않는다. */
const ADMIN_ORDER_LIST_BASE_COLUMNS =
  "order_no, customer, items, subtotal, shipping, total, status, courier, tracking_no, created_at, payment_method, coupon_code, discount";
const ADMIN_ORDER_LIST_OPTIONAL_COLUMNS = [
  "points_used", "points_earned",
  "virtual_account_bank", "virtual_account_number", "virtual_account_holder", "virtual_account_due_at",
  "assigned_to", "internal_note",
  "refunded_amount", "shipped_at", "delivered_at", "confirmed_at",
];

async function selectOrdersWithFallback(buildQuery) {
  let columns = [ADMIN_ORDER_LIST_BASE_COLUMNS, ...ADMIN_ORDER_LIST_OPTIONAL_COLUMNS];
  let result = await buildQuery(columns);
  for (let i = 0; i < ADMIN_ORDER_LIST_OPTIONAL_COLUMNS.length && isMissingColumnError(result.error); i++) {
    const named = extractMissingColumnName(result.error);
    const col = named && columns.includes(named) ? named : ADMIN_ORDER_LIST_OPTIONAL_COLUMNS.find((c) => columns.includes(c));
    if (!col) break;
    console.warn(`[admin/orders] '${col}' 컬럼 없음(마이그레이션 미실행) — ${col} 없이 재조회`);
    columns = columns.filter((c) => c !== col);
    result = await buildQuery(columns);
  }
  return result;
}

function mapAdminOrderRow(o) {
  return {
    no: o.order_no,
    at: o.created_at,
    customer: o.customer,
    items: o.items,
    subtotal: o.subtotal,
    shipping: o.shipping,
    total: o.total,
    status: o.status,
    courier: o.courier || null,
    trackingNo: o.tracking_no || null,
    paymentMethod: o.payment_method || null,
    couponCode: o.coupon_code || null,
    discount: o.discount || 0,
    pointsUsed: o.points_used || 0,
    pointsEarned: o.points_earned || 0,
    virtualAccount: o.virtual_account_bank
      ? {
          bank: o.virtual_account_bank,
          number: o.virtual_account_number,
          holder: o.virtual_account_holder,
          dueAt: o.virtual_account_due_at,
        }
      : null,
    assignedTo: o.assigned_to || null,
    internalNote: o.internal_note || null,
    refundedAmount: o.refunded_amount || 0,
    shippedAt: o.shipped_at || null,
    deliveredAt: o.delivered_at || null,
    confirmedAt: o.confirmed_at || null,
  };
}

router.get("/api/admin/orders", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query);

  const { data, error, count } = await selectOrdersWithFallback((columns) => {
    let query = supabaseAdmin
      .from("orders")
      .select(columns.join(", "), { count: "exact" })
      .order("created_at", { ascending: false });
    query = applyOrderFilters(query, req.query, req.user.id);
    return query.range(from, to);
  });

  if (error) return res.status(500).json({ error: "주문 목록을 불러오지 못했습니다." });

  res.json({
    items: data.map(mapAdminOrderRow),
    page,
    pageSize,
    total: count ?? data.length,
  });
});

/* 주문 목록 내보내기 — 화면의 검색·필터 조건을 그대로 받아(위 applyOrderFilters 재사용)
   페이지네이션 없이 최대 EXPORT_MAX_ROWS건까지 한 번에 뽑는다. ?format=csv|xlsx|pdf. */
const EXPORT_MAX_ROWS = 5000;
router.get("/api/admin/orders/export", requireAdmin, async (req, res) => {
  const format = String(req.query.format || "csv").toLowerCase();
  if (!["csv", "xlsx", "pdf"].includes(format)) {
    return res.status(400).json({ error: "format은 csv, xlsx, pdf 중 하나여야 합니다." });
  }

  const { data, error } = await selectOrdersWithFallback((columns) => {
    let query = supabaseAdmin
      .from("orders")
      .select(columns.join(", "))
      .order("created_at", { ascending: false })
      .limit(EXPORT_MAX_ROWS);
    query = applyOrderFilters(query, req.query, req.user.id);
    return query;
  });
  if (error) return res.status(500).json({ error: "주문 목록을 불러오지 못했습니다." });

  const filename = `reiten-orders-${require("./lib/kst").kstDateKey(new Date())}`;
  try {
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
      res.send(toCsv(data));
    } else if (format === "xlsx") {
      const buf = await toXlsxBuffer(data);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
      res.send(Buffer.from(buf));
    } else {
      const buf = await toPdfBuffer(data);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
      res.send(buf);
    }
    logAdminAction(req, "order.export", "order", "export", { format, count: data.length, q: req.query.q || null });
  } catch (e) {
    console.error("[admin/orders/export] 생성 실패:", e.message);
    res.status(500).json({ error: "내보내기 파일 생성에 실패했습니다." });
  }
});

const ORDER_BULK_MAX = 200;

/* 여러 주문의 상태·배송정보를 한 번에 저장한다(운송장번호 CSV 일괄 입력, 입금확인 일괄 처리
   용도). 건별 PATCH와 달리 "취소"는 여기서 지원하지 않는다 — 취소는 재고 복원·카드 환불이
   자동으로 나가는 민감한 동작이라, 실수로 여러 건을 한꺼번에 취소·환불해버리는 사고를
   구조적으로 막기 위해 일부러 뺐다(취소는 계속 건별로만 가능). 이미 취소된 주문을 되돌리는
   것도 같은 이유로 여기선 막는다. 항목 하나가 실패해도 나머지는 계속 처리하고, 결과를
   항목별로 돌려준다(CSV에 오타가 섞여 있어도 나머지는 정상 처리되게).
   ⚠️ 반드시 아래 `/:no` 라우트보다 먼저 등록해야 한다 — Express는 `:no`가 슬래시 없는 문자열이면
   "bulk"도 그대로 흡수해버려서(2026-09-01 코드 감사에서 발견, 상품 일괄 처리와 같은 원인의
   버그), 순서가 뒤바뀌면 이 라우트가 죽은 코드가 된다. */
router.patch("/api/admin/orders/bulk", requireAdmin, async (req, res) => {
  const items = Array.isArray(req.body?.orders) ? req.body.orders : [];
  if (!items.length) return res.status(400).json({ error: "orders가 필요합니다." });
  if (items.length > ORDER_BULK_MAX) {
    return res.status(400).json({ error: `한 번에 최대 ${ORDER_BULK_MAX}건까지 처리할 수 있습니다.`, i18n: { key: "한 번에 최대 {n}건까지 처리할 수 있습니다.", vars: { n: ORDER_BULK_MAX } } });
  }

  const results = [];
  for (const item of items) {
    const orderNo = String(item?.orderNo || "").trim();
    if (!orderNo) {
      results.push({ orderNo: null, ok: false, error: "orderNo가 필요합니다." });
      continue;
    }

    const patch = {};
    if (item.status !== undefined) {
      const statusStr = String(item.status).trim();
      if (!statusStr) {
        results.push({ orderNo, ok: false, error: "status가 비어 있습니다." });
        continue;
      }
      if (statusStr === "취소") {
        results.push({ orderNo, ok: false, error: "일괄 처리에서는 취소를 지원하지 않습니다 — 개별로 처리해 주세요." });
        continue;
      }
      patch.status = statusStr;
    }
    if (item.courier !== undefined) {
      const courierStr = String(item.courier || "").trim();
      if (courierStr && !COURIERS.some((c) => c.key === courierStr)) {
        results.push({ orderNo, ok: false, error: "존재하지 않는 택배사입니다." });
        continue;
      }
      patch.courier = courierStr || null;
    }
    if (item.trackingNo !== undefined) {
      patch.tracking_no = String(item.trackingNo || "").trim().slice(0, 60) || null;
    }
    if (!Object.keys(patch).length) {
      results.push({ orderNo, ok: false, error: "변경할 값이 없습니다." });
      continue;
    }

    const { data: prev } = await supabaseAdmin.from("orders").select("status, tracking_no, payment_method").eq("order_no", orderNo).maybeSingle();
    if (!prev) {
      results.push({ orderNo, ok: false, error: "존재하지 않는 주문입니다." });
      continue;
    }
    if (prev.status === "취소") {
      results.push({ orderNo, ok: false, error: "이미 취소된 주문은 일괄 처리로 되돌릴 수 없습니다 — 개별로 처리해 주세요." });
      continue;
    }
    if (patch.status === "입금대기" && (prev.status !== "입금대기" || prev.payment_method === "card")) {
      results.push({ orderNo, ok: false, error: "결제가 확인된 주문은 입금대기로 되돌릴 수 없습니다." });
      continue;
    }
    if (patch.status !== undefined && !ORDER_STATUS_VALUES.includes(patch.status)) {
      results.push({ orderNo, ok: false, error: "올바르지 않은 주문 상태입니다." });
      continue;
    }
    {
      const rank = { 입금대기: 0, 입금확인: 1, 배송중: 2, 완료: 3 };
      if (patch.status !== undefined && rank[patch.status] < rank[prev.status] && !(prev.status === "완료" && patch.status === "배송중")) {
        results.push({ orderNo, ok: false, error: "주문을 이전 단계로 되돌릴 수 없습니다." });
        continue;
      }
    }

    if ((patch.status === "배송중" && prev.status !== "배송중" && !prev.tracking_no) || (patch.tracking_no && !prev.tracking_no && prev.status !== "배송중")) {
      patch.shipped_at = new Date().toISOString();
    }
    if (patch.status === "완료" && prev.status !== "완료") patch.delivered_at = new Date().toISOString(); // 배송완료 기록 → 7일 뒤 자동 구매확정
    const { data: saved, error } = await updateWithOptionalColumnFallback("orders", "order_no", orderNo, patch, ["shipped_at", "delivered_at"]);
    if (error || !saved) {
      results.push({ orderNo, ok: false, error: "저장에 실패했습니다." });
      continue;
    }

    await notifyOrderStatusSideEffects(prev, saved, patch);
    results.push({ orderNo, ok: true });
  }

  const successCount = results.filter((r) => r.ok).length;
  logAdminAction(req, "order.bulk_update", "order", `${successCount}/${items.length}건`, { results });
  res.json({ ok: true, results });
});

/* status만 바꾸면 상태만, courier/trackingNo를 함께 보내면 배송정보도 같이 저장한다.
   status가 "입금확인"으로 바뀌는 순간에만 고객에게 입금 확인 메일을 보낸다(접수 메일은 /api/order에서 이미 발송됨).
   status가 (처음으로) "취소"가 되는 순간에는 미입금 자동취소·반품승인환불과 같은 원칙으로
   ① 재고 복원 ② 카드결제 건이면 포트원 환불 자동 시도 ③ 고객 안내 메일까지 한 번에 처리한다
   (cancelReason은 선택 — 입력하면 사유가 저장되고 고객 메일에도 그대로 노출됨). */
const ORDER_STATUS_VALUES = ["입금대기", "입금확인", "배송중", "완료", "취소"];
router.patch("/api/admin/orders/:no", requireAdmin, serializeByOrder((req) => req.params.no, async (req, res) => {
  const { status, courier, trackingNo, cancelReason, assignedTo, internalNote, expected } = req.body || {};

  const patch = {};
  if (status !== undefined) {
    const statusStr = String(status).trim();
    if (!statusStr) return res.status(400).json({ error: "status가 비어 있습니다." });
    patch.status = statusStr;
  }
  if (courier !== undefined) {
    const courierStr = String(courier || "").trim();
    if (courierStr && !COURIERS.some((c) => c.key === courierStr)) {
      return res.status(400).json({ error: "존재하지 않는 택배사입니다." });
    }
    patch.courier = courierStr || null;
  }
  if (trackingNo !== undefined) {
    patch.tracking_no = String(trackingNo || "").trim().slice(0, 60) || null;
  }
  if (assignedTo !== undefined) {
    patch.assigned_to = assignedTo || null;
  }
  if (internalNote !== undefined) {
    patch.internal_note = String(internalNote || "").trim().slice(0, 2000) || null;
  }
  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: "변경할 값이 없습니다." });
  }

  /* 이번 변경으로 운송장번호가 "처음" 채워지는지, 취소 상태가 "처음" 되는지 판단하려면
     update 직전의 이전 상태가 필요하다. 존재하지 않는 주문번호(오타 등)를 여기서 걸러내지
     않으면 아래 update()가 0건 매칭으로 실패해 "저장에 실패했습니다"(500)라는 엉뚱한 에러가
     나간다 — 반품 라우트(PATCH /api/admin/returns/:id)와 같은 원칙으로 404를 먼저 확인한다
     (2026-09-01 코드 감사에서 발견). */
  const { data: prev, error: prevError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("order_no", req.params.no)
    .single();
  if (prevError || !prev) return res.status(404).json({ error: "존재하지 않는 주문입니다." });

  /* 낙관적 잠금 — 화면이 열려 있던 사이 다른 관리자가 같은 주문의 상태·운송장을 바꿨다면
     조용히 덮어쓰지 않고 409로 막는다(expected는 저장 직전 화면이 알고 있던 값). */
  if (expected && typeof expected === "object") {
    const changedStatus = expected.status !== undefined && String(expected.status) !== String(prev.status);
    const changedTracking = expected.trackingNo !== undefined && String(expected.trackingNo || "") !== String(prev.tracking_no || "");
    if (changedStatus || changedTracking) {
      return res.status(409).json({ error: "다른 관리자가 이 주문을 방금 수정했습니다. 목록을 새로고침해서 최신 내용을 확인한 뒤 다시 저장해 주세요.", code: "STALE", current: { status: prev.status, trackingNo: prev.tracking_no || "" } });
    }
  }

  const cancelReasonStr = cancelReason ? String(cancelReason).trim().slice(0, 300) : "";
  const isNewCancel = patch.status === "취소" && prev.status !== "취소";
  /* 상태값·흐름 검사(2026-10-28 정기 감사, API 실행 테스트로 확인):
     ① 정해진 다섯 상태만 받는다(그 밖의 값은 DB 제약에 걸려 "저장 실패" 500이 났다)
     ② 앞 단계로 되돌리기 금지 — 배송중·완료 → 입금확인으로 되돌리면 "입금 확인" 메일·적립 예정액 계산이 다시 돌고
        (부분 취소로 줄어든 적립 예정액이 원래대로 부풀어 구매확정 때 더 지급됨), 반품 환불 후 "취소" 금지 검사도 피해 갔다.
        배송 처리를 잘못 누른 경우만 고려해 완료 → 배송중은 허용한다. 취소 → 다른 상태(되돌리기)는 아래에서 따로 검사. */
  if (patch.status !== undefined && !ORDER_STATUS_VALUES.includes(patch.status)) {
    return res.status(400).json({ error: "올바르지 않은 주문 상태입니다.", code: "INVALID_STATUS" });
  }
  if (patch.status !== undefined && prev.status !== "취소" && patch.status !== "취소" && patch.status !== prev.status) {
    const rank = { 입금대기: 0, 입금확인: 1, 배송중: 2, 완료: 3 };
    const backward = rank[patch.status] < rank[prev.status];
    if (backward && !(prev.status === "완료" && patch.status === "배송중") && patch.status !== "입금대기") {
      return res.status(400).json({ error: "주문을 이전 단계로 되돌릴 수 없습니다.", code: "INVALID_STATUS_BACK" });
    }
  }
  // 환불까지 끝난 결제 주문(카드·가상계좌 또는 환불 기록 있음)을 되살리는 것도 돈이 걸린 처리라 환불 권한이 필요하다
  if (prev.status === "취소" && patch.status !== undefined && patch.status !== "취소") {
    const moneyMoved = prev.payment_method === "card" || prev.payment_method === "virtual_account" || Number(prev.refunded_amount) > 0;
    if (moneyMoved && !(await hasAreaPermission(req, "refunds"))) {
      return res.status(403).json({ error: "'환불·주문취소' 권한이 없어 환불된 주문을 되돌릴 수 없습니다. 마스터 관리자에게 문의하세요.", code: "FORBIDDEN_AREA", area: "refunds" });
    }
  }
  /* 입금된 주문을 "입금대기"로 되돌리는 건 막는다 — 되돌린 뒤 취소하면 "입금 전 취소"로 보여 환불 권한 검사를
     건너뛰면서도 카드는 전액 환불됐다(2026-10-28 정기 감사). 카드결제는 처음부터 결제된 주문이라 항상 막는다. */
  if (patch.status === "입금대기" && prev.status !== "입금대기" && (prev.status !== "취소" || prev.payment_method === "card")) {
    return res.status(400).json({ error: "결제가 확인된 주문은 입금대기로 되돌릴 수 없습니다.", code: "INVALID_STATUS_BACK" });
  }
  // 입금된 주문을 취소하면 환불이 나가므로 "환불·주문취소" 권한이 따로 필요하다(입금 전 무통장 취소는 주문 권한만으로 가능).
  if (isNewCancel && (prev.status !== "입금대기" || prev.payment_method === "card") && !(await hasAreaPermission(req, "refunds"))) {
    return res.status(403).json({ error: "'환불·주문취소' 권한이 없어 입금된 주문을 취소할 수 없습니다. 마스터 관리자에게 문의하세요.", code: "FORBIDDEN_AREA", area: "refunds" });
  }
  /* 반대 방향(취소 → 다른 상태로 되돌림)도 대칭으로 처리해야 한다 — 안 하면 취소 시
     복원됐던 재고가 그대로 부풀려진 채 남는다(관리자가 실수로 취소했다가 바로 되돌리는
     경우 등). */
  const isUncancel = prev.status === "취소" && patch.status !== undefined && patch.status !== "취소";
  /* 입금 기한이 지난 주문을 "입금대기"로 되돌리면 다음 자동취소 크론이 곧바로 다시 취소해 버린다(고객에게 취소 메일이 또
     가고 적립금·재고가 다시 처리됨). 가상계좌는 취소 때 계좌가 이미 닫혀 입금도 못 받는다. 입금이 확인됐다면
     "입금확인"으로 되돌리면 된다(2026-10-28 정기 감사). */
  if (isUncancel && patch.status === "입금대기") {
    const { data: full } = await supabaseAdmin.from("orders").select("created_at, payment_method").eq("order_no", req.params.no).maybeSingle();
    const expired = full && Date.now() - new Date(full.created_at).getTime() > PENDING_CANCEL_HOURS * 3600 * 1000;
    if (full && (full.payment_method === "virtual_account" || expired)) {
      return res.status(400).json({ error: "입금 기한이 지났거나 가상계좌 주문이라 입금대기로 되돌릴 수 없습니다. 입금을 확인했다면 입금확인으로 되돌려 주세요.", code: "UNCANCEL_EXPIRED" });
    }
  }
  /* 취소 사유는 취소되는 그 순간 항상 명시적으로 반영하고(안 적었으면 null), 되돌릴 때는
     지운다 — 안 그러면 "취소(사유 있음) → 되돌리기 → 사유 없이 재취소"에서 첫 번째 취소
     사유가 stale로 그대로 남는 버그가 생긴다(2026-09-01 코드 감사에서 발견). 예전엔
     `isNewCancel && cancelReasonStr`일 때만 값을 넣어서, 두 번째 취소에서 사유를 안 적으면
     patch에 cancel_reason 자체가 안 들어가 DB에 예전 값이 그대로 남아 있었다. */
  if (isNewCancel) patch.cancel_reason = cancelReasonStr || null;
  if (isUncancel) patch.cancel_reason = null;

  /* 이미 반품·부분 취소 환불이 있는 출고 후 주문은 "취소"로 처리하지 않는다 — 취소는 남은 금액 전부(차감한 반품 배송비
     포함)를 환불하고, 불량이라 재고 복원을 안 한 상품까지 재고로 되돌렸다(2026-10-28 정기 감사). */
  const { rows: prevRefunds } = await loadPreviousRefunds(supabaseAdmin, req.params.no);
  if (isNewCancel && (prev.status === "배송중" || prev.status === "완료") && prevRefunds.length) {
    return res.status(409).json({ error: "반품 환불을 처리한 출고 주문은 취소할 수 없습니다. 남은 상품은 반품 환불로 처리해 주세요.", code: "HAS_REFUNDS" });
  }

  // 처음 배송이 시작되는 순간(배송중 전환 또는 첫 운송장 입력)을 기록 — 며칠 뒤 리뷰 요청 메일 기준(041)
  if ((patch.status === "배송중" && prev.status !== "배송중" && !prev.tracking_no) || (patch.tracking_no && !prev.tracking_no && prev.status !== "배송중")) {
    patch.shipped_at = new Date().toISOString();
  }
  // 관리자가 직접 "완료"로 바꾸는 순간을 배송완료로 기록한다(배송조회 키가 없을 때의 기준) → 7일 뒤 자동 구매확정.
  if (patch.status === "완료" && prev.status !== "완료") patch.delivered_at = new Date().toISOString();
  const { data: saved, error } = await updateWithOptionalColumnFallback("orders", "order_no", req.params.no, patch, [...ASSIGNEE_NOTE_OPTIONAL_COLUMNS, "shipped_at", "delivered_at"]);

  if (error || !saved) return res.status(500).json({ error: "저장에 실패했습니다." });

  await notifyOrderStatusSideEffects(prev, saved, patch);

  let cancelResult = null;
  if (isNewCancel) {
    // 관리자 주문취소와 고객 "주문취소 신청" 승인이 같은 후속 처리를 쓴다(applyOrderCancelSideEffects).
    cancelResult = await applyOrderCancelSideEffects(saved, prev.status, cancelReasonStr);
  }

  let uncancelResult = null;
  if (isUncancel) {
    // 부분 취소·반품으로 이미 환불한 수량은 다시 출고할 게 아니므로 빼고 재고를 다시 잡는다(2026-10-28 정기 감사).
    const refundedQty = refundedQtyByIndex(prevRefunds);
    const decrementItems = restoreItemsFromOrder(
      (saved.items || []).map((it, i) => ({ ...it, qty: (Number(it.qty) || 0) - (refundedQty.get(i) || 0) })).filter((it) => it.qty > 0)
    );
    if (decrementItems.length) {
      const { error: decError } = await supabaseAdmin.rpc("decrement_inventory", { p_items: decrementItems });
      if (decError) {
        /* 취소 때 복원된 재고가 그 사이 다른 주문에 이미 팔렸을 수 있다(품절) — 이 경우
           되돌리기 자체를 막지는 않는다(관리자가 이미 상태를 바꾸기로 결정한 것이므로),
           대신 재고가 마이너스로 안 꺾이게 막혔다는 걸 시스템 오류로 남겨 수동 확인을 유도한다. */
        console.error("[admin/orders] 취소 되돌리기 시 재고 재차감 실패 — 수동 확인 필요:", saved.order_no, decError.message);
        logSystemError("order_uncancel_inventory_conflict", { orderNo: saved.order_no, error: decError.message });
        uncancelResult = { inventoryRestored: false };
      } else {
        logInventoryChange(
          decrementItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: -it.qty, reason: "admin_uncancel", ref: saved.order_no }))
        );
        uncancelResult = { inventoryRestored: true };
      }
    }
    if (saved.payment_method === "card" && saved.payment_id) {
      /* 취소 시 이미 포트원 환불이 나갔다면, API로 자동 재청구(un-refund)는 할 수 없다 —
         결제를 되돌리려면 고객에게 새로 결제를 받아야 한다. 조용히 넘어가면 관리자가
         "상태만 되돌리면 결제도 같이 산다"고 착각할 수 있어 시스템 오류로 남긴다. */
      logSystemError("order_uncancelled_card_payment_not_restored", { orderNo: saved.order_no, paymentId: saved.payment_id });
      uncancelResult = { ...(uncancelResult || {}), paymentNote: "card_refund_not_reversible" };
    }
    /* 되돌린 주문의 적립금을 취소 전 상태로 맞춘다 — 사용한 적립금은 다시 차감하고, 구매확정돼 이미 받은 적립금은
       다시 준다(부분 환불 때 돌려준·회수한 몫 반영). 취소 땐 이 주문 원장 합계를 0으로 맞췄으므로 목표값과의 차이만 넣는다
       (2026-10-28 정기 감사 — 예전엔 사용분만 다시 빼서 받은 적립금이 사라지고, 나중 반품 때 또 회수됐다). */
    if (saved.user_id && (Number(saved.points_used) > 0 || Number(saved.points_earned) > 0)) {
      const restoredByRefunds = prevRefunds.reduce((sum, r) => sum + (Number(r.points_restored) || 0), 0);
      const reclaimedByRefunds = prevRefunds.reduce((sum, r) => sum + (Number(r.points_reclaimed) || 0), 0);
      const { data: ledger } = await supabaseAdmin
        .from("loyalty_points_ledger")
        .select("delta, reason")
        .eq("order_no", saved.order_no)
        .in("reason", ["earn_purchase", "redeem_order", "refund_reversal"]);
      const net = (ledger || []).reduce((sum, r) => sum + (Number(r.delta) || 0), 0);
      const earnedCredited = (ledger || []).filter((r) => r.reason === "earn_purchase").reduce((sum, r) => sum + (Number(r.delta) || 0), 0);
      const target = -Math.max(0, Number(saved.points_used || 0) - restoredByRefunds) + (saved.confirmed_at ? Math.max(0, earnedCredited - reclaimedByRefunds) : 0);
      const delta = target - net;
      if (delta !== 0) {
        const { error: ledgerErr } = await supabaseAdmin
          .from("loyalty_points_ledger")
          .insert({ user_id: saved.user_id, order_no: saved.order_no, delta, reason: "refund_reversal" });
        if (ledgerErr) console.error("[admin/orders] 취소 되돌리기 시 적립금 복원 실패:", saved.order_no, ledgerErr.message);
        else uncancelResult = { ...(uncancelResult || {}), pointsAdjusted: delta };
      }
    }
    // 취소 때 "결제 전액 환불"로 기록한 환불액을 실제 환불 기록 합계로 되돌린다 — 안 하면 이후 반품 환불이 "최대 0원"으로 막혔다
    {
      const refundedSum = prevRefunds.reduce((sum, r) => sum + (Number(r.refund_amount) || 0), 0);
      const { error: raErr } = await supabaseAdmin.from("orders").update({ refunded_amount: refundedSum }).eq("order_no", saved.order_no);
      if (raErr && !isMissingColumnError(raErr)) console.error("[admin/orders] 환불액 되돌리기 실패:", raErr.message);
    }
    // 자동·관리자 취소 때 돌려준 쿠폰 사용 횟수를 다시 차지한다(1회용 쿠폰을 또 쓰지 못하게)
    if (saved.coupon_code) {
      const claimed = await claimCouponUsage(supabaseAdmin, saved.coupon_code);
      if (!claimed) logSystemError("coupon_usage_exceeded", { couponCode: saved.coupon_code, orderNo: saved.order_no, stage: "uncancel" });
    }
  }

  logAdminAction(req, "order.update", "order", req.params.no, patch);
  res.json({ ok: true, cancel: cancelResult, uncancel: uncancelResult });
}));

module.exports = router;
