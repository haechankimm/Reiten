/* 관리자 재고 조회·일괄 수정·이력·내보내기 + 재입고 알림 발송 — server.js에서 분리(2026-11-09, 동작 변경 없음). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { sendCustomerRestockNotice } = require("../lib/mailer");
const { toCsvGeneric, toXlsxBufferGeneric } = require("../lib/orderExport");
const { logAdminAction, logInventoryChange } = require("../lib/adminLog");
const { isMissingSchemaError } = require("../lib/pgErrors");

const router = express.Router();

router.get("/api/admin/inventory", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("inventory")
    .select("product_id, color, size, qty")
    .order("product_id", { ascending: true });

  if (error) return res.status(500).json({ error: "재고를 불러오지 못했습니다." });
  res.json(data.map((r) => ({ productId: r.product_id, color: r.color, size: r.size, qty: r.qty })));
});


/* 품절 알림 신청(routes/restock.js에서 접수)한 고객에게 재입고를 알린다 — 재고 수량이
   실제로 바뀌는 지점이 여기(관리자 재고 탭 저장)뿐이라 알림 발송도 여기서 처리한다.
   restockedItems: [{productId, color, size, qty}] (이미 0→양수 전환된 것만 걸러진 상태로 들어옴). */
async function notifyRestockSubscribers(restockedItems) {
  const orFilter = restockedItems
    .map((it) => `and(product_id.eq.${it.productId},color.eq.${it.color},size.eq.${it.size})`)
    .join(",");
  const { data: subs, error } = await supabaseAdmin
    .from("restock_subscriptions")
    .select("id, product_id, color, size, email")
    .is("notified_at", null)
    .or(orFilter);
  if (error) {
    if (isMissingSchemaError(error)) return; // 025 마이그레이션 미실행 — 조용히 건너뜀
    console.error("[restock] 신청 목록 조회 실패:", error.message);
    return;
  }
  if (!subs.length) return;

  const productIds = [...new Set(subs.map((s) => s.product_id))];
  const { data: products } = await supabaseAdmin.from("products").select("id, name_ko").in("id", productIds);
  const nameById = new Map((products || []).map((p) => [p.id, p.name_ko]));

  const notifiedIds = [];
  for (const sub of subs) {
    try {
      await sendCustomerRestockNotice({
        email: sub.email,
        productId: sub.product_id,
        productName: nameById.get(sub.product_id) || sub.product_id,
        color: sub.color,
        size: sub.size,
      });
      notifiedIds.push(sub.id);
    } catch (err) {
      console.error("[mailer] 품절 알림 메일 발송 실패:", err.message);
    }
  }
  if (notifiedIds.length) {
    await supabaseAdmin.from("restock_subscriptions").update({ notified_at: new Date().toISOString() }).in("id", notifiedIds);
  }
}

/* 재고 탭에서 칸마다 바로바로 저장하던 방식은 몇 칸만 고쳐도 토스트가 계속 뜨고 활동 로그도
   항목 수만큼 따로 쌓여 지저분했다 — Works가 "고치고 나서 저장 버튼 한 번"으로 통일되면서
   이 엔드포인트로 여러 항목을 한 번에 받아 한 번의 활동 로그로 남긴다(위 단일 항목용
   PATCH /api/admin/inventory는 다른 소비자가 없어 그대로 남겨두되 이 탭에서는 더 이상 쓰지 않는다). */
router.patch("/api/admin/inventory/bulk", requireAdmin, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "items가 필요합니다." });
  if (items.length > 500) return res.status(400).json({ error: "한 번에 저장할 수 있는 항목이 너무 많습니다." });

  const normalized = [];
  for (const it of items) {
    const productId = it && it.productId;
    const colorStr = String((it && it.color) || "");
    const size = it && it.size;
    const qtyNum = Math.floor(Number(it && it.qty));
    if (!productId || !colorStr || !size || !Number.isFinite(qtyNum) || qtyNum < 0) {
      return res.status(400).json({ error: "각 항목은 productId, color, size, qty(0 이상)가 필요합니다." });
    }
    normalized.push({ productId, color: colorStr, size, qty: qtyNum });
  }

  const productIds = [...new Set(normalized.map((it) => it.productId))];
  const { data: prevRows } = await supabaseAdmin
    .from("inventory")
    .select("product_id, color, size, qty")
    .in("product_id", productIds);
  const prevQty = new Map((prevRows || []).map((r) => [`${r.product_id}:${r.color}:${r.size}`, r.qty]));

  const { error } = await supabaseAdmin
    .from("inventory")
    .upsert(
      normalized.map((it) => ({ product_id: it.productId, color: it.color, size: it.size, qty: it.qty })),
      { onConflict: "product_id,color,size" }
    );
  if (error) return res.status(500).json({ error: "재고 저장에 실패했습니다." });

  const logRows = normalized
    .map((it) => ({
      productId: it.productId,
      color: it.color,
      size: it.size,
      delta: it.qty - (prevQty.get(`${it.productId}:${it.color}:${it.size}`) || 0),
      reason: "admin_adjust",
      adminEmail: req.user.email,
    }))
    .filter((r) => r.delta !== 0);
  if (logRows.length) logInventoryChange(logRows);

  /* 품절 알림 신청(025_restock_subscriptions.sql) — 이 조합이 방금 0 이하 → 양수로 바뀐
     경우에만 그 조합을 기다리던 신청자들에게 메일을 보낸다. 응답을 늦추면 안 되니 백그라운드로
     돌리고 실패해도 재고 저장 자체는 이미 끝난 뒤라 그대로 둔다. */
  const restocked = normalized.filter((it) => it.qty > 0 && (prevQty.get(`${it.productId}:${it.color}:${it.size}`) || 0) <= 0);
  if (restocked.length) notifyRestockSubscribers(restocked).catch((err) => console.error("[restock] 알림 처리 실패:", err.message));

  logAdminAction(req, "inventory.bulk_update", "inventory", `${normalized.length}건`, { count: normalized.length, productIds });
  res.json({ ok: true, count: normalized.length });
});

/* 재고 변동 이력 조회 — productId로 좁혀서 최근 변동부터 보여준다(전체 상품을 한 번에 보여주기엔
   너무 많다). 재고 탭의 상품 카드에서 "이력 보기"를 눌렀을 때 쓴다. */
router.get("/api/admin/inventory/log", requireAdmin, async (req, res) => {
  const { productId } = req.query;
  if (!productId) return res.status(400).json({ error: "productId가 필요합니다." });

  const { data, error } = await supabaseAdmin
    .from("inventory_log")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: "재고 이력을 불러오지 못했습니다." });
  res.json(
    data.map((r) => ({
      color: r.color,
      size: r.size,
      delta: r.delta,
      reason: r.reason,
      ref: r.ref,
      adminEmail: r.admin_email,
      at: r.created_at,
    }))
  );
});

/* 재고 내보내기 — inventory에는 상품명이 없어(product_id만 있음) products와 조인해 이름을 붙인다.
   화면(재고 탭)의 상품코드 순 정렬을 그대로 따른다. ?format=csv|xlsx */
const INVENTORY_EXPORT_COLUMNS = [
  { key: "productId", label: "상품 ID" },
  { key: "nameKo", label: "상품명" },
  { key: "color", label: "컬러" },
  { key: "size", label: "사이즈" },
  { key: "qty", label: "재고수량" },
];
router.get("/api/admin/inventory/export", requireAdmin, async (req, res) => {
  const format = String(req.query.format || "csv").toLowerCase();
  if (!["csv", "xlsx"].includes(format)) {
    return res.status(400).json({ error: "format은 csv, xlsx 중 하나여야 합니다." });
  }

  const [{ data: invRows, error: invError }, { data: productRows, error: prodError }] = await Promise.all([
    supabaseAdmin.from("inventory").select("product_id, color, size, qty").order("product_id", { ascending: true }),
    supabaseAdmin.from("products").select("id, name_ko"),
  ]);
  if (invError || prodError) return res.status(500).json({ error: "재고를 불러오지 못했습니다." });

  const nameById = new Map((productRows || []).map((p) => [p.id, p.name_ko]));
  const rows = invRows.map((r) => ({
    productId: r.product_id,
    nameKo: nameById.get(r.product_id) || r.product_id,
    color: r.color,
    size: r.size,
    qty: r.qty,
  }));

  const filename = `reiten-inventory-${require("./lib/kst").kstDateKey(new Date())}`;
  try {
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
      res.send(toCsvGeneric([{ title: "재고", columns: INVENTORY_EXPORT_COLUMNS, rows }]));
    } else {
      const buf = await toXlsxBufferGeneric([{ name: "재고", columns: INVENTORY_EXPORT_COLUMNS, rows }]);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
      res.send(Buffer.from(buf));
    }
    logAdminAction(req, "inventory.export", "inventory", "export", { format, count: rows.length });
  } catch (e) {
    console.error("[admin/inventory/export] 생성 실패:", e.message);
    res.status(500).json({ error: "내보내기 파일 생성에 실패했습니다." });
  }
});

module.exports = router;
/* 공급처 입고 처리(routes/supplierShipments.js)도 재고를 늘리므로 같은 알림 함수를 쓴다(2026-11-10). */
module.exports.notifyRestockSubscribers = notifyRestockSubscribers;
