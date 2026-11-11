/* 반품·교환 사유로 사이즈 추천 보정 (2026-11-11) — 고객이 반품·교환 신청에서 "사이즈 작음"/"사이즈 큼"을 고르면
   그 주문의 상품별로 모아서, 한쪽으로 확실히 쏠린 상품은 사이즈 추천(assets/js/sizeAdvisor.js)이 한 치수 조정한다.
   - 기준: 최근 WINDOW_DAYS일, 같은 방향 MIN_COUNT건 이상 + 반대 방향의 2배 이상 + 판매량 대비 MIN_RATE 이상
     (몇 건 안 되는 우연으로 추천이 흔들리지 않게 보수적으로)
   - 예전 사유 "사이즈 불만족"은 방향을 몰라 unknown으로만 센다(Works에서 참고용)
   - 고객 화면 상품 목록(/api/products)에 fitBias("small"|"big")로 붙는다 — 6시간마다 다시 계산(메모리, 서버마다)
   한 주문에 상품이 여러 개면 그 주문의 옷 전부에 센다(어느 옷 때문인지 신청서가 받지 않음 — 대부분 한 벌 주문). */
const { supabaseAdmin } = require("./supabase");

const WINDOW_DAYS = 180;
const MIN_COUNT = 3;
const MIN_RATE = 0.05;
const REFRESH_MS = 6 * 3600 * 1000;
const DAY = 86400000;
const REASON_DIR = { "사이즈 작음": "small", "사이즈 큼": "big", "사이즈 불만족": "unknown" };

/* 순수 함수. returns: [{order_no, reason, request_type}], itemsByOrder: Map(order_no → items[]), soldByProduct: Map(id → 수량)
   → { [productId]: { small, big, unknown, sold, bias } } */
function fitFeedbackFromRows(returns, itemsByOrder, soldByProduct = new Map()) {
  const out = {};
  for (const r of returns || []) {
    if (r.request_type === "cancel") continue;
    const dir = REASON_DIR[String(r.reason || "").trim()];
    if (!dir) continue;
    const ids = new Set((itemsByOrder.get(r.order_no) || []).filter((it) => it.productId && it.size && !String(it.productId).startsWith("charm-")).map((it) => it.productId));
    for (const id of ids) {
      out[id] = out[id] || { small: 0, big: 0, unknown: 0 };
      out[id][dir]++;
    }
  }
  for (const [id, s] of Object.entries(out)) {
    s.sold = soldByProduct.get(id) || 0;
    s.bias = fitBias(s);
  }
  return out;
}

function fitBias({ small = 0, big = 0, sold = 0 }) {
  const lean = (a, b) => a >= MIN_COUNT && a >= 2 * b && (!sold || a / sold >= MIN_RATE);
  if (lean(small, big)) return "small";
  if (lean(big, small)) return "big";
  return null;
}

async function computeFitFeedback(db = supabaseAdmin, now = Date.now()) {
  const since = new Date(now - WINDOW_DAYS * DAY).toISOString();
  const { data: rets, error } = await db.from("return_requests").select("order_no, reason, request_type, created_at").gte("created_at", since).in("reason", Object.keys(REASON_DIR)).limit(5000);
  if (error) return { error: error.message };
  const orderNos = [...new Set((rets || []).map((r) => r.order_no))];
  const itemsByOrder = new Map();
  for (let i = 0; i < orderNos.length; i += 200) {
    const { data: orders } = await db.from("orders").select("order_no, items").in("order_no", orderNos.slice(i, i + 200));
    (orders || []).forEach((o) => itemsByOrder.set(o.order_no, o.items || []));
  }
  const { data: logs } = await db.from("inventory_log").select("product_id, delta").eq("reason", "order").gte("created_at", since).limit(50000);
  const soldByProduct = new Map();
  (logs || []).forEach((l) => soldByProduct.set(l.product_id, (soldByProduct.get(l.product_id) || 0) + Math.max(0, -(Number(l.delta) || 0))));
  return { byProduct: fitFeedbackFromRows(rets, itemsByOrder, soldByProduct) };
}

/* 고객 상품 목록용 캐시 — 오래됐으면 뒤에서 다시 계산하고, 지금은 있는 값(없으면 빈 값)을 바로 돌려준다(목록 응답을 늦추지 않음). */
let cache = { byProduct: {}, at: 0, running: false };
function cachedBiasMap() {
  if (Date.now() - cache.at > REFRESH_MS && !cache.running) {
    cache.running = true;
    computeFitFeedback()
      .then((r) => { if (!r.error) cache.byProduct = r.byProduct; })
      .catch(() => {})
      .finally(() => { cache.at = Date.now(); cache.running = false; });
  }
  return cache.byProduct;
}

module.exports = { fitFeedbackFromRows, fitBias, computeFitFeedback, cachedBiasMap, REASON_DIR, MIN_COUNT, MIN_RATE, WINDOW_DAYS };
