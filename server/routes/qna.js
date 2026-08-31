/* ---------- 상품 Q&A + CS 빠른 답변 템플릿 ---------- */
const express = require("express");
const { PRODUCTS: STATIC_PRODUCTS } = require("../../소스 코드/assets/js/data.js");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin, optionalAuth } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { writeLimiter } = require("../lib/rateLimiters");
const { paginationParams } = require("../lib/pagination");
const { applyKstDateRangeFilter } = require("../lib/kst");

const router = express.Router();

/* server.js의 리뷰 라우트도 똑같은 함수를 갖고 있다(4줄짜리 정적 폴백 조회라 굳이 별도
   공용 모듈로 안 뺐음 — 리뷰까지 분리할 때 같이 lib로 옮기면 됨). */
async function getAllProductIds() {
  const { data, error } = await supabaseAdmin.from("products").select("id");
  if (error) return STATIC_PRODUCTS.map((p) => p.id);
  return data.map((r) => r.id);
}

function toQnaDto(q, { redact } = {}) {
  const hide = redact && q.secret;
  return {
    id: q.id,
    productId: q.product_id,
    name: q.name,
    question: hide ? null : q.question,
    secret: q.secret,
    answer: hide ? null : q.answer,
    status: q.status,
    at: q.created_at,
    answeredAt: q.answered_at,
  };
}

router.get("/api/qna", optionalAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("qna")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: "문의 목록을 불러오지 못했습니다." });

  res.json(
    data.map((q) => toQnaDto(q, { redact: !(req.user && req.user.id === q.user_id) }))
  );
});

router.post("/api/qna", writeLimiter, optionalAuth, async (req, res) => {
  const { productId, name, question, secret } = req.body || {};

  const validProduct = productId === "general" || (await getAllProductIds()).includes(productId);
  if (!validProduct) {
    return res.status(400).json({ error: "존재하지 않는 상품입니다." });
  }

  const nameStr = String(name || "").trim().slice(0, 40);
  const questionStr = String(question || "").trim().slice(0, 1000);
  if (!nameStr || !questionStr) {
    return res.status(400).json({ error: "이름과 문의 내용을 입력해 주세요." });
  }

  const { data, error } = await supabaseAdmin
    .from("qna")
    .insert({
      product_id: productId,
      user_id: req.user ? req.user.id : null,
      name: nameStr,
      question: questionStr,
      secret: !!secret,
    })
    .select()
    .single();

  if (error) {
    console.error("[qna] 저장 실패:", error.message);
    return res.status(500).json({ error: "문의 등록에 실패했습니다." });
  }

  res.json(toQnaDto(data, { redact: false }));
});

/* 문의 목록 필터 — q는 작성자명·문의내용·상품ID 부분 일치, status는 "답변대기"/"답변완료". */
function applyQnaFilters(query, reqQuery) {
  const { q, status, dateFrom, dateTo } = reqQuery;
  if (q) {
    const v = String(q).trim().slice(0, 60).replace(/[%,()]/g, "");
    if (v) query = query.or(`name.ilike.%${v}%,question.ilike.%${v}%,product_id.ilike.%${v}%`);
  }
  if (status) query = query.eq("status", status);
  query = applyKstDateRangeFilter(query, "created_at", dateFrom, dateTo);
  return query;
}

router.get("/api/admin/qna", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query);
  let query = supabaseAdmin
    .from("qna")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });
  query = applyQnaFilters(query, req.query);
  const { data, error, count } = await query.range(from, to);

  if (error) return res.status(500).json({ error: "문의 목록을 불러오지 못했습니다." });
  res.json({ items: data.map((q) => toQnaDto(q, { redact: false })), page, pageSize, total: count ?? data.length });
});

router.patch("/api/admin/qna/:id", requireAdmin, async (req, res) => {
  const { answer } = req.body || {};
  const answerStr = String(answer || "").trim().slice(0, 2000);
  if (!answerStr) {
    return res.status(400).json({ error: "답변 내용을 입력해 주세요." });
  }

  const { error } = await supabaseAdmin
    .from("qna")
    .update({ answer: answerStr, status: "답변완료", answered_at: new Date().toISOString() })
    .eq("id", req.params.id);

  if (error) return res.status(500).json({ error: "답변 저장에 실패했습니다." });
  logAdminAction(req, "qna.answer", "qna", req.params.id);
  res.json({ ok: true });
});

/* ---------- CS 빠른 답변 템플릿 (023_qna_templates.sql, 024_qna_template_keywords.sql) ----------
   완전 자동응답이 아니라 관리자가 QnA 답변창에서 자주 쓰는 문구를 버튼 한 번으로 채워 넣는
   용도 — 답변 시간만 줄여준다. 마이그레이션 미실행 시(42P01, 테이블 없음) 빈 목록만 내려주고
   조용히 실패해 QnA 답변 작성 자체엔 지장이 없게 한다. */
router.get("/api/admin/qna-templates", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("qna_templates").select("*").order("created_at", { ascending: true });
  if (error) return res.json({ items: [] });
  res.json({ items: data.map((t) => ({ id: t.id, label: t.label, body: t.body, keywords: t.keywords || [] })) });
});

router.post("/api/admin/qna-templates", requireAdmin, async (req, res) => {
  const label = String((req.body || {}).label || "").trim().slice(0, 60);
  const body = String((req.body || {}).body || "").trim().slice(0, 2000);
  /* 문의 본문과 대조할 키워드 — QnA 답변창에서 이 템플릿을 기본 선택해주는 용도(자동 매칭). */
  const keywords = Array.isArray((req.body || {}).keywords)
    ? (req.body.keywords).map((k) => String(k).trim()).filter(Boolean).slice(0, 20)
    : [];
  if (!label || !body) return res.status(400).json({ error: "이름과 답변 내용을 입력해 주세요." });

  let { data, error } = await supabaseAdmin.from("qna_templates").insert({ label, body, keywords }).select().single();
  if (error && error.code === "PGRST204") {
    // keywords 컬럼 없음(마이그레이션 024 미실행) — 키워드 없이 재시도.
    ({ data, error } = await supabaseAdmin.from("qna_templates").insert({ label, body }).select().single());
  }
  if (error) return res.status(500).json({ error: "템플릿 저장에 실패했습니다(마이그레이션 023이 실행됐는지 확인해 주세요)." });
  logAdminAction(req, "qna_template.create", "qna_template", data.id, { label });
  res.json({ id: data.id, label: data.label, body: data.body, keywords: data.keywords || [] });
});

router.delete("/api/admin/qna-templates/:id", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("qna_templates").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "삭제에 실패했습니다." });
  logAdminAction(req, "qna_template.delete", "qna_template", req.params.id);
  res.json({ ok: true });
});

module.exports = router;
