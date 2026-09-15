/* ---------- Works 기능 사용 통계 ----------
   "지금 어떤 탭·기능을 자주 쓰고 뭘 안 쓰는지 보고 싶다"는 요청(2026-09, 038_admin_usage_log.sql)
   — 사이드바 탭을 열 때마다(nav.js switchTabs), 그리고 내보내기처럼 여러 탭이 공유하는 기능을
   쓸 때마다(wireExportMenu) 서버로 짧은 이벤트 하나를 기록한다. 순수 사용 로그라 실패해도
   화면 동작을 막으면 안 되므로, 기록 자체(POST)는 프런트에서 완전히 조용한 fire-and-forget으로
   호출한다(nav.js trackUsage — 실패해도 토스트를 띄우지 않음, 매 클릭마다 뜨면 방해가 됨).
   집계(GET)는 대시보드의 computeDashboardStats와 같은 원칙으로 최근 N일치 원본 행을 가져와
   Node에서 직접 그룹핑한다(이 규모의 이벤트 수에는 그걸로 충분, 새 SQL 함수 불필요). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { isMissingSchemaError } = require("../lib/pgErrors");

const router = express.Router();
const USAGE_LOG_MAX_ROWS = 20000;

router.post("/api/admin/usage-log", requireAdmin, async (req, res) => {
  const key = String((req.body || {}).key || "").trim().slice(0, 100);
  if (!key) return res.status(400).json({ error: "key가 필요합니다." });

  const { error } = await supabaseAdmin.from("admin_usage_log").insert({ key, admin_email: req.user.email || "" });
  // 038 미실행이어도 화면 동작엔 지장 없어야 하므로 실패를 그냥 삼킨다(로그만 남김).
  if (error && !isMissingSchemaError(error)) console.error("[usage-log] 적재 실패:", error.message);
  res.json({ ok: true });
});

router.get("/api/admin/usage-log/stats", requireAdmin, async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("admin_usage_log")
    .select("key, created_at")
    .gte("created_at", since)
    .limit(USAGE_LOG_MAX_ROWS);

  if (error) {
    if (isMissingSchemaError(error)) return res.json({ items: [], totalEvents: 0, days }); // 038 미실행 — 조용히 빈 통계
    console.error("[usage-log] 통계 조회 실패:", error.message);
    return res.status(500).json({ error: "사용 통계를 불러오지 못했습니다." });
  }

  const counts = new Map();
  const lastUsedAt = new Map();
  for (const r of data) {
    counts.set(r.key, (counts.get(r.key) || 0) + 1);
    if (!lastUsedAt.has(r.key) || r.created_at > lastUsedAt.get(r.key)) lastUsedAt.set(r.key, r.created_at);
  }
  const items = [...counts.entries()]
    .map(([key, count]) => ({ key, count, lastUsedAt: lastUsedAt.get(key) }))
    .sort((a, b) => b.count - a.count);

  res.json({ items, totalEvents: data.length, days });
});

module.exports = router;
