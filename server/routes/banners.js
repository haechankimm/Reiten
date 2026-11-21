/* 고객 사이트 띠배너 — 공개 GET /api/banners(30초 캐시) + Works 관리(/api/admin/banners, 권한 영역 "banners").
   056 전이면 공개 API는 빈 목록, 관리 API는 503(안내). 순수 로직은 lib/banners.js. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { isMissingSchemaError } = require("../lib/pgErrors");
const { bannerPatchFromBody, toBannerDto, liveBanners, toPublicBanner, bannerState } = require("../lib/banners");

const router = express.Router();
const TABLE = "site_banners";
const MIGRATION_MISSING = "DB 마이그레이션 056을 먼저 실행해 주세요(고객 공지 배너).";

let cache = { at: 0, items: null };
const CACHE_MS = 30000;
function invalidate() { cache = { at: 0, items: null }; }

router.get("/api/banners", async (req, res) => {
  if (!cache.items || Date.now() - cache.at > CACHE_MS) {
    const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("active", true).limit(50);
    // 056 전이거나 DB 오류면 배너 없이(고객 화면은 그대로 동작)
    cache = { at: Date.now(), items: error ? [] : data || [] };
  }
  res.set("Cache-Control", "public, max-age=30");
  res.json({ items: liveBanners(cache.items).map(toPublicBanner) });
});

router.get("/api/admin/banners", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: false }).limit(100);
  if (error) {
    if (isMissingSchemaError(error)) return res.json({ items: [], migrationMissing: true });
    return res.status(500).json({ error: "배너를 불러오지 못했습니다." });
  }
  const now = Date.now();
  res.json({ items: data.map((r) => ({ ...toBannerDto(r), state: bannerState(r, now) })) });
});

router.post("/api/admin/banners", requireAdmin, async (req, res) => {
  const { patch, error: bad } = bannerPatchFromBody(req.body || {}, { forCreate: true });
  if (bad) return res.status(400).json({ error: bad });
  const { data, error } = await supabaseAdmin.from(TABLE).insert({ ...patch, created_by: req.user.email || "" }).select().single();
  if (error) return res.status(isMissingSchemaError(error) ? 503 : 500).json({ error: isMissingSchemaError(error) ? MIGRATION_MISSING : "배너 등록에 실패했습니다." });
  invalidate();
  logAdminAction(req, "banner.create", "banner", data.id, { message: data.message });
  res.json(toBannerDto(data));
});

router.patch("/api/admin/banners/:id", requireAdmin, async (req, res) => {
  const { patch, error: bad } = bannerPatchFromBody(req.body || {});
  if (bad) return res.status(400).json({ error: bad });
  if (!Object.keys(patch).length) return res.status(400).json({ error: "변경할 값이 없습니다." });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from(TABLE).update(patch).eq("id", req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: "배너 수정에 실패했습니다." });
  if (!data) return res.status(404).json({ error: "존재하지 않는 배너입니다." });
  // 시작·끝 시각이 뒤바뀌는 수정(한쪽만 바꾼 경우)도 막는다
  if (data.starts_at && data.ends_at && data.ends_at <= data.starts_at) {
    await supabaseAdmin.from(TABLE).update({ ends_at: null }).eq("id", data.id);
    data.ends_at = null;
  }
  invalidate();
  logAdminAction(req, "banner.update", "banner", data.id, patch);
  res.json(toBannerDto(data));
});

router.delete("/api/admin/banners/:id", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin.from(TABLE).delete().eq("id", req.params.id).select("id, message");
  if (error) return res.status(500).json({ error: "배너 삭제에 실패했습니다." });
  if (!data || !data.length) return res.status(404).json({ error: "존재하지 않는 배너입니다." });
  invalidate();
  logAdminAction(req, "banner.delete", "banner", req.params.id, { message: data[0].message });
  res.json({ ok: true });
});

module.exports = router;
module.exports.invalidateBannerCache = invalidate;
