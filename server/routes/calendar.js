/* ---------- 사내 캘린더 ----------
   figlo 등 다른 관리자 툴의 "캘린더" 탭을 참고해, 발매일·행사·휴무 같은 일정을 색으로
   구분해 한 화면에서 보는 용도(037_handoff_notes_and_calendar.sql). 반복 일정은 없음(파일
   상단 마이그레이션 주석 참고). 돈·재고를 건드리지 않는 순수 CRUD라 별도 라우트로 분리. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { isMissingSchemaError, isMissingColumnError } = require("../lib/pgErrors");

const router = express.Router();
const CALENDAR_COLORS = ["blue", "green", "orange", "purple", "red", "gray"];

function toEventDto(r) {
  return { id: r.id, title: r.title, date: r.event_date, endDate: r.end_date || r.event_date, color: r.color, memo: r.memo || "", createdBy: r.created_by || "" };
}

const MAX_RANGE_DAYS = 366;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
function addDays(d, n) {
  return new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}
/* endDate 검증 — 비우거나 시작일과 같으면 하루짜리(null) */
function normalizeEnd(date, endDate) {
  if (endDate === undefined || endDate === null || endDate === "" || endDate === date) return { end: null };
  if (!isDate(endDate)) return { error: "종료일 형식이 올바르지 않습니다." };
  const span = daysBetween(date, endDate);
  if (span < 0) return { error: "종료일은 시작일보다 같거나 늦어야 합니다." };
  if (span > MAX_RANGE_DAYS) return { error: "기간은 최대 1년까지 지정할 수 있습니다." };
  return { end: endDate };
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
    // 그 달과 겹치는 일정: 시작일이 다음 달 1일 전이고, (종료일 또는 시작일)이 이번 달 1일 이후
    let { data, error } = await query.lt("event_date", to).or(`end_date.gte.${from},and(end_date.is.null,event_date.gte.${from})`);
    if (isMissingColumnError(error)) {
      ({ data, error } = await supabaseAdmin.from("calendar_events").select("*").order("event_date", { ascending: true }).gte("event_date", from).lt("event_date", to));
    }
    if (error) {
      if (isMissingSchemaError(error)) return res.json({ items: [] });
      console.error("[calendar] 조회 실패:", error.message);
      return res.status(500).json({ error: "일정을 불러오지 못했습니다." });
    }
    return res.json({ items: data.map(toEventDto) });
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
  const { title, date, endDate, color, memo } = req.body || {};
  const titleStr = String(title || "").trim().slice(0, 100);
  const dateStr = String(date || "").trim();
  const colorStr = CALENDAR_COLORS.includes(color) ? color : "blue";
  if (!titleStr) return res.status(400).json({ error: "제목을 입력해 주세요." });
  if (!isDate(dateStr)) return res.status(400).json({ error: "날짜 형식이 올바르지 않습니다." });
  const { end, error: endError } = normalizeEnd(dateStr, endDate);
  if (endError) return res.status(400).json({ error: endError });

  const base = { title: titleStr, color: colorStr, memo: String(memo || "").trim().slice(0, 500) || null, created_by: req.user.email || "" };
  let { data, error } = await supabaseAdmin.from("calendar_events").insert({ ...base, event_date: dateStr, end_date: end }).select().single();

  /* 042 전(end_date 컬럼 없음)이면 기간을 하루당 한 건으로 나눠 저장한다 — 화면에는 똑같이 기간 내내 보인다. */
  if (isMissingColumnError(error)) {
    const span = end ? daysBetween(dateStr, end) : 0;
    if (span > 62) return res.status(400).json({ error: "마이그레이션 042 실행 전에는 기간을 최대 2개월까지만 지정할 수 있습니다." });
    const rows = Array.from({ length: span + 1 }, (_, i) => ({ ...base, event_date: addDays(dateStr, i) }));
    const r = await supabaseAdmin.from("calendar_events").insert(rows).select();
    error = r.error;
    data = r.data && r.data[0];
  }
  if (error || !data) {
    console.error("[calendar] 등록 실패:", error && error.message);
    return res.status(500).json({ error: "등록에 실패했습니다(마이그레이션 037을 실행했는지 확인해 주세요)." });
  }
  logAdminAction(req, "calendar_event.create", "calendar_event", data.id, { title: titleStr, date: dateStr, endDate: end || undefined });
  res.json(toEventDto(data));
});

router.patch("/api/admin/calendar-events/:id", requireAdmin, async (req, res) => {
  const { title, date, endDate, color, memo } = req.body || {};
  const patch = {};
  if (title !== undefined) {
    const v = String(title || "").trim().slice(0, 100);
    if (!v) return res.status(400).json({ error: "제목을 입력해 주세요." });
    patch.title = v;
  }
  if (date !== undefined) {
    if (!isDate(date)) return res.status(400).json({ error: "날짜 형식이 올바르지 않습니다." });
    patch.event_date = date;
  }
  if (endDate !== undefined) {
    const { end, error: endError } = normalizeEnd(date !== undefined ? date : endDate, endDate);
    if (endError) return res.status(400).json({ error: endError });
    patch.end_date = end;
  }
  if (color !== undefined) patch.color = CALENDAR_COLORS.includes(color) ? color : "blue";
  if (memo !== undefined) patch.memo = String(memo || "").trim().slice(0, 500) || null;
  if (!Object.keys(patch).length) return res.status(400).json({ error: "변경할 값이 없습니다." });

  let { data, error } = await supabaseAdmin.from("calendar_events").update(patch).eq("id", req.params.id).select().maybeSingle();
  if (isMissingColumnError(error) && "end_date" in patch) {
    delete patch.end_date; // 042 전: 기간 수정은 무시하고 나머지만 저장
    ({ data, error } = await supabaseAdmin.from("calendar_events").update(patch).eq("id", req.params.id).select().maybeSingle());
  }
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
module.exports.normalizeEnd = normalizeEnd;
