/* ---------- 사내 캘린더 ----------
   figlo 등 다른 관리자 툴의 "캘린더" 탭을 참고해, 발매일·행사·휴무 같은 일정을 색으로
   구분해 한 화면에서 보는 용도(037_handoff_notes_and_calendar.sql). 반복 일정은 없음(파일
   상단 마이그레이션 주석 참고). 돈·재고를 건드리지 않는 순수 CRUD라 별도 라우트로 분리. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { isMissingSchemaError } = require("../lib/pgErrors");

const router = express.Router();
const CALENDAR_COLORS = ["blue", "green", "orange", "purple", "red", "gray"];

function toEventDto(r) {
  return { id: r.id, title: r.title, date: r.event_date, color: r.color, memo: r.memo || "", createdBy: r.created_by || "" };
}

/* month=YYYY-MM이면 그 달(+앞뒤 하루 여유)만, 없으면 최근 200건 — 화면은 항상 한 달 단위로
   보므로 매번 전체를 다 내려줄 필요가 없다. */
router.get("/api/admin/calendar-events", requireAdmin, async (req, res) => {
  let query = supabaseAdmin.from("calendar_events").select("*").order("event_date", { ascending: true });
  const month = String(req.query.month || "").trim();
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const from = `${month}-01`;
    const toDate = new Date(Date.UTC(y, m, 1));
    const to = toDate.toISOString().slice(0, 10);
    query = query.gte("event_date", from).lt("event_date", to);
  } else {
    query = query.limit(200);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaError(error)) return res.json({ items: [] }); // 037 미실행 — 조용히 빈 목록
    console.error("[calendar] 조회 실패:", error.message);
    return res.status(500).json({ error: "일정을 불러오지 못했습니다." });
  }
  res.json({ items: data.map(toEventDto) });
});

router.post("/api/admin/calendar-events", requireAdmin, async (req, res) => {
  const { title, date, color, memo } = req.body || {};
  const titleStr = String(title || "").trim().slice(0, 100);
  const dateStr = String(date || "").trim();
  const colorStr = CALENDAR_COLORS.includes(color) ? color : "blue";
  if (!titleStr) return res.status(400).json({ error: "제목을 입력해 주세요." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: "날짜 형식이 올바르지 않습니다." });

  const { data, error } = await supabaseAdmin
    .from("calendar_events")
    .insert({
      title: titleStr,
      event_date: dateStr,
      color: colorStr,
      memo: String(memo || "").trim().slice(0, 500) || null,
      created_by: req.user.email || "",
    })
    .select()
    .single();
  if (error) {
    console.error("[calendar] 등록 실패:", error.message);
    return res.status(500).json({ error: "등록에 실패했습니다(마이그레이션 037을 실행했는지 확인해 주세요)." });
  }
  logAdminAction(req, "calendar_event.create", "calendar_event", data.id, { title: titleStr, date: dateStr });
  res.json(toEventDto(data));
});

router.patch("/api/admin/calendar-events/:id", requireAdmin, async (req, res) => {
  const { title, date, color, memo } = req.body || {};
  const patch = {};
  if (title !== undefined) {
    const v = String(title || "").trim().slice(0, 100);
    if (!v) return res.status(400).json({ error: "제목을 입력해 주세요." });
    patch.title = v;
  }
  if (date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "날짜 형식이 올바르지 않습니다." });
    patch.event_date = date;
  }
  if (color !== undefined) patch.color = CALENDAR_COLORS.includes(color) ? color : "blue";
  if (memo !== undefined) patch.memo = String(memo || "").trim().slice(0, 500) || null;
  if (!Object.keys(patch).length) return res.status(400).json({ error: "변경할 값이 없습니다." });

  const { data, error } = await supabaseAdmin.from("calendar_events").update(patch).eq("id", req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: "수정에 실패했습니다." });
  if (!data) return res.status(404).json({ error: "존재하지 않는 일정입니다." });
  logAdminAction(req, "calendar_event.update", "calendar_event", req.params.id, patch);
  res.json(toEventDto(data));
});

router.delete("/api/admin/calendar-events/:id", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("calendar_events").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "삭제에 실패했습니다." });
  logAdminAction(req, "calendar_event.delete", "calendar_event", req.params.id);
  res.json({ ok: true });
});

module.exports = router;
