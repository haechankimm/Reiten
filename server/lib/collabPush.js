/* ---------- 공지·캘린더 폰 푸시(2026-11-11 사용자 요청) ----------
   - 공지: 작성 즉시 "협업(캘린더·공지)" 권한이 있는 관리자 폰으로(쓴 사람 본인은 빼고).
   - 일정: 매일 아침 09:00(KST) — 오늘 시작하는 일정 + 내일 시작하는 일정을 한 번에 묶어서.
   권한 없는 사람에게는 보내지 않는다(lib/push.js pushRecipientsForAreas). 푸시 키가 없으면 조용히 건너뛴다. */
const { supabaseAdmin } = require("./supabase");
const { sendPushToAdmins, pushRecipientsForAreas, configured } = require("./push");
const { kstDateKey } = require("./kst");
const { isMissingSchemaError } = require("./pgErrors");

const AREA = "collab";

function clip(s, n) {
  const str = String(s || "").replace(/\s+/g, " ").trim();
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

async function notifyNewNotice(notice, authorId) {
  if (!configured) return { ok: false, skipped: "no-vapid" };
  const ids = (await pushRecipientsForAreas([AREA], "view")).filter((id) => id !== authorId);
  if (!ids.length) return { ok: false, skipped: "no-recipients" };
  return sendPushToAdmins({ title: `📢 새 공지: ${clip(notice.title, 40)}`, body: clip(notice.body, 120), tab: "notices" }, { adminIds: ids });
}

/* 오늘·내일 "시작하는" 일정 문구 — 여러 날짜에 걸친 일정은 시작 전날·시작일에만 알린다(매일 울리면 시끄러움). */
function calendarReminderText(today, tomorrow) {
  const line = (e) => `· ${clip(e.title, 30)}${e.end_date && e.end_date !== e.event_date ? ` (~${e.end_date.slice(5).replace("-", "/")})` : ""}`;
  const parts = [];
  if (today.length) parts.push(`오늘\n${today.map(line).join("\n")}`);
  if (tomorrow.length) parts.push(`내일\n${tomorrow.map(line).join("\n")}`);
  return parts.join("\n");
}

async function sendCalendarReminders(now = new Date()) {
  if (!configured) return { ok: false, skipped: "no-vapid" };
  const todayKey = kstDateKey(now);
  const tomorrowKey = kstDateKey(new Date(now.getTime() + 24 * 3600 * 1000));
  const { data, error } = await supabaseAdmin.from("calendar_events").select("*").in("event_date", [todayKey, tomorrowKey]);
  if (error) {
    if (!isMissingSchemaError(error)) console.error("[calendar-push] 일정 조회 실패:", error.message);
    return { ok: false, error: error.message };
  }
  const rows = data || [];
  const today = rows.filter((e) => e.event_date === todayKey);
  const tomorrow = rows.filter((e) => e.event_date === tomorrowKey);
  if (!today.length && !tomorrow.length) return { ok: true, skipped: "nothing" };
  const ids = await pushRecipientsForAreas([AREA], "view");
  if (!ids.length) return { ok: false, skipped: "no-recipients" };
  const title = today.length ? `📅 오늘 일정 ${today.length}건${tomorrow.length ? ` · 내일 ${tomorrow.length}건` : ""}` : `📅 내일 일정 ${tomorrow.length}건`;
  return sendPushToAdmins({ title, body: calendarReminderText(today, tomorrow), tab: "calendar" }, { adminIds: ids });
}

module.exports = { notifyNewNotice, sendCalendarReminders, calendarReminderText };
