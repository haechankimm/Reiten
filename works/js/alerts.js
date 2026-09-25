  /* ---------- 긴급 오류 알림 패널(정보 탭, 마스터 전용) ----------
     서버 routes/alerts.js — 텔레그램·푸시 연결 상태 표시, 채팅 ID 찾기, 테스트 알림 보내기. */
  function alertLine(ok, text) {
    return `<div>${ok ? "✅" : "⚠️"} ${esc(text)}</div>`;
  }

  async function paintAlertPanel() {
    if (!isMasterAdmin) return;
    el("alert-panel").hidden = false;
    const s = await adminFetch("/api/admin/alerts/status");
    if (!s) return;
    el("alert-status").innerHTML = [
      alertLine(s.telegram.token, s.telegram.token ? t("텔레그램 봇 토큰 설정됨") : t("텔레그램 봇 토큰 없음 — Render 환경변수 TELEGRAM_BOT_TOKEN 필요")),
      alertLine(s.telegram.chatId, s.telegram.chatId ? t("텔레그램 채팅 ID 설정됨") : t("텔레그램 채팅 ID 없음 — Render 환경변수 TELEGRAM_CHAT_ID 필요")),
      alertLine(s.push.configured && s.push.devices > 0, s.push.configured ? t("폰 푸시: 알림을 켠 기기 {n}대", { n: s.push.devices }) : t("폰 푸시: 서버 VAPID 키 없음")),
    ].join("");
  }

  el("alert-test")?.addEventListener("click", async () => {
    const btn = el("alert-test");
    btn.disabled = true;
    el("alert-result").textContent = t("보내는 중…");
    const r = await adminFetch("/api/admin/alerts/test", { method: "POST", body: "{}" });
    btn.disabled = false;
    if (!r) { el("alert-result").textContent = ""; return; }
    const tg = r.telegram.ok ? t("텔레그램: 보냄") : t("텔레그램: 실패 — {e}", { e: r.telegram.error || "" });
    const push = r.push && r.push.ok ? t("폰 푸시: {n}대에 보냄", { n: r.push.sent }) : t("폰 푸시: 실패 — {e}", { e: (r.push && r.push.error) || "" });
    el("alert-result").textContent = `${tg}\n${push}`;
    paintAlertPanel();
  });

  el("alert-find-chat")?.addEventListener("click", async () => {
    const r = await adminFetch("/api/admin/alerts/telegram-chats");
    if (!r) return;
    if (!r.ok) { el("alert-result").textContent = t("찾기 실패 — {e}", { e: r.error || "" }); return; }
    el("alert-result").textContent = r.chats.length
      ? t("아래 숫자를 Render 환경변수 TELEGRAM_CHAT_ID에 넣으세요:") + "\n" + r.chats.map((c) => `${c.id}  (${c.name})`).join("\n")
      : t("아직 봇에게 온 메시지가 없습니다. 텔레그램에서 봇을 열고 /start 를 보낸 뒤 다시 눌러주세요.");
  });

  /* 아이폰 Safari(홈 화면 앱이 아닌 상태)에서는 푸시 API 자체가 없어 알림 버튼이 안 보인다 — 이유를 안내한다. */
  (function iosPushHint() {
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
    if (isIOS && !standalone) {
      el("push-panel").hidden = false;
      el("push-ios-hint").hidden = false;
      el("push-toggle").hidden = true;
    }
  })();
