/* privacy.html 전용 스크립트 — 예전엔 HTML 안 인라인 <script>였다(2026-11-11 분리, 동작 동일). */
  applyI18n();
  renderHeader("");
  if (getLang() !== "ko") document.getElementById("legal-lang-notice").hidden = false;
  document.getElementById("effective-date").textContent = "시행일 : 2026년 8월 6일";

  const b = SITE.biz;
  document.getElementById("privacy-officer").innerHTML = [
    ["개인정보 보호책임자", b.privacyOfficer],
    ["연락처", b.tel],
    ["이메일", SITE.order.email],
  ].map(([k, v]) => `<li>— ${esc(k)} : ${esc(v)}</li>`).join("");

  renderFooter();
