/* ---------- 치명적 오류 즉시 알림(텔레그램 + Works 폰 푸시) ----------
   logSystemError()가 부를 때마다 두 채널로 동시에 보낸다. 규칙:
   ① 같은 종류 오류는 30분에 한 번만(같은 실패가 반복돼 폰이 도배되는 것 방지)
   ② 알림 채널 자신의 실패(텔레그램·푸시 발송 실패)는 다시 알리지 않음(무한 반복 방지)
   push.js가 adminLog를 require하므로 순환 참조를 피하려고 여기서 지연 require 한다. */
const { sendTelegram } = require("./telegram");

const THROTTLE_MS = 30 * 60 * 1000;
const lastSentAt = new Map();

function shouldAlert(type, detail, now = Date.now()) {
  if (detail && (detail.channel === "push" || detail.channel === "telegram")) return false;
  if (lastSentAt.has(type) && now - lastSentAt.get(type) < THROTTLE_MS) return false;
  lastSentAt.set(type, now);
  return true;
}

function sendCriticalAlert(type, label, detailText, detail) {
  if (!shouldAlert(type, detail)) return;
  sendTelegram(`🚨 [REITEN] ${label}${detailText ? "\n" + detailText : ""}\n\nWorks에서 확인: https://works.reiten.kr`).catch(() => {});
  const { sendPushToAdmins } = require("./push");
  sendPushToAdmins({ title: `🚨 긴급: ${label}`, body: detailText.slice(0, 180) || "Works에서 확인해 주세요", tab: "systemErrors" }).catch(() => {});
}

module.exports = { sendCriticalAlert, shouldAlert, _resetThrottle: () => lastSentAt.clear() };
