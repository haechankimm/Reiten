/* 쿠폰 관리·쿠폰 확인·적립금 잔액 — server.js에서 분리(2026-11-09, 동작 변경 없음). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAuth, requireAdmin } = require("../lib/auth");
const { priceItem } = require("../lib/pricing");
const { resolveCoupon } = require("../lib/coupons");
const { getPointsBalance } = require("../lib/loyaltyPoints");
const { logAdminAction } = require("../lib/adminLog");
const { couponLimiter } = require("../lib/rateLimiters");
const { getActiveProducts } = require("../lib/catalog");
const { PRICE_OPTS } = require("../lib/orderPricing");

const router = express.Router();

/* ---------- 쿠폰(할인코드) ----------
   할인 유무·적용 상품·기간·사용횟수 전부 관리자가 자유롭게 만들 수 있게 한다(013_coupons.sql).
   실제 유효성 검사·할인 계산은 resolveCoupon/couponDiscount(주문 생성 경로에서 재사용)가 맡고,
   여기는 순수 CRUD만 담당한다. */
function toCouponDto(c) {
  return {
    code: c.code,
    discountType: c.discount_type,
    discountValue: c.discount_value,
    scope: c.scope,
    productIds: c.product_ids || [],
    minSubtotal: c.min_subtotal,
    usageLimit: c.usage_limit,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    active: c.active,
    createdAt: c.created_at,
  };
}

function couponPatchFromBody(body, { forCreate, existingDiscountType, existingDiscountValue }) {
  const patch = {};
  if (forCreate || body.discountType !== undefined) {
    if (!["percent", "amount"].includes(body.discountType)) {
      return { error: "discountType은 percent 또는 amount여야 합니다." };
    }
    patch.discount_type = body.discountType;
    /* 할인 방식만 정률로 바꾸면 기존 값(예: 1000원)이 그대로 1000%가 됐다 — 값을 같이 안 보내도 기존 값으로 검사한다(2026-10-28) */
    if (!forCreate && body.discountValue === undefined && body.discountType === "percent" && Number(existingDiscountValue) > 100) {
      return { error: "정률 할인은 100을 넘을 수 없습니다." };
    }
  }
  if (forCreate || body.discountValue !== undefined) {
    const v = Math.floor(Number(body.discountValue));
    if (!Number.isFinite(v) || v <= 0) return { error: "discountValue는 0보다 큰 숫자여야 합니다." };
    /* discountType을 이번 요청에 안 보내는 PATCH(예: discountValue만 수정)라도, 그 쿠폰이
       DB에 이미 percent로 저장돼 있으면 여전히 100을 넘으면 안 된다 — body.discountType만
       보면 이 경우를 놓쳐서 API를 직접 호출하면 상한 우회가 가능했다. */
    if ((body.discountType || patch.discount_type || existingDiscountType) === "percent" && v > 100) {
      return { error: "정률 할인은 100을 넘을 수 없습니다." };
    }
    patch.discount_value = v;
  }
  if (forCreate || body.scope !== undefined) {
    if (!["all", "products"].includes(body.scope)) return { error: "scope는 all 또는 products여야 합니다." };
    patch.scope = body.scope;
  }
  if (forCreate || body.productIds !== undefined) {
    patch.product_ids = Array.isArray(body.productIds) ? body.productIds.filter((id) => typeof id === "string") : [];
  }
  if (forCreate || body.minSubtotal !== undefined) {
    patch.min_subtotal = Math.max(0, Math.floor(Number(body.minSubtotal) || 0));
  }
  if (body.usageLimit !== undefined) {
    if (body.usageLimit === null || body.usageLimit === "") patch.usage_limit = null;
    else {
      // 숫자가 아닌 값이 들어오면 NaN이 저장돼 결과적으로 "무제한" 쿠폰이 됐다(2026-10-28 정기 감사)
      const n = Math.floor(Number(body.usageLimit));
      if (!Number.isFinite(n) || n < 1) return { error: "사용 한도는 1 이상의 숫자로 입력해 주세요." };
      patch.usage_limit = n;
    }
  }
  if (body.startsAt !== undefined) patch.starts_at = body.startsAt || null;
  if (body.endsAt !== undefined) patch.ends_at = body.endsAt || null;
  if (body.active !== undefined) patch.active = Boolean(body.active);
  return { patch };
}

router.get("/api/admin/coupons", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("coupons").select("*").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: "쿠폰 목록을 불러오지 못했습니다." });
  res.json(data.map(toCouponDto));
});

router.post("/api/admin/coupons", requireAdmin, async (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase().slice(0, 40);
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    return res.status(400).json({ error: "코드는 영문 대문자·숫자·하이픈·언더바 3~40자여야 합니다." });
  }
  const { patch, error: patchError } = couponPatchFromBody(req.body || {}, { forCreate: true });
  if (patchError) return res.status(400).json({ error: patchError });

  const { data, error } = await supabaseAdmin.from("coupons").insert({ code, ...patch }).select().single();
  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "이미 존재하는 쿠폰 코드입니다." });
    return res.status(500).json({ error: "쿠폰 생성에 실패했습니다." });
  }
  logAdminAction(req, "coupon.create", "coupon", code, patch);
  res.json(toCouponDto(data));
});

router.patch("/api/admin/coupons/:code", requireAdmin, async (req, res) => {
  const { data: existing } = await supabaseAdmin
    .from("coupons")
    .select("discount_type, discount_value")
    .eq("code", req.params.code.toUpperCase())
    .maybeSingle();
  const { patch, error: patchError } = couponPatchFromBody(req.body || {}, {
    forCreate: false,
    existingDiscountType: existing?.discount_type,
    existingDiscountValue: existing?.discount_value,
  });
  if (patchError) return res.status(400).json({ error: patchError });
  if (!Object.keys(patch).length) return res.status(400).json({ error: "변경할 값이 없습니다." });

  const { data, error } = await supabaseAdmin
    .from("coupons")
    .update(patch)
    .eq("code", req.params.code.toUpperCase())
    .select()
    .single();
  if (error) return res.status(500).json({ error: "쿠폰 수정에 실패했습니다." });
  logAdminAction(req, "coupon.update", "coupon", req.params.code, patch);
  res.json(toCouponDto(data));
});

router.delete("/api/admin/coupons/:code", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("coupons").delete().eq("code", req.params.code.toUpperCase());
  if (error) return res.status(500).json({ error: "쿠폰 삭제에 실패했습니다." });
  logAdminAction(req, "coupon.delete", "coupon", req.params.code);
  res.json({ ok: true });
});

/* 고객 화면(장바구니)에서 코드를 입력했을 때 실시간으로 할인액을 미리 보여주기 위한 공개 엔드포인트.
   실제 할인은 여기서 확정되는 게 아니라 /api/order·/api/payments/prepare가 다시 한번 resolveCoupon을
   불러 서버에서 재계산한다 — 이 엔드포인트는 순전히 미리보기용이라 위·변조돼도 결제 금액엔 영향 없다. */
router.post("/api/coupons/validate", couponLimiter, async (req, res) => {
  const { code, items: rawItems } = req.body || {};
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return res.status(400).json({ error: "장바구니 항목이 없습니다." });
  }
  const products = await getActiveProducts();
  const items = rawItems.map((raw) => priceItem(raw, products, PRICE_OPTS));
  if (items.some((it) => it === null)) {
    return res.status(400).json({ error: "존재하지 않는 상품 또는 잘못된 수량이 포함되어 있습니다." });
  }
  const subtotal = items.reduce((s, it) => s + it.sum, 0);

  try {
    const coupon = await resolveCoupon(supabaseAdmin, code, { rawItems, items, subtotal });
    res.json(coupon);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, i18n: e.i18n });
  }
});

/* 로그인한 회원의 적립금 잔액 — 장바구니에서 "포인트 사용"을 켜기 전에 얼마나 남았는지 보여주는
   용도(034_loyalty_points.sql). 실제 사용 금액은 쿠폰과 같은 원칙으로 /api/order·
   /api/payments/prepare가 다시 clamp해서 재계산하므로, 여기서 조작해도 결제 금액엔 영향 없다. */
router.get("/api/points/balance", requireAuth, async (req, res) => {
  const balance = await getPointsBalance(supabaseAdmin, req.user.id);
  res.json({ balance });
});

module.exports = router;
