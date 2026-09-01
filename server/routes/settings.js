/* ---------- 관리자 참고정보(정보 탭) ----------
   Works 관리자 패널에서 사업자 정보 요약이나 Supabase·Render 같은 운영 사이트 링크를
   직접 적어두고 보는 용도. 비밀번호·API 키 등 민감정보는 여기 넣지 않는다(관리자 전원 열람 가능).
   돈·재고를 건드리지 않는 순수 CRUD라 server.js 본체에서 가장 먼저 분리한 라우트 그룹 중 하나. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { PROTECTED_SETTING_LABELS } = require("../lib/thanksCoupons");

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

/* 첫 구매/재구매 감사 쿠폰 등은 이 자유 텍스트 정보 항목의 label을 정확한 문자열로 찾아서
   할인율·기준 횟수를 읽는다(server.js의 lib/thanksCoupons.js 참고) — 관리자가 여기서 이름을
   살짝만 고치거나 지워도 매칭이 조용히 실패해 기본값으로 돌아간다(2026-09-01 코드 감사에서
   발견). 값(value)·메모(note)는 자유롭게 바꿀 수 있게 두고, "이름"만 보호한다. */
router.patch("/api/admin/settings/:id", requireAdmin, async (req, res) => {
  const { label, value, note, sortOrder } = req.body || {};
  const patch = { updated_at: new Date().toISOString() };
  if (label !== undefined) {
    const v = String(label || "").trim().slice(0, 80);
    if (!v) return res.status(400).json({ error: "이름을 입력해 주세요." });

    const { data: current } = await supabaseAdmin.from("admin_settings").select("label").eq("id", req.params.id).maybeSingle();
    if (current && PROTECTED_SETTING_LABELS.includes(current.label) && v !== current.label) {
      return res.status(400).json({ error: "이 항목은 자동 쿠폰 발급에 쓰이고 있어 이름을 바꿀 수 없습니다 — 값만 수정해 주세요." });
    }
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

/* ---------- 전체 데이터 백업 내보내기 ----------
   결제·주문·재고처럼 매일 바뀌는 트랜잭션 데이터가 아니라, 스토어 "설정값"에 가까운 세 테이블
   (상품·쿠폰·이 페이지의 정보 항목)만 JSON 하나로 묶어 내려준다. 대시보드/주문 내보내기와
   달리 사람이 읽는 표가 아니라 그대로 다시 복원하거나 백업용으로 보관하는 용도라 CSV/엑셀이
   아닌 원본 JSON 그대로 내려준다. */
router.get("/api/admin/backup/export", requireAdmin, async (req, res) => {
  const [products, coupons, settings] = await Promise.all([
    supabaseAdmin.from("products").select("*"),
    supabaseAdmin.from("coupons").select("*"),
    supabaseAdmin.from("admin_settings").select("*"),
  ]);
  const failed = [products, coupons, settings].find((r) => r.error);
  if (failed) {
    console.error("[admin/backup] 조회 실패:", failed.error.message);
    return res.status(500).json({ error: "백업 데이터를 불러오지 못했습니다." });
  }

  const backup = {
    exportedAt: new Date().toISOString(),
    products: products.data,
    coupons: coupons.data,
    adminSettings: settings.data,
  };
  const filename = `reiten-backup-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(JSON.stringify(backup, null, 2));
  logAdminAction(req, "backup.export", "backup", "export", {
    products: products.data.length,
    coupons: coupons.data.length,
    settings: settings.data.length,
  });
});

router.delete("/api/admin/settings/:id", requireAdmin, async (req, res) => {
  const { data: current } = await supabaseAdmin.from("admin_settings").select("label").eq("id", req.params.id).maybeSingle();
  if (current && PROTECTED_SETTING_LABELS.includes(current.label)) {
    return res.status(400).json({ error: "이 항목은 자동 쿠폰 발급에 쓰이고 있어 삭제할 수 없습니다." });
  }

  const { error } = await supabaseAdmin.from("admin_settings").delete().eq("id", req.params.id);
  if (error) {
    console.error("[admin/settings] 삭제 실패:", error.message);
    return res.status(500).json({ error: "삭제에 실패했습니다." });
  }
  logAdminAction(req, "setting.delete", "setting", req.params.id);
  res.json({ ok: true });
});

module.exports = router;
