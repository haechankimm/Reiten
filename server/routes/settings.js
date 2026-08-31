/* ---------- 관리자 참고정보(정보 탭) ----------
   Works 관리자 패널에서 사업자 정보 요약이나 Supabase·Render 같은 운영 사이트 링크를
   직접 적어두고 보는 용도. 비밀번호·API 키 등 민감정보는 여기 넣지 않는다(관리자 전원 열람 가능).
   돈·재고를 건드리지 않는 순수 CRUD라 server.js 본체에서 가장 먼저 분리한 라우트 그룹 중 하나. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");

const router = express.Router();

function toSettingDto(row) {
  return {
    id: row.id,
    label: row.label,
    value: row.value || "",
    note: row.note || "",
    sortOrder: row.sort_order,
  };
}

router.get("/api/admin/settings", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("admin_settings").select("*").order("sort_order", { ascending: true });
  if (error) return res.status(500).json({ error: "정보를 불러오지 못했습니다." });
  res.json(data.map(toSettingDto));
});

router.post("/api/admin/settings", requireAdmin, async (req, res) => {
  const { label, value, note, sortOrder } = req.body || {};
  const labelStr = String(label || "").trim().slice(0, 80);
  if (!labelStr) return res.status(400).json({ error: "이름을 입력해 주세요." });

  const { data, error } = await supabaseAdmin
    .from("admin_settings")
    .insert({
      label: labelStr,
      value: String(value || "").trim().slice(0, 500),
      note: String(note || "").trim().slice(0, 300),
      sort_order: Number.isFinite(Number(sortOrder)) ? Math.floor(Number(sortOrder)) : 0,
    })
    .select()
    .single();

  if (error) {
    console.error("[admin/settings] 생성 실패:", error.message);
    return res.status(500).json({ error: "생성에 실패했습니다." });
  }
  logAdminAction(req, "setting.create", "setting", data.id, { label: data.label });
  res.json(toSettingDto(data));
});

router.patch("/api/admin/settings/:id", requireAdmin, async (req, res) => {
  const { label, value, note, sortOrder } = req.body || {};
  const patch = { updated_at: new Date().toISOString() };
  if (label !== undefined) {
    const v = String(label || "").trim().slice(0, 80);
    if (!v) return res.status(400).json({ error: "이름을 입력해 주세요." });
    patch.label = v;
  }
  if (value !== undefined) patch.value = String(value || "").trim().slice(0, 500);
  if (note !== undefined) patch.note = String(note || "").trim().slice(0, 300);
  if (sortOrder !== undefined) patch.sort_order = Number.isFinite(Number(sortOrder)) ? Math.floor(Number(sortOrder)) : 0;

  const { data, error } = await supabaseAdmin.from("admin_settings").update(patch).eq("id", req.params.id).select().maybeSingle();
  if (error) {
    console.error("[admin/settings] 수정 실패:", error.message);
    return res.status(500).json({ error: "수정에 실패했습니다." });
  }
  if (!data) return res.status(404).json({ error: "존재하지 않는 항목입니다." });
  logAdminAction(req, "setting.update", "setting", req.params.id, patch);
  res.json(toSettingDto(data));
});

router.delete("/api/admin/settings/:id", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("admin_settings").delete().eq("id", req.params.id);
  if (error) {
    console.error("[admin/settings] 삭제 실패:", error.message);
    return res.status(500).json({ error: "삭제에 실패했습니다." });
  }
  logAdminAction(req, "setting.delete", "setting", req.params.id);
  res.json({ ok: true });
});

module.exports = router;
