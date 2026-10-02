/* ---------- 운영 설정 자동 점검 (2026-10-02) ----------
   "메일이 몇 주째 안 나가는데 아무도 몰랐다" 같은 사고(2026-09~10 Resend 도메인 문제)를 줄이려고, 매일 아침 요약
   알림과 Works "정보" 탭의 운영 점검 패널이 같은 점검표를 본다. 외부 서비스에 실제로 요청을 보내지는 않고
   (요금·부작용 없음) 환경변수 설정 상태와 최근 오류 기록·DB 마이그레이션 상태만 확인한다.
   level: "error"(지금 고객에게 영향) / "warn"(곧 문제 되거나 기능이 꺼져 있음) / "ok" */
const { supabaseAdmin } = require("./supabase");

function envSet(name) {
  return !!String(process.env[name] || "").trim();
}

/* 환경변수만 보는 순수 점검 */
function configChecks(env = process.env) {
  const has = (n) => !!String(env[n] || "").trim();
  const out = [];
  if (!has("RESEND_API_KEY")) out.push({ level: "error", key: "mail", label: "메일 발송 키(RESEND_API_KEY)가 없습니다 — 주문·입금 안내 메일이 나가지 않습니다" });
  else if (!has("RESEND_FROM") || /resend\.dev$/i.test(String(env.RESEND_FROM || "").trim())) out.push({ level: "error", key: "mail_from", label: "보내는 주소(RESEND_FROM)가 인증된 도메인 주소가 아닙니다 — 고객 메일이 전부 실패합니다" });
  else out.push({ level: "ok", key: "mail", label: "메일 발송 설정" });
  if (!has("TELEGRAM_BOT_TOKEN") || !has("TELEGRAM_CHAT_ID")) out.push({ level: "warn", key: "telegram", label: "텔레그램 긴급 알림이 연결되지 않았습니다(폰 푸시만 동작)" });
  else out.push({ level: "ok", key: "telegram", label: "텔레그램 긴급 알림" });
  if (!has("VAPID_PUBLIC_KEY") || !has("VAPID_PRIVATE_KEY")) out.push({ level: "warn", key: "push", label: "폰 푸시 키(VAPID)가 없습니다" });
  if (has("PORTONE_API_SECRET") && !has("PORTONE_WEBHOOK_SECRET")) out.push({ level: "warn", key: "portone_webhook", label: "카드결제 웹훅 비밀값(PORTONE_WEBHOOK_SECRET)이 없습니다 — 결제 후 창을 닫은 손님 주문이 누락될 수 있습니다" });
  if (!has("SWEETTRACKER_API_KEY")) out.push({ level: "warn", key: "tracking", label: "배송조회 키(SWEETTRACKER_API_KEY)가 없어 배송완료 자동 처리가 꺼져 있습니다(출고 14일 뒤 자동 구매확정으로 대체)" });
  if (!has("SENTRY_DSN")) out.push({ level: "warn", key: "sentry", label: "오류 추적(SENTRY_DSN)이 꺼져 있습니다" });
  return out;
}

async function dbChecks(db = supabaseAdmin, now = new Date()) {
  const out = [];
  const { error: confirmErr } = await db.from("orders").select("confirmed_at").limit(1);
  const { error: refundErr } = await db.from("order_refunds").select("id").limit(1);
  if (confirmErr || refundErr) out.push({ level: "warn", key: "migration_043", label: "DB 마이그레이션 043이 아직 실행되지 않았습니다(부분 환불 이력·구매확정·사진 리뷰 적립이 꺼져 있음)" });
  else out.push({ level: "ok", key: "migration_043", label: "DB 마이그레이션 043" });

  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const { data: mailFails } = await db.from("system_error_log").select("id").eq("type", "notification_failed").gte("created_at", since);
  const fails = (mailFails || []).length;
  if (fails >= 3) out.push({ level: "error", key: "mail_failures", label: `최근 24시간 알림 발송 실패 ${fails}건 — '발송 실패 아웃박스'를 확인하세요` });
  const { data: unresolved } = await db.from("system_error_log").select("id").eq("resolved", false);
  const open = (unresolved || []).length;
  if (open) out.push({ level: "warn", key: "system_errors", label: `해결 안 된 시스템 오류 ${open}건` });
  return out;
}

async function runOpsCheck({ db = supabaseAdmin, env = process.env, now = new Date() } = {}) {
  const checks = [...configChecks(env), ...(await dbChecks(db, now).catch(() => []))];
  return {
    checkedAt: now.toISOString(),
    errors: checks.filter((c) => c.level === "error").length,
    warnings: checks.filter((c) => c.level === "warn").length,
    checks,
  };
}

module.exports = { configChecks, dbChecks, runOpsCheck, envSet };
