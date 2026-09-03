/* ---------- 상품 관리 (관리자만) ----------
   목록(GET)은 active 여부와 무관하게 전부 보여주고, 생성·수정·삭제는 관리자 인증을 거친다.
   공개 목록(GET /api/products)은 실제 결제 흐름(가격 검증 등)과 캐시를 공유해 server.js에
   그대로 남아있다 — 여기서 분리한 건 결제·재고와 얽히지 않는 관리자 CRUD뿐이다
   (2026-09-01, 라우트 분리 다음 라운드). */
const express = require("express");
const multer = require("multer");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { getValidColorMap } = require("../lib/colors");
const { parseBulkIds } = require("../lib/bulk");
const { toProductDto, productPatchFromBody } = require("../lib/products");
const { uploadProductPhoto } = require("../lib/cloudinary");
const { paginationParams } = require("../lib/pagination");

const router = express.Router();

router.get("/api/admin/products", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query, { defaultSize: 50 });
  const { data, error, count } = await supabaseAdmin
    .from("products")
    .select("*", { count: "exact" })
    .order("sort_order", { ascending: true })
    .range(from, to);

  if (error) return res.status(500).json({ error: "상품 목록을 불러오지 못했습니다." });
  res.json({ items: data.map(toProductDto), page, pageSize, total: count ?? data.length });
});

router.post("/api/admin/products", requireAdmin, async (req, res) => {
  const b = req.body || {};
  const id = String(b.id || "").trim();
  if (!/^[a-z0-9-]{2,60}$/.test(id)) {
    return res.status(400).json({ error: "상품 ID는 영문 소문자·숫자·하이픈만 2~60자로 입력해 주세요." });
  }

  const { patch, error: patchError } = productPatchFromBody(b, { forCreate: true, validColors: await getValidColorMap() });
  if (patchError) return res.status(400).json({ error: patchError });

  const { data, error } = await supabaseAdmin
    .from("products")
    .insert({ id, ...patch })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "이미 존재하는 상품 ID입니다." });
    console.error("[admin/products] 생성 실패:", error.message);
    return res.status(500).json({ error: "상품 생성에 실패했습니다." });
  }
  logAdminAction(req, "product.create", "product", data.id, { name: data.name_ko });
  res.json(toProductDto(data));
});

/* ---------- 상품 일괄 처리 ----------
   공개/비공개·컬러 추가·삭제처럼 여러 상품을 한 번에 매만지는 작업. 상품 하나씩 API를
   반복 호출해도 되지만(클라이언트에서 루프), 그러면 활동 로그에 상품 수만큼 항목이
   따로따로 쌓여 지저분해진다(재고 탭 일괄저장 때와 같은 이유) — 서버가 한 번에 처리하고
   활동 로그도 한 줄만 남긴다.
   ⚠️ 반드시 아래 `/:id`(PATCH·DELETE) 라우트보다 먼저 등록해야 한다 — Express는 등록
   순서대로 매칭을 시도하는데 `:id` 패턴은 슬래시 없는 문자열이면 "bulk-active"·"bulk-color"·
   "bulk" 같은 리터럴 경로도 그대로 흡수해버린다(2026-09-01 코드 감사에서 발견: 이 순서가
   뒤바뀐 채 배포돼 있어 상품·주문 일괄 처리가 실제로는 항상 실패하고 있었음 — 위 0번 섹션 참고). */
router.patch("/api/admin/products/bulk-active", requireAdmin, async (req, res) => {
  const ids = parseBulkIds(req.body);
  const active = !!(req.body && req.body.active);
  if (!ids.length) return res.status(400).json({ error: "ids가 필요합니다." });

  const { error } = await supabaseAdmin.from("products").update({ active, updated_at: new Date().toISOString() }).in("id", ids);
  if (error) {
    console.error("[admin/products] 일괄 공개/비공개 실패:", error.message);
    return res.status(500).json({ error: "일괄 처리에 실패했습니다." });
  }
  logAdminAction(req, "product.bulk_active", "product", `${ids.length}건`, { ids, active });
  res.json({ ok: true, count: ids.length });
});

router.patch("/api/admin/products/bulk-color", requireAdmin, async (req, res) => {
  const ids = parseBulkIds(req.body);
  const color = String((req.body && req.body.color) || "").trim();
  if (!ids.length) return res.status(400).json({ error: "ids가 필요합니다." });
  const validColors = await getValidColorMap();
  if (!color || !validColors[color]) return res.status(400).json({ error: "존재하지 않는 컬러입니다." });

  const { data: rows, error: fetchError } = await supabaseAdmin.from("products").select("id, colors").in("id", ids);
  if (fetchError) {
    console.error("[admin/products] 일괄 컬러 추가 조회 실패:", fetchError.message);
    return res.status(500).json({ error: "일괄 처리에 실패했습니다." });
  }

  // 컬러를 상품마다 추가(이미 있으면 건너뜀)해야 해서 한 번의 UPDATE로 끝낼 수 없다 — 상품별로 upsert.
  const updates = rows
    .filter((r) => !(r.colors || []).includes(color))
    .map((r) => ({ id: r.id, colors: [...(r.colors || []), color] }));
  if (updates.length) {
    const { error: updateError } = await supabaseAdmin.from("products").upsert(updates, { onConflict: "id" });
    if (updateError) {
      console.error("[admin/products] 일괄 컬러 추가 실패:", updateError.message);
      return res.status(500).json({ error: "일괄 처리에 실패했습니다." });
    }
  }
  logAdminAction(req, "product.bulk_color", "product", `${ids.length}건`, { ids, color, updated: updates.length });
  res.json({ ok: true, count: updates.length });
});

/* 일괄 가격 수정(2026-09) — 세일 시즌에 여러 상품 가격을 한 번에 바꾸는 용도. 세 모드:
   percent(현재가 대비 ±%, 반올림) · fixed(현재가에 고정액 더하기/빼기) · set(선택한 전부를
   같은 값으로). set은 상품마다 값이 똑같아 한 번의 UPDATE로 끝나지만, percent·fixed는
   상품마다 "현재가"가 달라 결과가 다르므로 bulk-color처럼 먼저 조회한 뒤 upsert한다.
   음수·0원이 되는 걸 막기 위해 최종값을 1원 이상으로 clamp한다. */
router.patch("/api/admin/products/bulk-price", requireAdmin, async (req, res) => {
  const ids = parseBulkIds(req.body);
  const mode = String((req.body && req.body.mode) || "");
  const value = Number(req.body && req.body.value);
  if (!ids.length) return res.status(400).json({ error: "ids가 필요합니다." });
  if (!["percent", "fixed", "set"].includes(mode)) return res.status(400).json({ error: "mode는 percent·fixed·set 중 하나여야 합니다." });
  if (!Number.isFinite(value)) return res.status(400).json({ error: "값을 입력해 주세요." });

  if (mode === "set") {
    const price = Math.floor(value);
    if (price <= 0) return res.status(400).json({ error: "가격은 0보다 커야 합니다." });
    const { error } = await supabaseAdmin.from("products").update({ price, updated_at: new Date().toISOString() }).in("id", ids);
    if (error) {
      console.error("[admin/products] 일괄 가격 수정(set) 실패:", error.message);
      return res.status(500).json({ error: "일괄 가격 수정에 실패했습니다." });
    }
    logAdminAction(req, "product.bulk_price", "product", `${ids.length}건`, { ids, mode, value, price });
    return res.json({ ok: true, count: ids.length });
  }

  const { data: rows, error: fetchError } = await supabaseAdmin.from("products").select("id, price").in("id", ids);
  if (fetchError) {
    console.error("[admin/products] 일괄 가격 수정 조회 실패:", fetchError.message);
    return res.status(500).json({ error: "일괄 가격 수정에 실패했습니다." });
  }

  const updates = rows.map((r) => {
    const next = mode === "percent" ? Math.round(r.price * (1 + value / 100)) : r.price + Math.floor(value);
    return { id: r.id, price: Math.max(1, next), updated_at: new Date().toISOString() };
  });
  if (updates.length) {
    const { error: updateError } = await supabaseAdmin.from("products").upsert(updates, { onConflict: "id" });
    if (updateError) {
      console.error("[admin/products] 일괄 가격 수정 실패:", updateError.message);
      return res.status(500).json({ error: "일괄 가격 수정에 실패했습니다." });
    }
  }
  logAdminAction(req, "product.bulk_price", "product", `${ids.length}건`, { ids, mode, value });
  res.json({ ok: true, count: updates.length });
});

router.delete("/api/admin/products/bulk", requireAdmin, async (req, res) => {
  const ids = parseBulkIds(req.body);
  if (!ids.length) return res.status(400).json({ error: "ids가 필요합니다." });

  const { error } = await supabaseAdmin.from("products").delete().in("id", ids);
  if (error) {
    console.error("[admin/products] 일괄 삭제 실패:", error.message);
    return res.status(500).json({ error: "일괄 삭제에 실패했습니다." });
  }
  await supabaseAdmin.from("inventory").delete().in("product_id", ids);
  logAdminAction(req, "product.bulk_delete", "product", `${ids.length}건`, { ids });
  res.json({ ok: true, count: ids.length });
});

router.patch("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const { patch, error: patchError } = productPatchFromBody(req.body || {}, { forCreate: false, validColors: await getValidColorMap() });
  if (patchError) return res.status(400).json({ error: patchError });
  if (!Object.keys(patch).length) return res.status(400).json({ error: "변경할 값이 없습니다." });
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("products")
    .update(patch)
    .eq("id", req.params.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("[admin/products] 수정 실패:", error.message);
    return res.status(500).json({ error: "상품 수정에 실패했습니다." });
  }
  if (!data) return res.status(404).json({ error: "존재하지 않는 상품입니다." });
  logAdminAction(req, "product.update", "product", req.params.id, patch);
  res.json(toProductDto(data));
});

router.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("products").delete().eq("id", req.params.id);
  if (error) {
    console.error("[admin/products] 삭제 실패:", error.message);
    return res.status(500).json({ error: "상품 삭제에 실패했습니다." });
  }
  // 삭제된 상품에 딸린 재고 행도 함께 정리한다(없어도 동작에는 지장 없지만 관리자 재고 탭이 지저분해짐).
  await supabaseAdmin.from("inventory").delete().eq("product_id", req.params.id);
  logAdminAction(req, "product.delete", "product", req.params.id);
  res.json({ ok: true });
});

const productUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
}).single("photo");

router.post("/api/admin/products/photo", requireAdmin, (req, res) => {
  productUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: "사진 업로드에 실패했습니다(15MB 이하 이미지만 가능)." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "사진 파일이 없습니다." });
    }
    try {
      const url = await uploadProductPhoto(req.file.buffer);
      res.json({ url });
    } catch (e) {
      console.error("[admin/products] 사진 업로드 실패:", e.message);
      res.status(500).json({ error: "사진 업로드에 실패했습니다." });
    }
  });
});

module.exports = router;
