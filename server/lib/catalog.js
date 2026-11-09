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

async function getActiveProducts() {
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
  const { products: result, degraded } = await withRealSoldOut(data.map(toProductDto));
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

module.exports = { getActiveProducts, withRealSoldOut };
