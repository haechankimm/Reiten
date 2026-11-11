/* lib/collabPush.js — 일정 알림 문구(2026-11-11) */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, after } = require("node:test");
const assert = require("node:assert");
const { calendarReminderText } = require("../lib/collabPush");

after(() => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

test("오늘·내일 일정을 나눠 적고 여러 날 일정은 끝나는 날을 붙인다", () => {
  const text = calendarReminderText(
    [{ title: "발매", event_date: "2026-11-11", end_date: null }],
    [{ title: "팝업", event_date: "2026-11-12", end_date: "2026-11-15" }]
  );
  assert.strictEqual(text, "오늘\n· 발매\n내일\n· 팝업 (~11/15)");
  assert.strictEqual(calendarReminderText([], [{ title: "휴무", event_date: "2026-11-12" }]), "내일\n· 휴무");
});
