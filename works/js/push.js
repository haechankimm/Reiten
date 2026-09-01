  /* ---------- Works 브라우저 푸시 알림 ----------
     새 주문이 접수되는 순간 Works를 안 보고 있어도 브라우저 알림으로 바로 알 수 있게 한다.
     서버(server/lib/push.js)가 VAPID 키 미설정이면 조용히 비활성 상태가 되는 것과 같은
     원칙으로, 이 브라우저가 Push API 자체를 지원하지 않거나(구형 브라우저) 서버에 키가 없으면
     버튼을 숨긴다. */

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function getPushSubscription() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
    const reg = await navigator.serviceWorker.register("/sw.js");
    return reg.pushManager.getSubscription();
  }

  function renderPushButton(subscribed) {
    const btn = el("push-toggle");
    if (!btn) return;
    btn.textContent = t(subscribed ? "브라우저 알림 끄기" : "브라우저 알림 켜기");
    btn.dataset.subscribed = subscribed ? "1" : "0";
  }

  async function initPush() {
    const btn = el("push-toggle");
    if (!btn || !("serviceWorker" in navigator) || !("PushManager" in window)) return;

    const keyResult = await adminFetch("/api/admin/push/public-key");
    if (!keyResult || !keyResult.publicKey) {
      el("push-panel").hidden = true;
      return;
    }
    el("push-panel").hidden = false;

    const existing = await getPushSubscription().catch(() => null);
    renderPushButton(!!existing);

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const current = await getPushSubscription();
        if (current) {
          await current.unsubscribe();
          await adminFetch("/api/admin/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: current.endpoint }) });
          renderPushButton(false);
          toast(t("브라우저 알림을 껐습니다"));
          return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast(t("브라우저 알림 권한이 필요합니다"));
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyResult.publicKey),
        });
        const result = await adminFetch("/api/admin/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: sub }) });
        if (!result) { await sub.unsubscribe(); return; }
        renderPushButton(true);
        toast(t("브라우저 알림을 켰습니다"));
      } catch (err) {
        console.error("[push] 처리 실패:", err);
        toast(t("처리에 실패했습니다"));
      } finally {
        btn.disabled = false;
      }
    });
  }
