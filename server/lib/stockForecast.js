/* 재고 소진 예측 → 발주 제안 (2026-11-11) — 최근 판매 속도로 "며칠 뒤 품절될지"와 "몇 장 발주하면 되는지"를 계산한다.
   정교한 수요예측 모델이 아니라 최근 LOOKBACK_DAYS일 평균을 그대로 늘린 참고치다(판매 데이터가 쌓일수록 정확해짐).
   - 판매량: inventory_log의 주문 차감(reason "order")에서, 취소로 되돌린 재고(auto_cancel·admin_cancel·결제 확정 실패)를 뺀 값
   - 품절 예상일 = 지금 재고 ÷ 하루 판매량
   - 발주 제안 수량 = 하루 판매량 × (공급처 리드타임 + 버틸 기간) − 지금 재고
   발주(돈이 나가는 일) 자체는 사람이 공급처에 한다 — 여기는 알려주기만(Works 재고 탭·아침 요약·피클 브리핑). */
const { supabaseAdmin } = require("./supabase");

const LOOKBACK_DAYS = 28;
const LEAD_DAYS = 14; // 발주 → 입고까지 걸리는 기간(대략)
const COVER_DAYS = 30; // 입고 뒤 버틸 기간
const WARN_DAYS = LEAD_DAYS + 7; // 이 안에 품절 예상이면 "지금 발주할 때"
const DAY = 86400000;
const CANCEL_REASONS = ["auto_cancel", "admin_cancel", "order_finalize_failed", "order_finalize_duplicate"];

const keyOf = (productId, color, size) => `${productId}|${color}|${size}`;

/* 순수 함수. inventory: [{product_id,color,size,qty}], logs: [{product_id,color,size,delta,reason}](기간 안),
   products: [{id,name_ko,colors,sizes}](판매 중인 것만) → 품절 예상이 가까운 순서의 목록 */
function forecastStock({ inventory = [], logs = [], products = [], lookbackDays = LOOKBACK_DAYS, leadDays = LEAD_DAYS, coverDays = COVER_DAYS, warnDays = WARN_DAYS } = {}) {
  const sold = new Map();
  for (const l of logs) {
    const k = keyOf(l.product_id, l.color, l.size);
    const d = Number(l.delta) || 0;
    if (l.reason === "order" && d < 0) sold.set(k, (sold.get(k) || 0) - d);
    else if (CANCEL_REASONS.includes(l.reason) && d > 0) sold.set(k, (sold.get(k) || 0) - d);
  }
  const qtyOf = new Map(inventory.map((r) => [keyOf(r.product_id, r.color, r.size), Number(r.qty) || 0]));
  const out = [];
  for (const p of products) {
    for (const color of p.colors || []) {
      for (const size of p.sizes || []) {
        const k = keyOf(p.id, color, size);
        const units = Math.max(0, sold.get(k) || 0);
        if (!units) continue; // 안 팔린 조합은 예측할 근거가 없다
        const perDay = units / lookbackDays;
        const qty = Math.max(0, qtyOf.get(k) || 0);
        const daysLeft = qty / perDay;
        if (daysLeft > warnDays) continue;
        out.push({
          productId: p.id,
          name: p.name_ko || p.id,
          color,
          size,
          qty,
          sold: units,
          perWeek: Math.round(perDay * 7 * 10) / 10,
          daysLeft: Math.floor(daysLeft),
          suggestQty: Math.max(1, Math.ceil(perDay * (leadDays + coverDays) - qty)),
        });
      }
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || b.sold - a.sold);
}

/* 한 줄 요약(브리핑·푸시용) — 순수 함수 */
function forecastLine(items, max = 3) {
  if (!items.length) return null;
  const head = items.slice(0, max).map((r) => `${r.name} ${r.color} ${r.size} ${r.qty ? `${r.daysLeft}일 뒤 품절 예상` : "품절"}·${r.suggestQty}장`).join(", ");
  return `발주 제안 ${items.length}건: ${head}${items.length > max ? " 외" : ""}`;
}

async function loadStockForecast(db = supabaseAdmin, now = Date.now()) {
  const since = new Date(now - LOOKBACK_DAYS * DAY).toISOString();
  const [{ data: products, error: pErr }, { data: inventory, error: iErr }, { data: logs, error: lErr }] = await Promise.all([
    db.from("products").select("id, name_ko, colors, sizes").eq("active", true),
    db.from("inventory").select("product_id, color, size, qty"),
    db.from("inventory_log").select("product_id, color, size, delta, reason").gte("created_at", since).in("reason", ["order", ...CANCEL_REASONS]).limit(20000),
  ]);
  if (pErr || iErr || lErr) return { error: (pErr || iErr || lErr).message };
  return { items: forecastStock({ inventory, logs, products }), lookbackDays: LOOKBACK_DAYS, leadDays: LEAD_DAYS, coverDays: COVER_DAYS };
}

module.exports = { forecastStock, forecastLine, loadStockForecast, LOOKBACK_DAYS, LEAD_DAYS, COVER_DAYS, WARN_DAYS };
