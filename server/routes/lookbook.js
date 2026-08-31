/* ---------- 룩북 (lookbook 테이블 — 관리자 패널에서 추가·수정·삭제) ----------
   data.js의 정적 LOOKBOOK은 마이그레이션 006을 실행하지 않은 서버나 조회 실패 시의 폴백으로만
   쓰인다. 돈·재고를 건드리지 않는 순수 CRUD + 사진 업로드라 server.js 본체에서 분리했다. */
const express = require("express");
const multer = require("multer");
const { LOOKBOOK: STATIC_LOOKBOOK } = require("../../소스 코드/assets/js/data.js");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { toLookbookDto, lookbookPatchFromBody } = require("../lib/lookbook");
const { uploadLookbookPhoto } = require("../lib/cloudinary");
const { paginationParams } = require("../lib/pagination");

const router = express.Router();

async function getActiveLookbook() {
  const { data, error } = await supabaseAdmin
    .from("lookbook")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[lookbook] DB 조회 실패, 정적 목록으로 폴백:", error.message);
    return STATIC_LOOKBOOK;
  }
  return data.map(toLookbookDto);
}

router.get("/api/lookbook", async (req, res) => {
  res.json(await getActiveLookbook());
});

router.get("/api/admin/lookbook", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query, { defaultSize: 50 });
  const { data, error, count } = await supabaseAdmin
    .from("lookbook")
    .select("*", { count: "exact" })
    .order("sort_order", { ascending: true })
    .range(from, to);

  if (error) return res.status(500).json({ error: "룩북 목록을 불러오지 못했습니다." });
  res.json({ items: data.map(toLookbookDto), page, pageSize, total: count ?? data.length });
});

router.post("/api/admin/lookbook", requireAdmin, async (req, res) => {
  const { patch, error: patchError } = lookbookPatchFromBody(req.body || {}, { forCreate: true });
  if (patchError) return res.status(400).json({ error: patchError });

  const { data, error } = await supabaseAdmin.from("lookbook").insert(patch).select().single();
  if (error) {
    console.error("[admin/lookbook] 생성 실패:", error.message);
    return res.status(500).json({ error: "룩북 항목 생성에 실패했습니다." });
  }
  logAdminAction(req, "lookbook.create", "lookbook", data.id, { label: data.label });
  res.json(toLookbookDto(data));
});

router.patch("/api/admin/lookbook/:id", requireAdmin, async (req, res) => {
  const { patch, error: patchError } = lookbookPatchFromBody(req.body || {}, { forCreate: false });
  if (patchError) return res.status(400).json({ error: patchError });
  if (!Object.keys(patch).length) return res.status(400).json({ error: "변경할 값이 없습니다." });
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("lookbook")
    .update(patch)
    .eq("id", req.params.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("[admin/lookbook] 수정 실패:", error.message);
    return res.status(500).json({ error: "수정에 실패했습니다." });
  }
  if (!data) return res.status(404).json({ error: "존재하지 않는 항목입니다." });
  logAdminAction(req, "lookbook.update", "lookbook", req.params.id, patch);
  res.json(toLookbookDto(data));
});

router.delete("/api/admin/lookbook/:id", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("lookbook").delete().eq("id", req.params.id);
  if (error) {
    console.error("[admin/lookbook] 삭제 실패:", error.message);
    return res.status(500).json({ error: "삭제에 실패했습니다." });
  }
  logAdminAction(req, "lookbook.delete", "lookbook", req.params.id);
  res.json({ ok: true });
});

const lookbookUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
}).single("photo");

router.post("/api/admin/lookbook/photo", requireAdmin, (req, res) => {
  lookbookUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: "사진 업로드에 실패했습니다(15MB 이하 이미지만 가능)." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "사진 파일이 없습니다." });
    }
    try {
      const url = await uploadLookbookPhoto(req.file.buffer);
      res.json({ url });
    } catch (e) {
      console.error("[admin/lookbook] 사진 업로드 실패:", e.message);
      res.status(500).json({ error: "사진 업로드에 실패했습니다." });
    }
  });
});

module.exports = router;
