/* ---------- 관리자 공지·게시판 ----------
   관리자가 여러 명이 되면서(2026-09-01 마스터 관리자 도입) "정보" 탭의 단순 키-값 메모만으로는
   "누가 언제 무슨 공지를 남겼는지"가 안 남았다 — 작성자·날짜가 남는 간단한 게시판을 따로 둔다
   (031_notices.sql, 2026-09 요청). 돈·재고를 안 건드리는 순수 CRUD라 처음부터 별도 파일로 둠.
   수정·삭제는 본인 글이거나 마스터 관리자만 — 다른 관리자의 글을 함부로 못 건드리게 막되,
   마스터는 관리 목적으로 예외를 둔다(admins.js·members.js의 마스터 게이팅과 같은 원칙). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin, MASTER_ADMIN_EMAIL } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { paginationParams } = require("../lib/pagination");

const router = express.Router();

function toNoticeDto(r) {
  return { id: r.id, authorEmail: r.author_email, title: r.title, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at };
}

function isMaster(req) {
  return (req.user.email || "").toLowerCase() === MASTER_ADMIN_EMAIL;
}

router.get("/api/admin/notices", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query, { defaultSize: 20 });
  const { data, error, count } = await supabaseAdmin
    .from("notices")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) return res.status(500).json({ error: "공지를 불러오지 못했습니다." });
  res.json({ items: data.map(toNoticeDto), page, pageSize, total: count ?? data.length, currentAdminEmail: req.user.email || "" });
});

router.post("/api/admin/notices", requireAdmin, async (req, res) => {
  const title = String((req.body && req.body.title) || "").trim();
  const body = String((req.body && req.body.body) || "").trim();
  if (!title || !body) return res.status(400).json({ error: "제목과 내용을 모두 입력해 주세요." });
  if (title.length > 100) return res.status(400).json({ error: "제목은 100자 이내로 입력해 주세요." });

  const { data, error } = await supabaseAdmin
    .from("notices")
    .insert({ author_id: req.user.id, author_email: req.user.email || "", title, body })
    .select()
    .single();
  if (error) return res.status(500).json({ error: "공지 등록에 실패했습니다." });
  logAdminAction(req, "notice.create", "notice", data.id, { title });
  res.json(toNoticeDto(data));
});

/* 본인 글이거나 마스터가 아니면 대상 자체를 못 찾은 것처럼 404로 막는다(다른 관리자 글이
   존재한다는 사실 자체를 굳이 드러낼 필요 없음 — 목록에서는 어차피 다 보이지만, 수정·삭제
   시도에 대한 응답에서는 "권한 없음"보다 "그런 글 없음" 쪽이 조작 여지를 덜 준다는 판단). */
async function requireOwnNotice(req, res) {
  const { data: notice, error } = await supabaseAdmin.from("notices").select("author_id").eq("id", req.params.id).maybeSingle();
  if (error) {
    res.status(500).json({ error: "공지 확인에 실패했습니다." });
    return false;
  }
  if (!notice || (notice.author_id !== req.user.id && !isMaster(req))) {
    res.status(404).json({ error: "존재하지 않는 공지입니다." });
    return false;
  }
  return true;
}

router.patch("/api/admin/notices/:id", requireAdmin, async (req, res) => {
  if (!(await requireOwnNotice(req, res))) return;
  const title = req.body && req.body.title !== undefined ? String(req.body.title).trim() : undefined;
  const body = req.body && req.body.body !== undefined ? String(req.body.body).trim() : undefined;
  if (title !== undefined && !title) return res.status(400).json({ error: "제목을 입력해 주세요." });
  if (body !== undefined && !body) return res.status(400).json({ error: "내용을 입력해 주세요." });

  const patch = { updated_at: new Date().toISOString() };
  if (title !== undefined) patch.title = title;
  if (body !== undefined) patch.body = body;

  const { data, error } = await supabaseAdmin.from("notices").update(patch).eq("id", req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: "공지 수정에 실패했습니다." });
  logAdminAction(req, "notice.update", "notice", req.params.id, patch);
  res.json(toNoticeDto(data));
});

router.delete("/api/admin/notices/:id", requireAdmin, async (req, res) => {
  if (!(await requireOwnNotice(req, res))) return;
  const { error } = await supabaseAdmin.from("notices").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "공지 삭제에 실패했습니다." });
  logAdminAction(req, "notice.delete", "notice", req.params.id);
  res.json({ ok: true });
});

module.exports = router;
