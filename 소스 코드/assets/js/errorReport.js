/* ---------- 화면 오류 보고 (2026-11-09) ----------
   손님 휴대폰·관리자 화면에서 난 자바스크립트 오류는 지금까지 아무도 몰랐다(서버 오류만 기록됨). 이 파일이 오류를 모아
   서버(POST /api/client-errors)로 보내면, 서버가 Sentry(SENTRY_DSN이 있을 때)와 서버 로그에 남긴다.
   - 개인정보를 보내지 않는다: 주소의 ?쿼리·#해시는 잘라 경로만, 입력값·쿠키는 보내지 않는다.
   - 한 페이지에서 최대 5건, 같은 오류는 한 번만. 브라우저 확장 프로그램·다른 도메인 스크립트 오류("Script error.")는 무시.
   - 보고 자체가 실패해도 화면에는 아무 영향이 없다. */
(function () {
  if (window.__reitenErrorReport) return;
  window.__reitenErrorReport = true;
  var MAX_PER_PAGE = 5;
  var sent = 0;
  var seen = {};

  function lang() {
    try { return localStorage.getItem("reiten_lang") || "ko"; } catch (e) { return "ko"; }
  }

  function report(kind, message, stack, source, line, col) {
    message = String(message || "").slice(0, 500);
    if (!message || message === "Script error." || sent >= MAX_PER_PAGE) return;
    if (/^(chrome|moz|safari|safari-web)-extension:/.test(String(source || "")) || /extension:\/\//.test(String(stack || ""))) return;
    var sig = kind + "|" + message + "|" + (source || "") + ":" + (line || "");
    if (seen[sig]) return;
    seen[sig] = true;
    sent++;
    var body = JSON.stringify({
      kind: kind,
      message: message,
      stack: String(stack || "").slice(0, 4000),
      source: String(source || "").split("?")[0].slice(0, 300),
      line: line || null,
      col: col || null,
      page: location.hostname + location.pathname,
      lang: lang(),
      viewport: window.innerWidth + "x" + window.innerHeight,
    });
    try {
      var blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon && navigator.sendBeacon("/api/client-errors", blob)) return;
    } catch (e) {}
    try { fetch("/api/client-errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {}); } catch (e) {}
  }

  window.addEventListener("error", function (e) {
    // 이미지·스크립트 로드 실패(e.target이 요소)는 오류 메시지가 없어 건너뛴다
    if (!e || !e.message) return;
    report("error", e.message, e.error && e.error.stack, e.filename, e.lineno, e.colno);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    var msg = r && r.message ? r.message : String(r);
    report("unhandledrejection", msg, r && r.stack, "", null, null);
  });
})();
