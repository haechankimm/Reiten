/* 고객 주문 조회·구매확정·반품/교환/취소 신청 — server.js에서 분리(2026-11-09, 동작 변경 없음). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAuth, optionalAuth } = require("../lib/auth");

const { writeLimiter, lookupLimiter } = require("../lib/rateLimiters");
const { isMissingColumnError } = require("../lib/pgErrors");
const { normalizeTel } = require("../lib/phone");
const { confirmationEnabled, canConfirm, confirmOrder, hasOpenReturnRequest } = require("../lib/purchaseConfirm");
const { toCustomerOrderDto } = require("../lib/customerOrders");

const router = express.Router();

/* ---------- 비회원 주문 조회 (주문번호 + 연락처) ---------- */
router.post("/api/orders/lookup", lookupLimiter, async (req, res) => {
  const { orderNo: reqOrderNo, tel } = req.body || {};
  const orderNoStr = String(reqOrderNo || "").trim();
  const telDigits = normalizeTel(tel);

  if (!orderNoStr || !telDigits) {
    return res.status(400).json({ error: "주문번호와 연락처를 입력해 주세요." });
  }

  // select("*") — 쿠폰·적립금·환불·구매확정 컬럼은 마이그레이션 시점에 따라 없을 수 있어 *로 받고 DTO에서 고른다.
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("order_no", orderNoStr)
    .maybeSingle();

  if (error) {
    console.error("[orders/lookup] 조회 실패:", error.message);
    return res.status(500).json({ error: "조회 중 오류가 발생했습니다." });
  }

  // 주문이 없거나 연락처가 일치하지 않으면 어느 쪽이 틀렸는지 알려주지 않는다.
  if (!data || normalizeTel(data.customer.tel) !== telDigits) {
    return res.status(404).json({ error: "일치하는 주문을 찾을 수 없습니다. 주문번호와 연락처를 다시 확인해 주세요." });
  }

  res.json(toCustomerOrderDto(data));
});

/* ---------- 회원 주문내역 ---------- */
router.get("/api/my/orders", requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[my/orders] 조회 실패:", error.message);
    return res.status(500).json({ error: "주문내역을 불러오지 못했습니다." });
  }

  res.json(data.map(toCustomerOrderDto));
});

/* ---------- 구매확정(고객) ----------
   주문조회(비회원: 주문번호+연락처)나 내 주문(회원: 로그인)에서 "구매확정"을 누르면 바로 확정하고 적립금을
   지급한다. 안 눌러도 배송완료 7일(배송완료 기록이 없으면 출고 14일) 뒤 자동 확정(lib/purchaseConfirm.js). */
router.post("/api/orders/confirm", optionalAuth, lookupLimiter, async (req, res) => {
  const { orderNo: reqOrderNo, tel } = req.body || {};
  const orderNoStr = String(reqOrderNo || "").trim();
  if (!orderNoStr) return res.status(400).json({ error: "주문번호가 필요합니다." });
  const { data: order } = await supabaseAdmin.from("orders").select("*").eq("order_no", orderNoStr).maybeSingle();
  const ownsByLogin = !!(order && req.user && order.user_id && order.user_id === req.user.id);
  const ownsByTel = !!(order && normalizeTel(tel) && normalizeTel(order.customer && order.customer.tel) === normalizeTel(tel));
  if (!order || (!ownsByLogin && !ownsByTel)) {
    return res.status(404).json({ error: "일치하는 주문을 찾을 수 없습니다. 주문번호와 연락처를 다시 확인해 주세요." });
  }
  if (!(await confirmationEnabled())) return res.status(503).json({ error: "지금은 구매확정을 할 수 없습니다. 잠시 후 다시 시도해 주세요." });
  if (!canConfirm(order)) {
    return res.status(409).json({ error: order.confirmed_at ? "이미 구매확정된 주문입니다." : "배송이 시작된 주문만 구매확정할 수 있습니다." });
  }
  // 반품·교환 처리 중에는 직접 구매확정도 막는다(자동 확정과 같은 기준 — 적립 후 반품 악용 방지, 2026-10-28)
  if (await hasOpenReturnRequest(supabaseAdmin, order.order_no)) {
    return res.status(409).json({ error: "반품·교환 신청이 처리 중이라 지금은 구매확정할 수 없습니다.", code: "RETURN_IN_PROGRESS" });
  }
  const result = await confirmOrder(order);
  if (!result.ok) return res.status(result.already ? 409 : 500).json({ error: result.already ? "이미 구매확정된 주문입니다." : "구매확정에 실패했습니다." });
  res.json({ ok: true, confirmedAt: result.confirmedAt, pointsCredited: result.pointsCredited });
});

/* ---------- 반품 · 교환 · 주문취소 신청 ----------
   반품/교환(request_type='return'|'exchange')과 주문취소 신청(request_type='cancel',
   order-lookup.html)이 같은 테이블·같은 검증 로직을 쓴다(033_cancel_requests.sql) — 둘 다
   "고객이 주문번호+연락처로 본인 확인 후 사유를 남기면 관리자가 처리한다"는 흐름이 동일해서
   테이블을 분리하면 admin 목록·통계를 두 곳에서 따로 유지보수해야 하는 부담만 늘어난다.
   reason은 프리셋 중 하나(예: "단순변심", "기타")이고, "기타"를 고르면 customReason에 고객이
   직접 입력한 텍스트가 들어간다(사유 자체는 "기타"로 남겨 통계 카테고리가 잘게 안 쪼개짐). */
router.post("/api/returns", optionalAuth, writeLimiter, async (req, res) => {
  const { orderNo: reqOrderNo, contactName, contactTel, reason, detail, requestType, customReason } = req.body || {};

  const orderNoStr = String(reqOrderNo || "").trim();
  const nameStr = String(contactName || "").trim().slice(0, 40);
  const telStr = String(contactTel || "").trim().slice(0, 20);
  const reasonStr = String(reason || "").trim().slice(0, 40);
  const detailStr = String(detail || "").trim().slice(0, 1000);
  const requestTypeStr = ["return", "exchange", "cancel"].includes(requestType) ? requestType : "return";
  const customReasonStr = String(customReason || "").trim().slice(0, 300);

  if (!orderNoStr || !nameStr || !telStr || !reasonStr) {
    return res.status(400).json({ error: "주문번호·이름·연락처·사유를 모두 입력해 주세요." });
  }
  if (reasonStr === "기타" && !customReasonStr) {
    return res.status(400).json({ error: "'기타'를 선택했다면 사유를 직접 입력해 주세요." });
  }

  /* 주문번호+연락처가 실제 주문과 일치하는지 확인한다(/api/orders/lookup, 리뷰 실구매 인증과
     같은 원칙) — 이게 없으면 존재하지 않는 주문번호나 남의 주문번호로도 반품 신청이 쌓여서
     관리자가 매번 수작업으로 걸러야 했다. */
  const { data: orderRow, error: orderLookupError } = await supabaseAdmin
    .from("orders")
    .select("order_no, customer, status")
    .eq("order_no", orderNoStr)
    .maybeSingle();
  if (orderLookupError) {
    console.error("[returns] 주문 확인 실패:", orderLookupError.message);
    return res.status(500).json({ error: "주문 확인 중 오류가 발생했습니다." });
  }
  if (!orderRow || normalizeTel(orderRow.customer.tel) !== normalizeTel(telStr)) {
    return res.status(404).json({ error: "일치하는 주문을 찾을 수 없습니다. 주문번호와 연락처를 다시 확인해 주세요." });
  }
  /* 주문 상태에 맞는 신청만 받는다(2026-10-28 정기 감사 — 취소된 주문에 취소 신청, 입금 전 주문에 반품 신청이 그대로
     접수됐다): 주문취소는 출고 전(입금대기·입금확인), 반품·교환은 출고 후(배송중·완료). 같은 종류 신청이 처리 중이면 중복 접수 안 함. */
  const st = orderRow.status;
  if (requestTypeStr === "cancel" && !(st === "입금대기" || st === "입금확인")) {
    return res.status(409).json({ error: st === "취소" ? "이미 취소된 주문입니다." : "이미 출고된 주문은 취소 대신 반품으로 신청해 주세요.", code: "INVALID_ORDER_STATE" });
  }
  if (requestTypeStr !== "cancel" && !(st === "배송중" || st === "완료")) {
    return res.status(409).json({ error: st === "취소" ? "이미 취소된 주문입니다." : "출고 전 주문은 반품·교환 대신 주문취소로 신청해 주세요.", code: "INVALID_ORDER_STATE" });
  }
  {
    const { data: openReqs } = await supabaseAdmin.from("return_requests").select("id, status, request_type").eq("order_no", orderNoStr);
    const dup = (openReqs || []).some((r) => (r.request_type || "return") === requestTypeStr && r.status !== "완료" && r.status !== "반려");
    if (dup) return res.status(409).json({ error: "이미 접수된 신청이 처리 중입니다. 처리 결과를 기다려 주세요.", code: "DUPLICATE_REQUEST" });
  }

  let { data, error } = await supabaseAdmin
    .from("return_requests")
    .insert({
      order_no: orderNoStr,
      user_id: req.user ? req.user.id : null,
      contact_name: nameStr,
      contact_tel: telStr,
      reason: reasonStr,
      detail: detailStr || null,
      request_type: requestTypeStr,
      custom_reason: customReasonStr || null,
    })
    .select()
    .single();

  // request_type/custom_reason 컬럼이 아직 없음(033_cancel_requests.sql 미실행) — 그 두 값 없이 재시도.
  if (isMissingColumnError(error)) {
    console.warn("[returns] return_requests.request_type 컬럼 없음(마이그레이션 033 미실행) — 그 값 없이 재시도");
    ({ data, error } = await supabaseAdmin
      .from("return_requests")
      .insert({
        order_no: orderNoStr,
        user_id: req.user ? req.user.id : null,
        contact_name: nameStr,
        contact_tel: telStr,
        reason: reasonStr,
        detail: detailStr || null,
      })
      .select()
      .single());
  }

  if (error) {
    console.error("[returns] 저장 실패:", error.message);
    return res.status(500).json({ error: "접수에 실패했습니다." });
  }

  res.json({
    id: data.id,
    orderNo: data.order_no,
    contactName: data.contact_name,
    contactTel: data.contact_tel,
    reason: data.reason,
    detail: data.detail,
    requestType: data.request_type || "return",
    customReason: data.custom_reason || null,
    status: data.status,
    at: data.created_at,
  });
});

module.exports = router;
