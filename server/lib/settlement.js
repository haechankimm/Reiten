/* ---------- 월간 정산 리포트 생성(공용) ----------
   server.js의 매달 1일 크론(메일 발송)과 Works 정산 리포트 다운로드·재발송(routes/reports.js)이 같은 함수를 쓴다.
   2026-10-02 server.js에서 옮기면서 환불 계산도 고쳤다 — 예전엔 "환불됨" 반품 한 건당 주문 총액 전부를 환불액으로
   잡아서, 부분 반품(예: 2개 중 1개, 반품 배송비 차감)이 있으면 순매출이 실제보다 작게 나왔다. 이제 실제 환불 기록
   (order_refunds, 043)의 금액을 쓰고, 그 기록이 없던 예전 전액 환불만 주문 총액으로 계산한다.
   신고를 대신하지 않는 원본 데이터 정리이므로 메일 본문에도 그렇게 명시한다(mailer.js 참고). */
const { supabaseAdmin } = require("./supabase");
const { toXlsxBufferGeneric, fmtExportDate } = require("./orderExport");

const KST_OFFSET_MS = 9 * 3600 * 1000;

/* "YYYY-MM" → 그 달(KST)의 UTC 범위. 형식이 틀리면 null. */
function monthRangeFromKey(monthKey) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ""));
  if (!m) return null;
  const y = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  const startKst = Date.UTC(y, mon - 1, 1);
  const endKst = Date.UTC(y, mon, 1);
  return {
    monthKey: `${y}-${String(mon).padStart(2, "0")}`,
    monthLabel: `${y}년 ${mon}월`,
    startISO: new Date(startKst - KST_OFFSET_MS).toISOString(),
    endISO: new Date(endKst - KST_OFFSET_MS).toISOString(),
  };
}

/* 순수 계산 — orders(그 달 주문), refundRows(그 달 처리된 order_refunds), legacyReturns(그 달 환불된 반품 신청),
   totalsByOrderNo(예전 전액 환불 금액 계산용) → summary + 환불 행 목록 */
function computeSettlementSummary({ orders, refundRows, legacyReturns, totalsByOrderNo }) {
  const recordedOrderNos = new Set((refundRows || []).map((r) => r.order_no));
  const legacy = (legacyReturns || []).filter((r) => r.refunded && !recordedOrderNos.has(r.order_no));
  const refundLines = [
    ...(refundRows || []).map((r) => ({
      orderNo: r.order_no,
      kind: r.kind === "partial_cancel" ? "부분 취소" : "반품",
      refundAmount: Number(r.refund_amount) || 0,
      shippingDeduction: Number(r.shipping_deduction) || 0,
      method: r.method === "card" ? "카드 취소" : r.method === "bank_manual" || r.method === "virtual_account_manual" ? "직접 송금" : "-",
      reason: r.note || "",
      at: r.created_at,
    })),
    ...legacy.map((r) => ({
      orderNo: r.order_no,
      kind: "반품(전액)",
      refundAmount: totalsByOrderNo.get(r.order_no) || 0,
      shippingDeduction: 0,
      method: "-",
      reason: r.reason || "",
      at: r.created_at,
    })),
  ];
  const revenue = (orders || []).filter((o) => o.status !== "취소").reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const couponOrders = (orders || []).filter((o) => o.coupon_code);
  const refundTotal = refundLines.reduce((sum, r) => sum + r.refundAmount, 0);
  return {
    summary: {
      totalOrders: (orders || []).length,
      revenue,
      couponOrders: couponOrders.length,
      couponDiscount: couponOrders.reduce((sum, o) => sum + (Number(o.discount) || 0), 0),
      refundCount: refundLines.length,
      refundTotal,
      netRevenue: revenue - refundTotal,
    },
    refundLines,
    couponOrders,
  };
}

async function buildSettlement(monthKey, { db = supabaseAdmin } = {}) {
  const range = monthRangeFromKey(monthKey);
  if (!range) return { error: "월 형식이 올바르지 않습니다(YYYY-MM)." };
  const { startISO: start, endISO: end, monthLabel } = range;

  const { data: orders, error: ordersError } = await db
    .from("orders")
    .select("order_no, customer, items, subtotal, shipping, total, status, coupon_code, discount, created_at")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: true });
  if (ordersError) return { error: `주문 조회 실패: ${ordersError.message}` };

  const { data: legacyReturns, error: returnsError } = await db
    .from("return_requests")
    .select("order_no, refunded, reason, created_at, request_type")
    .gte("created_at", start)
    .lt("created_at", end);
  if (returnsError) return { error: `반품 조회 실패: ${returnsError.message}` };

  // order_refunds(043)가 없으면 예전 방식(환불된 반품 = 주문 총액)만으로 계산
  const { data: refundRowsRaw, error: refundsError } = await db
    .from("order_refunds")
    .select("*")
    .gte("created_at", start)
    .lt("created_at", end);
  const refundRows = refundsError ? [] : refundRowsRaw || [];

  // 예전 전액 환불은 주문이 다른 달일 수도 있어 그 주문 총액을 따로 조회한다.
  const legacyNos = [...new Set((legacyReturns || []).filter((r) => r.refunded && (r.request_type || "return") === "return").map((r) => r.order_no))];
  const totalsByOrderNo = new Map((orders || []).map((o) => [o.order_no, o.total]));
  const missing = legacyNos.filter((no) => !totalsByOrderNo.has(no));
  if (missing.length) {
    const { data: extra } = await db.from("orders").select("order_no, total").in("order_no", missing);
    (extra || []).forEach((o) => totalsByOrderNo.set(o.order_no, o.total));
  }

  const { summary, refundLines, couponOrders } = computeSettlementSummary({
    orders: orders || [],
    refundRows,
    legacyReturns: (legacyReturns || []).filter((r) => (r.request_type || "return") === "return"),
    totalsByOrderNo,
  });
  summary.monthKey = range.monthKey;

  const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";
  const sheets = [
    {
      name: "요약",
      columns: [{ key: "label", label: "항목" }, { key: "value", label: "값" }],
      rows: [
        { label: "기간", value: monthLabel },
        { label: "총 주문 건수", value: `${summary.totalOrders}건` },
        { label: "매출(취소 제외)", value: won(summary.revenue) },
        { label: "쿠폰 사용 건수", value: `${summary.couponOrders}건` },
        { label: "쿠폰 할인 합계", value: won(summary.couponDiscount) },
        { label: "환불 건수(부분 환불 포함)", value: `${summary.refundCount}건` },
        { label: "환불 합계", value: won(summary.refundTotal) },
        { label: "순매출(매출-환불)", value: won(summary.netRevenue) },
      ],
    },
    {
      name: "주문상세",
      columns: [
        { key: "orderNo", label: "주문번호" }, { key: "at", label: "주문일시" }, { key: "name", label: "주문자" },
        { key: "itemsText", label: "주문상품" }, { key: "subtotal", label: "소계" }, { key: "shipping", label: "배송비" },
        { key: "couponCode", label: "쿠폰코드" }, { key: "discount", label: "할인액" }, { key: "total", label: "합계" },
        { key: "status", label: "상태" },
      ],
      rows: (orders || []).map((o) => ({
        orderNo: o.order_no,
        at: fmtExportDate(o.created_at),
        name: (o.customer || {}).name || "",
        itemsText: (o.items || []).map((it) => `${it.name} x${it.qty}`).join(", "),
        subtotal: o.subtotal,
        shipping: o.shipping,
        couponCode: o.coupon_code || "",
        discount: o.discount || 0,
        total: o.total,
        status: o.status,
      })),
    },
    {
      name: "쿠폰 사용 내역",
      columns: [
        { key: "couponCode", label: "쿠폰코드" }, { key: "orderNo", label: "주문번호" },
        { key: "discount", label: "할인액" }, { key: "at", label: "주문일시" },
      ],
      rows: couponOrders.map((o) => ({ couponCode: o.coupon_code, orderNo: o.order_no, discount: o.discount || 0, at: fmtExportDate(o.created_at) })),
    },
    {
      name: "환불 내역",
      columns: [
        { key: "orderNo", label: "주문번호" }, { key: "kind", label: "구분" }, { key: "refundAmount", label: "환불액" },
        { key: "shippingDeduction", label: "반품 배송비 차감" }, { key: "method", label: "환불 방법" },
        { key: "reason", label: "사유" }, { key: "at", label: "처리일시" },
      ],
      rows: refundLines.map((r) => ({ ...r, at: fmtExportDate(r.at) })),
    },
  ];

  const buffer = await toXlsxBufferGeneric(sheets);
  return { monthKey: range.monthKey, monthLabel, summary, buffer };
}

module.exports = { buildSettlement, computeSettlementSummary, monthRangeFromKey };
