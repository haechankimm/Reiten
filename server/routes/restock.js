/* ---------- 품절 알림 신청 ----------
   상품 상세에서 지금 고른 컬러·사이즈가 품절이면 이메일을 남겨 재입고 시 알림을 받을 수 있다
   (025_restock_subscriptions.sql). 실제로 재입고됐을 때 알림을 보내는 쪽(재고 탭 저장 시 0→양수
   전환 감지)은 server.js의 `PATCH /api/admin/inventory/bulk`에 있다 — 재고처럼 리스크가 있는
   영역과 얽혀 있어 그쪽은 분리하지 않고 그대로 뒀다. 여기는 신청 접수만 담당하는, 돈·재고
   쓰기가 없는 순수 접수 라우트라 별도 파일로 분리했다(2026-09-01). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { writeLimiter } = require("../lib/rateLimiters");
const { isMissingSchemaError } = require("../lib/pgErrors");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/api/restock-subscriptions", writeLimiter, async (req, res) => {
  const productId = String((req.body && req.body.productId) || "").trim();
  const color = String((req.body && req.body.color) || "").trim();
  const size = String((req.body && req.body.size) || "").trim();
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();

  if (!productId || !color || !size) {
    return res.status(400).json({ error: "상품·컬러·사이즈 정보가 필요합니다." });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "올바른 이메일 주소를 입력해 주세요." });
  }

  const { data: product, error: productError } = await supabaseAdmin
    .from("products")
    .select("id, colors, sizes")
    .eq("id", productId)
    .maybeSingle();
  if (productError) {
    console.error("[restock] 상품 조회 실패:", productError.message);
    return res.status(500).json({ error: "처리 중 오류가 발생했습니다." });
  }
  if (!product || !(product.colors || []).includes(color) || !(product.sizes || []).includes(size)) {
    return res.status(400).json({ error: "존재하지 않는 상품·컬러·사이즈 조합입니다." });
  }

  // 이미 같은 조합으로 미발송 신청이 있으면 중복 등록 대신 그대로 성공 처리한다(사용자 입장에선 같은 결과).
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("restock_subscriptions")
    .select("id")
    .eq("product_id", productId)
    .eq("color", color)
    .eq("size", size)
    .eq("email", email)
    .is("notified_at", null)
    .maybeSingle();
  if (isMissingSchemaError(existingError)) {
    // 테이블 없음(025 미실행) — 신청 기능 자체를 조용히 못 쓰게 함(다른 선택 기능과 같은 원칙).
    return res.status(503).json({ error: "지금은 품절 알림 신청을 받을 수 없습니다. 나중에 다시 시도해 주세요." });
  }
  if (existingError) {
    console.error("[restock] 기존 신청 조회 실패:", existingError.message);
    return res.status(500).json({ error: "처리 중 오류가 발생했습니다." });
  }
  if (existing) return res.json({ ok: true });

  const { error: insertError } = await supabaseAdmin
    .from("restock_subscriptions")
    .insert({ product_id: productId, color, size, email });
  if (insertError) {
    console.error("[restock] 신청 저장 실패:", insertError.message);
    return res.status(500).json({ error: "신청 저장에 실패했습니다." });
  }
  res.json({ ok: true });
});

module.exports = router;
