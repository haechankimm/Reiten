/* ---------- 관리자 대시보드 ----------
   orders 테이블만으로 계산 가능해서 새 테이블 없이 집계만 한다. 취소된 주문은 매출에서 뺀다.
   상품별 판매량은 orders.items(주문 시점 스냅샷, productId 없이 name만 있음)를 이름으로 묶어 집계한다 —
   상품이 삭제·개명돼도 과거 주문 내역 자체는 그대로 남아있기 때문.
   돈이 오가는 라우트는 아니고 읽기 전용 집계라 라우트 분리 다음 라운드에서 분리했다
   (2026-09-01). GA4 방문자 통계(analytics)도 같은 Works "대시보드" 탭이 쓰는 데이터라 여기 같이 둔다. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { kstDateKey, kstMonthKey } = require("../lib/kst");
const { toCsvGeneric, toXlsxBufferGeneric } = require("../lib/orderExport");
const { getVisitorStats } = require("../lib/analytics");
const { FIRST_PURCHASE_COUPON_CODE_PREFIX, REPEAT_PURCHASE_COUPON_CODE_PREFIX } = require("../lib/thanksCoupons");
const { isMissingColumnError } = require("../lib/pgErrors");

const router = express.Router();

/* GET /api/admin/dashboard(화면)와 GET /api/admin/dashboard/export(내보내기)가 집계 로직을 공유한다. */
async function computeDashboardStats() {
  let { data, error } = await supabaseAdmin
    .from("orders")
    .select("items, total, status, created_at, device")
    .order("created_at", { ascending: false })
    .limit(2000);

  /* device 컬럼이 아직 없음(022_order_device.sql 미실행) — 기기별 집계만 못 하게 되는 거라
     대시보드 전체가 죽으면 안 되므로 device 없이 재조회한다(lib/pgErrors.js 참고 — SELECT는
     INSERT와 다른 에러 코드로 실패한다는 걸 직접 테스트해서 확인함). */
  if (isMissingColumnError(error)) {
    console.warn("[dashboard] orders.device 컬럼 없음(마이그레이션 022 미실행) — device 없이 재조회");
    ({ data, error } = await supabaseAdmin
      .from("orders")
      .select("items, total, status, created_at")
      .order("created_at", { ascending: false })
      .limit(2000));
  }

  if (error) return { error };

  /* "누적 주문"은 위 2000건 캡이 걸린 data.length를 그대로 쓰면 실제 누적이 2000건을
     넘는 순간부터 조용히 2000에 고정돼 버린다(효율화 감사에서 발견) — head:true로 행 데이터는
     받지 않고 정확한 전체 개수만 별도로 센다(가벼운 카운트 쿼리라 매번 불러도 부담 없음). */
  const { count: totalOrdersCount } = await supabaseAdmin.from("orders").select("id", { count: "exact", head: true });

  /* 반품 사유 통계 — return_requests.reason은 이미 쌓이고 있어서(위 "지금 막혀 있는 것" 참고
     새 테이블 없이 집계만 추가) "왜 반품이 많은지"를 한눈에 보여준다. */
  const { data: returnRows } = await supabaseAdmin.from("return_requests").select("reason");
  const reasonCounts = new Map();
  for (const r of returnRows || []) {
    reasonCounts.set(r.reason, (reasonCounts.get(r.reason) || 0) + 1);
  }
  const returnReasons = [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);

  const isCancelled = (o) => o.status === "취소";
  const now = new Date();
  /* 서버는 UTC로 도는데(Render), 관리자는 한국 시간 기준으로 "오늘"을 생각한다 — 자정~오전
     9시(KST) 사이에 raw UTC 날짜로 자르면 그 시간대 주문이 "어제" 매출로 잘못 잡히는 버그가
     있었다(kst.js 참고). kstDateKey/kstMonthKey로 통일해 해결. */
  const todayKey = kstDateKey(now);
  const monthKey = kstMonthKey(now);

  let todayRevenue = 0;
  let todayOrders = 0;
  let monthRevenue = 0;
  let pendingCount = 0;
  const revenueByDay = new Map();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    revenueByDay.set(kstDateKey(d), 0);
  }

  const qtyByName = new Map();
  /* GA4는 "방문자 수"만 알려주고 실제 구매 여부는 모른다 — 우리 DB의 실제 결제 완료 기록에
     저장해둔 기기 종류(device, 022_order_device.sql)로 "기기별 실제 매출·주문 건수"를
     집계한다. 마이그레이션 미실행이거나 그 이전에 만들어진 주문은 device가 없으므로
     "unknown"으로 묶는다. */
  const salesByDevice = new Map();
  for (const o of data) {
    if (o.status === "입금대기") pendingCount++;
    if (!isCancelled(o)) {
      const dayKey = kstDateKey(o.created_at);
      if (dayKey === todayKey) { todayRevenue += o.total; todayOrders++; }
      if (kstMonthKey(o.created_at) === monthKey) monthRevenue += o.total;
      if (revenueByDay.has(dayKey)) revenueByDay.set(dayKey, revenueByDay.get(dayKey) + o.total);

      for (const item of o.items || []) {
        qtyByName.set(item.name, (qtyByName.get(item.name) || 0) + (item.qty || 0));
      }

      const deviceKey = o.device || "unknown";
      const prev = salesByDevice.get(deviceKey) || { orders: 0, revenue: 0 };
      salesByDevice.set(deviceKey, { orders: prev.orders + 1, revenue: prev.revenue + o.total });
    }
  }

  const bestsellers = [...qtyByName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qty]) => ({ name, qty }));

  /* 감사 쿠폰(첫 구매·재구매) 발급/사용 현황 — 동업자와 요율을 논의할 때 "몇 명한테 줬고
     몇 명이 실제로 썼는지"를 실제 데이터로 보여주기 위함(위 0번 섹션 참고). 새 테이블 없이
     coupons(발급 건수)·orders.coupon_code(사용 건수)만으로 집계한다. "사용"은 resolveCoupon()의
     usage_limit 집계(lib/coupons.js)와 같은 기준 — 주문 상태와 무관하게 그 코드로 주문이
     한 번이라도 만들어졌으면 사용된 것으로 센다(취소돼도 쿠폰 자체는 이미 소진된 것이므로). */
  async function thanksCouponStats(prefix) {
    const { count: issued } = await supabaseAdmin
      .from("coupons")
      .select("code", { count: "exact", head: true })
      .like("code", `${prefix}%`);
    const { data: usedRows } = await supabaseAdmin.from("orders").select("coupon_code").like("coupon_code", `${prefix}%`);
    const used = new Set((usedRows || []).map((r) => r.coupon_code)).size;
    return { issued: issued || 0, used, usageRate: issued ? Math.round((used / issued) * 1000) / 10 : 0 };
  }
  const [firstPurchaseCoupon, repeatPurchaseCoupon] = await Promise.all([
    thanksCouponStats(FIRST_PURCHASE_COUPON_CODE_PREFIX),
    thanksCouponStats(REPEAT_PURCHASE_COUPON_CODE_PREFIX),
  ]);

  return {
    todayRevenue,
    todayOrders,
    monthRevenue,
    totalOrders: totalOrdersCount ?? data.length,
    pendingCount,
    dailyRevenue: [...revenueByDay.entries()].map(([date, total]) => ({ date, total })),
    bestsellers,
    salesByDevice: [...salesByDevice.entries()]
      .map(([device, v]) => ({ device, orders: v.orders, revenue: v.revenue }))
      .sort((a, b) => b.revenue - a.revenue),
    returnReasons,
    firstPurchaseCoupon,
    repeatPurchaseCoupon,
  };
}

router.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  const stats = await computeDashboardStats();
  if (stats.error) return res.status(500).json({ error: "집계에 실패했습니다." });
  res.json(stats);
});

/* GA4 방문자 통계(선택) — 설정 안 돼 있으면 lib/analytics.js가 null을 반환하고, 조회 자체가
   실패해도(권한 미부여 등) 대시보드 전체를 막지 않도록 500 대신 stats:null로 내려준다. */
/* Works 대시보드의 30일/3개월/6개월/누적 기간 선택 — "누적"은 GA4가 실제로 무한정 데이터를
   보관하지 않으므로(속성 설정에 따라 보통 최대 14~18개월) 완전한 전체 기간은 아니고 그 안에서
   가장 긴 범위(540일)로 대체한다. 허용된 값 밖이면 기본 30일로 조용히 폴백. */
const VISITOR_STATS_ALLOWED_DAYS = [30, 90, 180, 540];
router.get("/api/admin/analytics", requireAdmin, async (req, res) => {
  const days = VISITOR_STATS_ALLOWED_DAYS.includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  try {
    const stats = await getVisitorStats(days);
    res.json({ stats });
  } catch (err) {
    console.error("[analytics] 조회 실패:", err.message);
    res.json({ stats: null });
  }
});

/* 대시보드 내보내기 — 화면에 없는 표 형태 데이터라 CSV는 요약/일별 매출/베스트셀러 세 구간을
   빈 줄로 이어 붙이고, 엑셀은 시트 세 개로 나눈다. ?format=csv|xlsx */
router.get("/api/admin/dashboard/export", requireAdmin, async (req, res) => {
  const format = String(req.query.format || "csv").toLowerCase();
  if (!["csv", "xlsx"].includes(format)) {
    return res.status(400).json({ error: "format은 csv, xlsx 중 하나여야 합니다." });
  }

  const stats = await computeDashboardStats();
  if (stats.error) return res.status(500).json({ error: "집계에 실패했습니다." });

  const summaryColumns = [
    { key: "label", label: "항목" },
    { key: "value", label: "값" },
  ];
  const summaryRows = [
    { label: "오늘 매출", value: stats.todayRevenue },
    { label: "이번 달 매출", value: stats.monthRevenue },
    { label: "전체 주문", value: stats.totalOrders },
    { label: "입금대기", value: stats.pendingCount },
  ];
  const dailyColumns = [
    { key: "date", label: "날짜" },
    { key: "total", label: "매출" },
  ];
  const bestsellerColumns = [
    { key: "name", label: "상품명" },
    { key: "qty", label: "판매수량" },
  ];

  const filename = `reiten-dashboard-${new Date().toISOString().slice(0, 10)}`;
  try {
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
      res.send(
        toCsvGeneric([
          { title: "요약", columns: summaryColumns, rows: summaryRows },
          { title: "최근 14일 매출", columns: dailyColumns, rows: stats.dailyRevenue },
          { title: "베스트셀러 TOP5", columns: bestsellerColumns, rows: stats.bestsellers },
        ])
      );
    } else {
      const buf = await toXlsxBufferGeneric([
        { name: "요약", columns: summaryColumns, rows: summaryRows },
        { name: "일별 매출", columns: dailyColumns, rows: stats.dailyRevenue },
        { name: "베스트셀러", columns: bestsellerColumns, rows: stats.bestsellers },
      ]);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
      res.send(Buffer.from(buf));
    }
    logAdminAction(req, "dashboard.export", "dashboard", "export", { format });
  } catch (e) {
    console.error("[admin/dashboard/export] 생성 실패:", e.message);
    res.status(500).json({ error: "내보내기 파일 생성에 실패했습니다." });
  }
});

module.exports = router;
