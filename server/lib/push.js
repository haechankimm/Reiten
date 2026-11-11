/* ---------- Works 브라우저 푸시 알림 ----------
   GA4 서비스 계정처럼 VAPID 키 한 쌍(공개/비공개)이 필요한 선택 기능 — 로컬 .env와 Render
   환경변수(VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)에 설정해야 실제로 동작한다. 설정이 없으면
   sendPushToAdmins()가 조용히 아무 것도 하지 않아(다른 선택 기능과 같은 원칙) 사이트 동작에는
   지장이 없다. */
const webpush = require("web-push");
const { supabaseAdmin } = require("./supabase");
const { isMissingSchemaError } = require("./pgErrors");
const { logSystemError } = require("./adminLog");

const configured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (configured) {
  webpush.setVapidDetails("mailto:reiten.customersupport@gmail.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
} else {
  console.warn("[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY이 설정되지 않아 브라우저 푸시 알림이 비활성 상태입니다.");
}

/* 모든 관리자의 모든 구독 기기에 알림을 보낸다(새 주문 접수처럼 관리자 전원이 알아야 할 이벤트용).
   구독이 만료·취소됐으면(410 Gone, 404) 그 행을 지워 다음부터는 시도조차 안 하게 정리한다. */
/* opts.adminIds: 이 관리자들의 기기에만 보낸다(예: AI 승인 요청은 승인할 수 있는 사람에게만) */
async function sendPushToAdmins(payload, opts = {}) {
  if (!configured) return { ok: false, sent: 0, total: 0, error: "VAPID 키 없음" };

  let { data: subs, error } = await supabaseAdmin.from("push_subscriptions").select("endpoint, keys, admin_id");
  if (error) {
    if (!isMissingSchemaError(error)) console.error("[push] 구독 목록 조회 실패:", error.message);
    return { ok: false, sent: 0, total: 0, error: "구독 목록 조회 실패" }; // 테이블 없음(026 미실행)이거나 다른 오류
  }
  if (Array.isArray(opts.adminIds)) subs = subs.filter((x) => opts.adminIds.includes(x.admin_id));
  if (!subs.length) return { ok: false, sent: 0, total: 0, error: "알림을 켠 기기가 없음" };

  const body = JSON.stringify(payload);
  const staleEndpoints = [];
  let sent = 0;
  let lastError = "";
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body);
        sent++;
      } catch (err) {
        lastError = err.statusCode ? `HTTP ${err.statusCode} ${err.body || err.message}` : err.message;
        if (err.statusCode === 404 || err.statusCode === 410) staleEndpoints.push(sub.endpoint);
        else {
          console.error("[push] 알림 발송 실패:", err.message);
          // 만료된 구독(위 분기) 정리는 자동으로 되지만, 그 외 진짜 실패는 지금까지 콘솔에서만
          // 사라졌다 — "발송 실패 아웃박스" 탭에서도 보이도록 다른 알림 채널과 같은 로그를 남긴다.
          logSystemError("notification_failed", { channel: "push", kind: payload.tab || "admin_push", error: err.message });
        }
      }
    })
  );
  if (staleEndpoints.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
  }
  return { ok: sent > 0, sent, total: subs.length, expired: staleEndpoints.length, error: lastError || undefined };
}

/* 알림을 켠 관리자 중 이 영역(areas 중 하나)을 minLevel("view"|"edit") 이상으로 볼 수 있는 사람의 id.
   권한 없는 사람에게는 알림도 보내지 않는다(Works 규칙 "권한 없는 것은 아예 안 보이게"). 확인 못 하면 보내지 않는다.
   AI 승인 요청(routes/agentActions.js)·공지·일정 알림(lib/collabPush.js)이 같이 쓴다. */
async function pushRecipientsForAreas(areas, minLevel = "view") {
  const { getStoredPermissions, resolvePermissions } = require("./adminGuard");
  const { MASTER_ADMIN_EMAIL } = require("./auth");
  const okLevels = minLevel === "edit" ? ["edit"] : ["view", "edit"];
  const { data: subs } = await supabaseAdmin.from("push_subscriptions").select("admin_id");
  const ids = [...new Set((subs || []).map((x) => x.admin_id).filter(Boolean))];
  const allowed = [];
  for (const id of ids) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(id);
      if (((data && data.user && data.user.email) || "").toLowerCase() === MASTER_ADMIN_EMAIL) { allowed.push(id); continue; }
      const perms = resolvePermissions(await getStoredPermissions(id), false);
      if (areas.some((a) => okLevels.includes(perms[a]))) allowed.push(id);
    } catch (e) { /* 확인 못 하면 보내지 않음 */ }
  }
  return allowed;
}

module.exports = { sendPushToAdmins, pushRecipientsForAreas, configured };
