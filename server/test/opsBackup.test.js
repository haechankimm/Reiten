/* lib/opsCheck.js(운영 설정 점검) + lib/backup.js(주간 전체 백업) */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const { supabaseAdmin } = require("../lib/supabase");
const { configChecks, runOpsCheck } = require("../lib/opsCheck");
const { buildBackup } = require("../lib/backup");

after(() => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

test("설정 점검 — 테스트용 발신 주소(resend.dev)면 메일 오류, 텔레그램 미연결은 경고", () => {
  const checks = configChecks({ RESEND_API_KEY: "re_x", RESEND_FROM: "onboarding@resend.dev" });
  assert.equal(checks.find((c) => c.key === "mail_from").level, "error");
  assert.equal(checks.find((c) => c.key === "telegram").level, "warn");
  const ok = configChecks({ RESEND_API_KEY: "re_x", RESEND_FROM: "order@reiten.kr", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1", VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b", SWEETTRACKER_API_KEY: "k", SENTRY_DSN: "d" });
  assert.equal(ok.filter((c) => c.level !== "ok").length, 0);
});

test("운영 점검 — 최근 24시간 발송 실패 3건 이상이면 오류", async () => {
  const now = new Date("2026-10-02T09:00:00Z");
  supabaseAdmin.__reset({
    orders: [], order_refunds: [],
    system_error_log: [1, 2, 3].map((i) => ({ id: String(i), type: "notification_failed", resolved: false, created_at: "2026-10-02T01:00:00Z" })),
  });
  const r = await runOpsCheck({ env: { RESEND_API_KEY: "x", RESEND_FROM: "order@reiten.kr" }, now });
  assert.ok(r.checks.some((c) => c.key === "mail_failures" && c.level === "error"));
  assert.ok(r.errors >= 1);
});

test("전체 백업 — gzip JSON으로 표마다 행이 들어간다", async () => {
  supabaseAdmin.__reset({ orders: [{ order_no: "A" }, { order_no: "B" }], products: [{ id: "p1" }] });
  const b = await buildBackup({ now: new Date("2026-10-05T00:00:00Z") });
  assert.equal(b.filename, "reiten-backup-2026-10-05.json.gz");
  const parsed = JSON.parse(zlib.gunzipSync(b.buffer).toString("utf8"));
  assert.equal(parsed.tables.orders.length, 2);
  assert.equal(b.summary.products, 1);
});

/* 2026-11-11 — 마이그레이션은 전부 적용되면 한 줄, 빠지면 빠진 번호만 */
test("마이그레이션 점검 — 전부 있으면 '최신까지 적용' 한 줄, 빠진 것만 경고", async () => {
  const { migrationChecks, MIGRATION_CHECKS } = require("../lib/opsCheck");
  const okDb = { from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) }), rpc: async () => ({ error: null }) };
  const all = await migrationChecks(okDb);
  assert.equal(all.length, 1);
  assert.equal(all[0].level, "ok");
  assert.match(all[0].label, new RegExp(MIGRATION_CHECKS[MIGRATION_CHECKS.length - 1].no));
  const missingDb = {
    from: (t) => ({ select: () => ({ limit: async () => ({ error: t === "supplier_invoices" ? { code: "PGRST205" } : null }) }) }),
    rpc: async () => ({ error: null }),
  };
  const some = await migrationChecks(missingDb);
  assert.deepEqual(some.map((c) => c.key), ["migration_050"]);
});
