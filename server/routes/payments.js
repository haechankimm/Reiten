/* ---------- 결제 트랜잭션 로그 ----------
   주문(orders)은 "성공해서 실제로 만들어진 주문"만 보여준다 — 결제가 실패·불일치·에러로
   끝나 주문으로 안 이어진 시도는 지금까지 어디에도 안 남고 console.error로만 사라졌다
   (server.js의 웹훅·/api/order 카드 분기, lib/adminLog.js의 logPaymentAttempt 참고).
   여긴 그 원본 기록(payment_log, 030_payment_log.sql)을 조회하는 읽기 전용 라우트 —
   돈이 오가는 실제 처리는 전부 server.js에 남아있고, 여기는 CRUD 없이 조회·내보내기만
   한다(2026-09 "결제 트랜잭션 로그(주문과 분리된 원장)" 요청). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { paginationParams } = require("../lib/pagination");
const { applyKstDateRangeFilter } = require("../lib/kst");
const { toCsvGeneric } = require("../lib/orderExport");

const router = express.Router();

const PAYMENT_LOG_COLUMNS = [
  { key: "createdAt", label: "일시" },
  { key: "paymentId", label: "결제 ID" },
  { key: "orderNo", label: "주문번호" },
  { key: "status", label: "상태" },
  { key: "amount", label: "금액" },
  { key: "method", label: "결제수단" },
  { key: "reason", label: "사유" },
];

const STATUS_LABEL = { paid: "성공", failed: "실패", mismatch: "불일치", error: "조회 오류" };

function applyPaymentLogFilters(query, reqQuery) {
  const { q, status, dateFrom, dateTo } = reqQuery;
  if (q) {
    const v = String(q).trim().slice(0, 60).replace(/[%,()]/g, "");
    if (v) query = query.or(`payment_id.ilike.%${v}%,order_no.ilike.%${v}%`);
  }
  if (status) query = query.eq("status", status);
  query = applyKstDateRangeFilter(query, "created_at", dateFrom, dateTo);
  return query;
}

function toPaymentLogDto(r) {
  return {
    id: r.id,
    paymentId: r.payment_id,
    orderNo: r.order_no,
    status: r.status,
    statusLabel: STATUS_LABEL[r.status] || r.status,
    amount: r.amount,
    method: r.method,
    reason: r.reason,
    createdAt: r.created_at,
  };
}

router.get("/api/admin/payment-log", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query);

  let query = supabaseAdmin.from("payment_log").select("*", { count: "exact" }).order("created_at", { ascending: false });
  query = applyPaymentLogFilters(query, req.query);

  const { data, error, count } = await query.range(from, to);
  if (error) return res.status(500).json({ error: "결제 트랜잭션 로그를 불러오지 못했습니다." });
  res.json({ items: data.map(toPaymentLogDto), page, pageSize, total: count ?? data.length });
});

router.get("/api/admin/payment-log/export", requireAdmin, async (req, res) => {
  let query = supabaseAdmin.from("payment_log").select("*").order("created_at", { ascending: false }).limit(5000);
  query = applyPaymentLogFilters(query, req.query);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: "결제 트랜잭션 로그를 불러오지 못했습니다." });

  const rows = data.map((r) => ({
    createdAt: r.created_at ? r.created_at.slice(0, 16).replace("T", " ") : "",
    paymentId: r.payment_id,
    orderNo: r.order_no || "",
    status: STATUS_LABEL[r.status] || r.status,
    amount: r.amount ?? "",
    method: r.method || "",
    reason: r.reason || "",
  }));

  const filename = `reiten-payment-log-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(toCsvGeneric([{ title: "결제 트랜잭션", columns: PAYMENT_LOG_COLUMNS, rows }]));
});

module.exports = router;
