/* ---------- 상품 리뷰 ----------
   리뷰는 돈이 걸려 있지 않은 도메인이라(반품·환불과 달리) server.js에서 통째로 분리했다
   (2026-09-01, 라우트 분리 다음 라운드). */
const express = require("express");
const multer = require("multer");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { writeLimiter } = require("../lib/rateLimiters");
const { paginationParams } = require("../lib/pagination");
const { applyKstDateRangeFilter } = require("../lib/kst");
const { parseBulkIds } = require("../lib/bulk");
const { getAllProductIds } = require("../lib/productIds");
const { normalizeTel } = require("../lib/phone");
const { uploadReviewPhoto } = require("../lib/cloudinary");
const { isMissingColumnError } = require("../lib/pgErrors");

const router = express.Router();

const reviewUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
}).single("photo");

function toReviewDto(r) {
  return {
    id: r.id,
    productId: r.product_id,
    name: r.name,
    rating: r.rating,
    comment: r.comment,
    photoUrl: r.photo_url,
    instagramHandle: r.instagram_handle,
    helpfulCount: r.helpful_count || 0,
    approved: r.approved !== false,
    at: r.created_at,
  };
}

/* 승인된(approved=true) 리뷰만 공개 노출한다. 새로 등록된 리뷰는 관리자가 승인하기 전까지
   /api/admin/reviews에서만 보인다(스팸·부적절한 사진 방지, 005_reviews_approval.sql 참고). */
router.get("/api/reviews", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("reviews")
    .select("*")
    .eq("approved", true)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: "리뷰를 불러오지 못했습니다." });
  res.json(data.map(toReviewDto));
});

router.post("/api/reviews", writeLimiter, (req, res) => {
  reviewUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: "사진 업로드에 실패했습니다(15MB 이하 이미지만 가능)." });
    }

    const { productId, name, rating, comment, instagram, orderNo: reqOrderNo, tel } = req.body || {};

    const validProduct = productId === "general" || (await getAllProductIds()).includes(productId);
    if (!validProduct) {
      return res.status(400).json({ error: "존재하지 않는 상품입니다." });
    }

    /* 실구매 인증 — 021_reviews_order_verification.sql. 주문번호+연락처는 이미 order-lookup/
       반품신청에서 쓰는 것과 같은 조합(비회원도 자기 주문을 증명할 수 있는 유일한 방법이라
       로그인 여부와 무관하게 통일). "general"(상품 무관 후기)은 어떤 주문이든 있으면 되고,
       특정 상품 리뷰는 그 주문 items 안에 실제 그 productId가 있어야 한다. */
    const orderNoStr = String(reqOrderNo || "").trim();
    const telDigits = normalizeTel(tel);
    if (!orderNoStr || !telDigits) {
      return res.status(400).json({ error: "리뷰를 작성하려면 구매하신 주문번호와 연락처를 입력해 주세요." });
    }
    const { data: order, error: orderLookupError } = await supabaseAdmin
      .from("orders")
      .select("order_no, customer, items, status")
      .eq("order_no", orderNoStr)
      .maybeSingle();
    if (orderLookupError) {
      console.error("[reviews] 주문 조회 실패:", orderLookupError.message);
      return res.status(500).json({ error: "주문 확인 중 오류가 발생했습니다." });
    }
    if (!order || normalizeTel(order.customer.tel) !== telDigits) {
      return res.status(404).json({ error: "일치하는 주문을 찾을 수 없습니다. 주문번호와 연락처를 다시 확인해 주세요." });
    }
    if (order.status === "입금대기" || order.status === "취소") {
      return res.status(400).json({ error: "결제가 완료된 주문만 리뷰를 작성할 수 있습니다." });
    }
    if (productId !== "general" && !(order.items || []).some((it) => it.productId === productId)) {
      return res.status(400).json({ error: "이 주문 내역에서 해당 상품을 찾을 수 없습니다." });
    }

    const ratingNum = Math.round(Number(rating));
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: "별점은 1~5 사이여야 합니다." });
    }

    const nameStr = String(name || "").trim().slice(0, 40);
    const commentStr = String(comment || "").trim().slice(0, 1000);
    if (!nameStr || !commentStr) {
      return res.status(400).json({ error: "이름과 리뷰 내용을 입력해 주세요." });
    }

    // 인스타그램 아이디는 @ 없이 영문·숫자·마침표·밑줄만 허용
    const instaStr = String(instagram || "").trim().replace(/^@/, "");
    const instaValid = !instaStr || /^[a-zA-Z0-9._]{1,30}$/.test(instaStr);
    if (!instaValid) {
      return res.status(400).json({ error: "인스타그램 아이디 형식을 확인해 주세요." });
    }

    let photoUrl = null;
    if (req.file) {
      try {
        photoUrl = await uploadReviewPhoto(req.file.buffer);
      } catch (e) {
        console.error("[reviews] 사진 업로드 실패:", e.message);
        return res.status(500).json({ error: "사진 업로드에 실패했습니다." });
      }
    }

    const reviewRow = {
      product_id: productId,
      order_no: orderNoStr,
      name: nameStr,
      rating: ratingNum,
      comment: commentStr,
      photo_url: photoUrl,
      instagram_handle: instaStr || null,
      approved: false,
    };
    let { data, error } = await supabaseAdmin.from("reviews").insert(reviewRow).select().single();

    /* order_no 컬럼이 없음(021_reviews_order_verification.sql 미실행) — 위 구매인증 검증
       자체는 이미 통과했으니(주문 존재·연락처 일치·상품 일치 확인 끝) 리뷰 작성 자체를 막을
       이유는 없다. order_no 없이 다시 저장해 마이그레이션 전에도 리뷰 기능이 완전히 멈추지
       않게 한다(다른 선택 기능과 같은 "미실행 시 조용히 저하" 원칙 — 다만 이 경우는 중복
       리뷰 차단·구매인증 배지만 못 켜지고, 실구매 검증 자체는 그대로 됨). */
    if (isMissingColumnError(error)) {
      console.warn("[reviews] reviews.order_no 컬럼 없음(마이그레이션 021 미실행) — order_no 없이 저장");
      const { order_no, ...fallbackRow } = reviewRow;
      ({ data, error } = await supabaseAdmin.from("reviews").insert(fallbackRow).select().single());
    }

    if (error) {
      // 23505 = reviews_order_product_uidx 위반 — 같은 주문으로 같은 상품에 이미 리뷰를 남긴 경우.
      if (error.code === "23505") {
        return res.status(409).json({ error: "이미 이 주문으로 작성한 리뷰가 있습니다." });
      }
      console.error("[reviews] 저장 실패:", error.message);
      return res.status(500).json({ error: "리뷰 저장에 실패했습니다." });
    }

    res.json(toReviewDto(data));
  });
});

router.post("/api/reviews/:id/helpful", writeLimiter, async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc("increment_helpful", { p_id: req.params.id });
  if (error) {
    console.error("[reviews] 공감 처리 실패:", error.message);
    return res.status(500).json({ error: "처리에 실패했습니다." });
  }
  res.json({ helpfulCount: data });
});

/* ---------- 리뷰 승인 (관리자만) ----------
   승인 대기(approved=false)인 리뷰가 먼저 오도록 정렬해 관리자가 검수할 목록을 바로 볼 수 있게 한다. */
/* 리뷰 목록 필터 — q는 작성자명·내용·상품ID 부분 일치, status는 approved/pending(게시중/승인 대기). */
function applyReviewFilters(query, reqQuery) {
  const { q, status, dateFrom, dateTo } = reqQuery;
  if (q) {
    const v = String(q).trim().slice(0, 60).replace(/[%,()]/g, "");
    if (v) query = query.or(`name.ilike.%${v}%,comment.ilike.%${v}%,product_id.ilike.%${v}%`);
  }
  if (status === "approved") query = query.eq("approved", true);
  else if (status === "pending") query = query.eq("approved", false);
  query = applyKstDateRangeFilter(query, "created_at", dateFrom, dateTo);
  return query;
}

router.get("/api/admin/reviews", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query);
  let query = supabaseAdmin
    .from("reviews")
    .select("*", { count: "exact" })
    .order("approved", { ascending: true })
    .order("created_at", { ascending: false });
  query = applyReviewFilters(query, req.query);
  const { data, error, count } = await query.range(from, to);

  if (error) return res.status(500).json({ error: "리뷰 목록을 불러오지 못했습니다." });
  /* orderNo는 공개 API(toReviewDto)에는 없다 — 다른 고객의 주문번호가 공개 리뷰 목록에
     노출되면 안 되므로, 관리자 전용 응답에서만 따로 붙인다(실구매 인증 여부를 admin이
     한눈에 볼 수 있도록 — 021_reviews_order_verification.sql 이전 리뷰는 null). */
  res.json({ items: data.map((r) => ({ ...toReviewDto(r), orderNo: r.order_no || null })), page, pageSize, total: count ?? data.length });
});

/* 리뷰 일괄 승인/숨기기 — 돈이 걸린 반품·환불과 달리 승인/숨김은 되돌리기 쉬운 안전한 동작이라
   상품 일괄 처리와 같은 패턴으로 bulk를 만든다. ⚠️ 반드시 아래 `/:id`보다 먼저 등록해야 한다
   (products/orders bulk와 같은 이유 — 위 0번 섹션의 라우트 순서 버그 참고). */
router.patch("/api/admin/reviews/bulk-approve", requireAdmin, async (req, res) => {
  const ids = parseBulkIds(req.body);
  const approved = !!(req.body && req.body.approved);
  if (!ids.length) return res.status(400).json({ error: "ids가 필요합니다." });

  const { error } = await supabaseAdmin.from("reviews").update({ approved }).in("id", ids);
  if (error) {
    console.error("[admin/reviews] 일괄 승인 처리 실패:", error.message);
    return res.status(500).json({ error: "일괄 처리에 실패했습니다." });
  }
  logAdminAction(req, "review.bulk_approve", "review", `${ids.length}건`, { ids, approved });
  res.json({ ok: true, count: ids.length });
});

router.patch("/api/admin/reviews/:id", requireAdmin, async (req, res) => {
  const { approved } = req.body || {};
  if (typeof approved !== "boolean") {
    return res.status(400).json({ error: "approved(true/false)가 필요합니다." });
  }
  const { error } = await supabaseAdmin.from("reviews").update({ approved }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "승인 처리에 실패했습니다." });
  logAdminAction(req, "review.update", "review", req.params.id, { approved });
  res.json({ ok: true });
});

router.delete("/api/admin/reviews/:id", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("reviews").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "삭제에 실패했습니다." });
  logAdminAction(req, "review.delete", "review", req.params.id);
  res.json({ ok: true });
});

module.exports = router;
