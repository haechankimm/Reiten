/* ---------- 아침 업무 요약 알림 (2026-10-02) ----------
   매일 09:00(KST) "오늘 처리할 일" 건수를 Works 폰 푸시(+ 텔레그램이 연결돼 있으면 텔레그램)로 보낸다 —
   Works를 열어보기 전에 입금 확인·출고·문의 답변이 몇 건 쌓였는지 알 수 있게. 끄려면 Render 환경변수
   MORNING_BRIEFING=off. 할 일이 하나도 없으면 보내지 않는다(매일 "0건" 알림은 소음). */
const { supabaseAdmin } = require("./supabase");

async function countWhere(db, table, build) {
  const { count, error } = await build(db.from(table).select("id", { count: "exact", head: true }));
  return error ? 0 : count || 0;
}

/* 순수 함수 — 건수 → 알림 문구(아무것도 없으면 null) */
function briefingText(c) {
  const parts = [
    c.pendingDeposit ? `입금 확인 ${c.pendingDeposit}` : "",
    c.toShip ? `출고 대기 ${c.toShip}` : "",
    c.openQna ? `미답변 문의 ${c.openQna}` : "",
    c.openReturns ? `반품·교환·취소 ${c.openReturns}` : "",
    c.systemErrors ? `시스템 오류 ${c.systemErrors}` : "",
    c.opsErrors ? `설정 점검 필요 ${c.opsErrors}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

async function collectBriefingCounts(db = supabaseAdmin) {
  const [pendingDeposit, toShip, openQna, openReturns, systemErrors] = await Promise.all([
    countWhere(db, "orders", (q) => q.eq("status", "입금대기")),
    countWhere(db, "orders", (q) => q.eq("status", "입금확인")),
    countWhere(db, "qna", (q) => q.eq("status", "답변대기")),
    countWhere(db, "return_requests", (q) => q.in("status", ["접수", "수거중", "처리중", "재발송"])),
    countWhere(db, "system_error_log", (q) => q.eq("resolved", false)),
  ]);
  // 메일 발송 설정 오류처럼 "지금 고객에게 영향 있는" 설정 문제도 아침 알림에 같이 띄운다(lib/opsCheck.js)
  const ops = await require("./opsCheck").runOpsCheck({ db }).catch(() => ({ errors: 0 }));
  return { pendingDeposit, toShip, openQna, openReturns, systemErrors, opsErrors: ops.errors || 0 };
}

async function sendMorningBriefing({ db = supabaseAdmin, force = false } = {}) {
  if (!force && process.env.MORNING_BRIEFING === "off") return { sent: false, skipped: "off" };
  const counts = await collectBriefingCounts(db);
  const text = briefingText(counts);
  if (!text && !force) return { sent: false, skipped: "nothing", counts };
  const body = text || "오늘 처리할 일이 없습니다";
  const { sendPushToAdmins } = require("./push");
  const { sendTelegram, telegramConfigured } = require("./telegram");
  const push = await sendPushToAdmins({ title: "☀️ 오늘 할 일", body, tab: "home" }).catch((e) => ({ ok: false, error: e.message }));
  const telegram = telegramConfigured() ? await sendTelegram(`☀️ [REITEN] 오늘 할 일\n${body}\n\nWorks: https://works.reiten.kr`).catch((e) => ({ ok: false, error: e.message })) : { ok: false, error: "텔레그램 미연결" };
  return { sent: !!(push.ok || telegram.ok), counts, push, telegram, text: body };
}

module.exports = { briefingText, collectBriefingCounts, sendMorningBriefing };
