/* ---------- 인수인계 노트 ----------
   로그인 직후 "오늘" 홈 화면에서 관리자끼리 "오늘 특이사항"을 짧게 남기는 게시판
   (037_handoff_notes_and_calendar.sql). 수정은 없고 작성·삭제만 가능 — 감사 로그와 같은
   원칙으로 무슨 일이 있었는지는 admin_audit_log에 남는다. 돈·재고를 건드리지 않는 순수
   CRUD라 다른 라우트들과 같은 이유로 분리했다. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { isMissingSchemaError } = require("../lib/pgErrors");

const router = express.Router();
const HANDOFF_NOTES_LIMIT = 15;

router.get("/api/admin/handoff-notes", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("admin_handoff_notes")
    .select("id, content, admin_email, created_at")
    .order("created_at", { ascending: false })
    .limit(HANDOFF_NOTES_LIMIT);

  if (error) {
    if (isMissingSchemaError(error)) return res.json({ items: [] }); // 037 미실행 — 조용히 빈 목록
    console.error("[handoff-notes] 조회 실패:", error.message);
    return res.status(500).json({ error: "인수인계 노트를 불러오지 못했습니다." });
  }
  res.json({ items: data.map((r) => ({ id: r.id, content: r.content, adminEmail: r.admin_email, at: r.created_at })) });
});

router.post("/api/admin/handoff-notes", requireAdmin, async (req, res) => {
  const content = String((req.body || {}).content || "").trim().slice(0, 500);
  if (!content) return res.status(400).json({ error: "내용을 입력해 주세요." });

  const { data, error } = await supabaseAdmin
    .from("admin_handoff_notes")
    .insert({ content, admin_email: req.user.email || "" })
    .select()
    .single();
  if (error) {
    console.error("[handoff-notes] 등록 실패:", error.message);
    return res.status(500).json({ error: "등록에 실패했습니다(마이그레이션 037을 실행했는지 확인해 주세요)." });
  }
  logAdminAction(req, "handoff_note.create", "handoff_note", data.id, { content });
  res.json({ id: data.id, content: data.content, adminEmail: data.admin_email, at: data.created_at });
});

router.delete("/api/admin/handoff-notes/:id", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("admin_handoff_notes").delete().eq("id", req.params.id);
  if (error) {
    console.error("[handoff-notes] 삭제 실패:", error.message);
    return res.status(500).json({ error: "삭제에 실패했습니다." });
  }
  logAdminAction(req, "handoff_note.delete", "handoff_note", req.params.id);
  res.json({ ok: true });
});

module.exports = router;
