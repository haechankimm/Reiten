/* 공개 상품 목록 + 실재고 기반 품절 계산(15초 캐시) — server.js에서 분리(2026-11-09, 동작 변경 없음). */
const { PRODUCTS: STATIC_PRODUCTS } = require("../../소스 코드/assets/js/data.js");
const { supabaseAdmin } = require("./supabase");

const { toProductDto } = require("./products");

/* ---------- 상품 (products 테이블 — 관리자 패널에서 추가·수정·삭제) ----------
   data.js의 정적 PRODUCTS는 마이그레이션 004를 실행하지 않은 서버나 조회 실패 시의 폴백으로만 쓰인다.
   toProductDto/productPatchFromBody는 ./lib/products.js로, priceItem/shippingFor/orderNo는
   ./lib/pricing.js로 분리해 Supabase 없이도 단위 테스트할 수 있게 했다(server/test/ 참고). */

/* GET /api/products가 로그인 없이 아무나 부를 수 있는 공개 API인데, 호출될 때마다 products
   전체 + inventory 전체(withRealSoldOut)를 매번 다시 읽고 있었다 — 방문자가 늘어나거나
   상품·컬러 수가 늘어나면 이 두 쿼리가 트래픽에 정비례해서 늘어나는 구조. 15초 TTL 메모리
   캐시로 감싸서, 15초 동안 아무리 많이 방문해도 실제 DB 조회는 최대 1번만 나가게 한다.
   품절 표시가 최대 15초 늦게 반영될 수 있지만(실제 결제 시점엔 decrement_inventory가 항상
   실시간으로 재검증하므로 판매 정합성엔 영향 없음), 이 정도 지연은 상품 목록 화면에서
   체감되지 않는 수준이라 감수한다. 캐시는 이 프로세스 메모리에만 있어 재배포하면 초기화됨. */
const PRODUCTS_CACHE_TTL_MS = 15000;
let productsCache = { data: null, at: 0 };

/* ---------- 상품 공개 예약(2026-11-21, 056) ----------
   publish_at이 지난 비공개 상품을 공개로 바꾸고 publish_at을 비운다. 손님이 상품 목록을 여는 순간(getActiveProducts)과
   5분마다 크론(lib/scheduledJobs.js) 양쪽에서 부른다 — 무료 플랜 서버가 잠들어 크론을 건너뛰어도, 첫 손님이 들어오는 순간 공개된다.
   다음 예약 시각을 기억해 두고 그 시각이 지나면 15초 캐시를 무시하고 바로 확인한다(드롭 시각에 정확히 보이게). */
let nextPublishAt = 0; // 0 = 아직 모름, Infinity = 예약 없음
let publishCheckedAt = 0;

async function refreshNextPublishAt(db = supabaseAdmin) {
  const { data, error } = await db.from("products").select("publish_at").eq("active", false).not("publish_at", "is", null).order("publish_at", { ascending: true }).limit(1);
  nextPublishAt = error || !data || !data.length ? Infinity : new Date(data[0].publish_at).getTime();
  return nextPublishAt;
}

async function publishDueProducts({ db = supabaseAdmin, now = Date.now() } = {}) {
  publishCheckedAt = now;
  const { data, error } = await db
    .from("products")
    .update({ active: true, publish_at: null, updated_at: new Date(now).toISOString() })
    .eq("active", false)
    .lte("publish_at", new Date(now).toISOString())
    .select("id, name_ko");
  if (error) return { published: [], error: error.message }; // 056 전(칸 없음) 포함 — 조용히
  await refreshNextPublishAt(db).catch(() => {});
  if (data && data.length) {
    invalidateProductsCache();
    console.log("[product-publish] 예약 공개:", data.map((p) => p.id).join(", "));
    // 상품 권한이 있는 관리자에게만(권한 없는 알림은 아예 안 보이게 — CLAUDE.md)
    (async () => {
      const { sendPushToAdmins, pushRecipientsForAreas } = require("./push");
      const ids = await pushRecipientsForAreas(["products"], "view");
      if (ids.length) await sendPushToAdmins({ title: "예약한 상품이 공개됐습니다", body: data.map((p) => p.name_ko || p.id).join(", ").slice(0, 180), tab: "products" }, { adminIds: ids });
    })().catch(() => {});
  }
  return { published: (data || []).map((p) => p.id) };
}

function invalidateProductsCache() {
  productsCache = { data: null, at: 0 };
}

/* 관리자가 상품을 저장하면(예약 시각이 바뀌었을 수 있음) 다음 예약 시각을 다시 읽게 한다 */
function scheduleChanged() {
  nextPublishAt = 0;
  invalidateProductsCache();
}

async function getActiveProducts() {
  const now = Date.now();
  if (nextPublishAt === 0) await refreshNextPublishAt().catch(() => { nextPublishAt = Infinity; });
  if (nextPublishAt <= now && now - publishCheckedAt > 5000) await publishDueProducts({ now }).catch(() => {});
  if (productsCache.data && Date.now() - productsCache.at < PRODUCTS_CACHE_TTL_MS) {
    return productsCache.data;
  }
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[products] DB 조회 실패, 정적 목록으로 폴백:", error.message);
    return STATIC_PRODUCTS;
  }
  const { products: withStock, degraded } = await withRealSoldOut(data.map(toProductDto));
  // 반품·교환 "사이즈 작음/큼"이 한쪽으로 쏠린 상품은 사이즈 추천이 한 치수 조정한다(lib/fitFeedback.js, 2026-11-11)
  const biasMap = require("./fitFeedback").cachedBiasMap();
  const result = withStock.map((p) => (biasMap[p.id] && biasMap[p.id].bias ? { ...p, fitBias: biasMap[p.id].bias } : p));
  /* 재고 조회가 실패해 품절 정보가 부정확한 상태(degraded)로는 캐시에 쓰지 않는다 — 그대로
     캐시하면 일시적인 DB 오류 한 번이 실제로는 재고 조회 자체가 복구된 뒤에도 남은 15초
     동안 "품절 정보 없음" 상태를 그대로 밀어붙이게 된다. 캐시를 안 쓰면 바로 다음 요청이
     새로 시도해서 이 창이 넓어지지 않는다(2026-09-01 코드 감사에서 발견). */
  if (!degraded) productsCache = { data: result, at: Date.now() };
  return result;
}

/* 관리자가 손으로 체크하는 soldOut 배열(상품.sizes 전체에 적용 — "이 사이즈는 어느 컬러든 안 판다")과
   실제 결제 시 차감되는 inventory 테이블(product_id + color + size, 014_inventory_by_color.sql)이
   서로 다른 값을 가질 수 있다(주문으로 실재고가 0이 돼도 관리자가 체크박스를 갱신하기 전까지는
   반영 안 됨, 또는 행 자체가 아직 없어 항상 재고 0으로 취급됨). 고객 화면에 내려줄 때는 컬러별
   실재고 0(또는 행 없음)인 사이즈를 outOfStockByColor로 따로 계산해 붙여준다 — soldOut은 그대로
   두고(전체 컬러 공통 품절), 특정 컬러만 재고가 없는 경우는 product.html이 "지금 고른 컬러"에
   한해 그 사이즈를 막는 데 이 필드를 쓴다. */
async function withRealSoldOut(products) {
  if (!products.length) return { products, degraded: false };
  const ids = products.map((p) => p.id);
  const { data, error } = await supabaseAdmin.from("inventory").select("product_id, color, size, qty").in("product_id", ids);
  if (error) {
    console.error("[products] 재고 조회 실패, 관리자가 입력한 품절 정보만 사용:", error.message);
    return { products, degraded: true };
  }
  const qtyByProduct = new Map();
  for (const row of data) {
    if (!qtyByProduct.has(row.product_id)) qtyByProduct.set(row.product_id, new Map());
    qtyByProduct.get(row.product_id).set(`${row.color}:${row.size}`, row.qty);
  }
  const withStock = products.map((p) => {
    const qtyByColorSize = qtyByProduct.get(p.id);
    const outOfStockByColor = {};
    for (const color of p.colors || []) {
      const outSizes = (p.sizes || []).filter((size) => {
        const qty = qtyByColorSize ? qtyByColorSize.get(`${color}:${size}`) : undefined;
        return (qty ?? 0) <= 0;
      });
      if (outSizes.length) outOfStockByColor[color] = outSizes;
    }
    /* 품절은 실재고 하나로만 판단한다(2026-09 통합) — 관리자가 손으로 체크하던 soldOut은 재고가 10개
       있는데도 품절로 막는 사고가 있어 무시하고, "모든 컬러에서 재고 0인 사이즈"로 다시 계산한다.
       (재고 조회가 실패한 degraded 상태에서만 예전 수동 값이 비상용으로 남는다.) */
    const colors = p.colors || [];
    const soldOut = colors.length ? (p.sizes || []).filter((size) => colors.every((c) => (outOfStockByColor[c] || []).includes(size))) : [];
    return { ...p, soldOut, outOfStockByColor };
  });
  return { products: withStock, degraded: false };
}

module.exports = { getActiveProducts, withRealSoldOut, publishDueProducts, scheduleChanged, invalidateProductsCache };
