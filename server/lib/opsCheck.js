/* ---------- 운영 설정 자동 점검 (2026-10-02) ----------
   "메일이 몇 주째 안 나가는데 아무도 몰랐다" 같은 사고(2026-09~10 Resend 도메인 문제)를 줄이려고, 매일 아침 요약
   알림과 Works "정보" 탭의 운영 점검 패널이 같은 점검표를 본다. 외부 서비스에 실제로 요청을 보내지는 않고
   (요금·부작용 없음) 환경변수 설정 상태와 최근 오류 기록·DB 마이그레이션 상태만 확인한다.
   level: "error"(지금 고객에게 영향) / "warn"(곧 문제 되거나 기능이 꺼져 있음) / "ok" */
const trackingBudget = require("./trackingBudget");
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
  const { error: trErr0 } = await db.from("products").select("translations").limit(1);
  // 044는 색상 영어·일본어 이름 칸(product_colors.label_en·label_ja)도 함께 만든다(2026-10-29)
  const trErr = trErr0 || (await db.from("product_colors").select("label_en, label_ja").limit(1)).error;
  if (trErr) out.push({ level: "warn", key: "migration_044", label: "DB 마이그레이션 044가 아직 실행되지 않았습니다(상품·색상 영어·일본어 문구 저장 불가)" });
  else out.push({ level: "ok", key: "migration_044", label: "DB 마이그레이션 044" });
  // 045 — 서버 여러 대 사이 처리 잠금(lib/dbLock.js). 서버 1대일 때는 없어도 안전하지만 늘리기 전에 필요(2026-11-09)
  const { error: lockErr } = await db.from("app_locks").select("key").limit(1);
  if (lockErr) out.push({ level: "warn", key: "migration_045", label: "DB 마이그레이션 045가 아직 실행되지 않았습니다(서버를 2대 이상으로 늘리기 전에 필요)" });
  else out.push({ level: "ok", key: "migration_045", label: "DB 마이그레이션 045" });
  // 047 — 서버 여러 대 공유 요청 제한(lib/rateLimitStore.js). 표와 함수 둘 다 있어야 실행된 것(2026-11-10). 없는 키를 되돌리는 호출이라 아무것도 바뀌지 않는다.
  const { error: rlTableErr } = await db.from("rate_limits").select("key").limit(1);
  const rlErr = rlTableErr || (await db.rpc("rate_limit_undo", { p_key: "__opscheck__" })).error;
  if (rlErr) out.push({ level: "warn", key: "migration_047", label: "DB 마이그레이션 047이 아직 실행되지 않았습니다(서버를 2대 이상으로 늘릴 때만 필요)" });
  else out.push({ level: "ok", key: "migration_047", label: "DB 마이그레이션 047" });
  // 048 — 공급처 출고 송장(routes/supplierShipments.js). 없어도 다른 기능엔 영향 없음(2026-11-10)
  const { error: shipErr } = await db.from("supplier_shipments").select("id").limit(1);
  if (shipErr) out.push({ level: "warn", key: "migration_048", label: "DB 마이그레이션 048이 아직 실행되지 않았습니다(공급처 송장 자동 기록이 꺼져 있음)" });
  else out.push({ level: "ok", key: "migration_048", label: "DB 마이그레이션 048" });
  // 049 — 공급처 송장 배송조회 결과 칸 + 스마트택배 월간 사용량 표(2026-11-10)
  const { error: trkErr0 } = await db.from("supplier_shipments").select("tracking_checked_at").limit(1);
  const trkErr = trkErr0 || (await db.from("api_usage_monthly").select("key").limit(1)).error;
  if (trkErr) out.push({ level: "warn", key: "migration_049", label: "DB 마이그레이션 049가 아직 실행되지 않았습니다(공급처 송장 배송조회 결과 저장 불가)" });
  else out.push({ level: "ok", key: "migration_049", label: "DB 마이그레이션 049" });
  // 050 — 입고 품목·매입 장부·문의 답변 초안(피클 업무 확장, 2026-11-10)
  const { error: e050a } = await db.from("supplier_invoices").select("id").limit(1);
  const e050 = e050a || (await db.from("qna").select("ai_draft").limit(1)).error || (await db.from("supplier_shipments").select("receipt_items").limit(1)).error;
  if (e050) out.push({ level: "warn", key: "migration_050", label: "DB 마이그레이션 050이 아직 실행되지 않았습니다(입고 재고 반영·매입 장부·문의 답변 초안이 꺼져 있음)" });
  else out.push({ level: "ok", key: "migration_050", label: "DB 마이그레이션 050" });
  // 스마트택배 월간 한도·키 오류(무료 키는 한 달마다 새로 발급해야 함)
  if (envSet("SWEETTRACKER_API_KEY")) {
    const u = await trackingBudget.usage(db, now).catch(() => null);
    if (u) {
      if (u.remaining <= 0) out.push({ level: "warn", key: "tracking_budget", label: `이번 달 배송조회 한도(${u.limit}건)를 다 썼습니다 — 다음 달 1일까지 자동 배송조회가 멈춥니다`, i18n: { key: "이번 달 배송조회 한도({n}건)를 다 썼습니다 — 다음 달 1일까지 자동 배송조회가 멈춥니다", vars: { n: u.limit } } });
      else out.push({ level: "ok", key: "tracking_budget", label: `배송조회 이번 달 ${u.calls}/${u.limit}건 사용`, i18n: { key: "배송조회 이번 달 {a}/{b}건 사용", vars: { a: u.calls, b: u.limit } } });
      if (u.lastError && u.lastErrorAt && now.getTime() - new Date(u.lastErrorAt).getTime() < 24 * 3600 * 1000) {
        out.push({ level: "warn", key: "tracking_error", label: `최근 배송조회 실패: ${u.lastError} — 키가 만료됐으면 스마트택배에서 새 키를 받아 Render SWEETTRACKER_API_KEY를 바꾸세요`, i18n: { key: "최근 배송조회 실패: {msg} — 키가 만료됐으면 스마트택배에서 새 키를 받아 Render SWEETTRACKER_API_KEY를 바꾸세요", vars: { msg: u.lastError } } });
      }
    }
  }

  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const { data: mailFails } = await db.from("system_error_log").select("id").eq("type", "notification_failed").gte("created_at", since);
  const fails = (mailFails || []).length;
  /* 숫자가 끼는 문구는 그대로 t()에 넣으면 사전에 없어 Works 독일어 화면에서 한국어로 남았다(2026-10-28 정기 감사) —
     label(아침 요약 알림 등 한국어 그대로 쓰는 곳)은 그대로 두고, 화면 번역용 키·변수(i18n)를 함께 내려준다. */
  if (fails >= 3) out.push({ level: "error", key: "mail_failures", label: `최근 24시간 알림 발송 실패 ${fails}건 — '발송 실패 아웃박스'를 확인하세요`, i18n: { key: "최근 24시간 알림 발송 실패 {n}건 — '발송 실패 아웃박스'를 확인하세요", vars: { n: fails } } });
  const { data: unresolved } = await db.from("system_error_log").select("id").eq("resolved", false);
  const open = (unresolved || []).length;
  if (open) out.push({ level: "warn", key: "system_errors", label: `해결 안 된 시스템 오류 ${open}건`, i18n: { key: "해결 안 된 시스템 오류 {n}건", vars: { n: open } } });
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
