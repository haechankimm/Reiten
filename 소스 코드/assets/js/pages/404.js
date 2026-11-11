/* 404.html 전용 스크립트 — 예전엔 HTML 안 인라인 <script>였다(2026-11-11 분리, 동작 동일). */
  /* 예전엔 applyI18n()을 부르지 않아 영어·일본어 사용자에게도 한국어로만 보였다(2026-10-28 정기 감사).
     오류 페이지라 스크립트 하나가 실패해도 본문은 보이도록 각각 감싼다. */
  try { applyI18n(); document.title = t("페이지를 찾을 수 없습니다") + " — REITEN"; } catch (e) {}
  try { renderHeader(""); } catch (e) {}
  // <base href="/"> 때문에 "본문으로 건너뛰기"(#main)가 홈(/#main)으로 이동해 버리므로 지금 주소 기준으로 고친다(2026-10-28 정기 감사)
  try { const skip = document.querySelector(".skip-link"); if (skip) skip.setAttribute("href", location.pathname + location.search + "#main"); } catch (e) {}
