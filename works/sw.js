/* Works 브라우저 푸시 알림용 서비스 워커 — works/ 정적 루트에 둬서 works.reiten.kr/sw.js로
   서빙되고, 스코프가 사이트 전체(/)가 된다(server.js의 works 라우트 분기, 위 참고). 새 주문
   접수 시 server/lib/push.js의 sendPushToAdmins()가 보낸 것만 처리한다 — 지금은 페이로드가
   단순 텍스트뿐이라 딱히 캐싱·오프라인 지원은 하지 않는다(그 정도까지는 필요 없는 용도). */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || "REITEN Works";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/assets/img/apple-touch-icon.png",
      data: { tab: data.tab || "" }, // 누르면 그 화면(예: AI 승인함)으로(2026-11-11)
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const tab = (event.notification.data && event.notification.data.tab) || "";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ("focus" in client) {
          if (tab) client.postMessage({ type: "open-tab", tab });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(tab ? `/#tab=${tab}` : "/");
    })
  );
});
