/* terms.html 전용 스크립트 — 예전엔 HTML 안 인라인 <script>였다(2026-11-11 분리, 동작 동일). */
  applyI18n();
  renderHeader("");
  if (getLang() !== "ko") document.getElementById("legal-lang-notice").hidden = false;
  document.getElementById("t-purpose").textContent =
    `본 약관은 ${SITE.biz.company}(이하 "회사")가 운영하는 온라인 사이트(이하 "사이트")를 ` +
    `통해 재화를 거래함에 있어 회사와 이용자의 권리·의무 및 책임사항, 이용 조건 및 절차를 ` +
    `규정함을 목적으로 합니다.`;
  renderFooter();
