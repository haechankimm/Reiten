/* about.html 전용 스크립트 — 예전엔 HTML 안 인라인 <script>였다(2026-11-11 분리, 동작 동일). */
  applyI18n();
  renderHeader("about.html");

  document.getElementById("p-ship1").textContent = "— " + t(SITE.shipping.leadTime);
  document.getElementById("p-ship2").textContent =
    t("— 배송비 {fee} · {free} 이상 구매 시 무료", { fee: money(SITE.shipping.fee), free: money(SITE.shipping.freeOver) });

  const st = SIZE_TABLES.hoodie;
  document.getElementById("size-table").innerHTML =
    `<thead><tr>${st.head.map(h => `<th>${esc(t(h))}</th>`).join("")}</tr></thead>` +
    `<tbody>${st.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  document.getElementById("ride-guide").innerHTML = rideGuideHTML("hoodie");

  const b = SITE.biz;
  document.getElementById("biz").innerHTML = [
    [t("상호"), b.company], [t("대표자"), b.ceo], [t("사업자등록번호"), b.regNo],
    [t("통신판매업신고"), b.mailOrderNo], [t("사업장 주소"), b.address],
    [t("연락처"), b.tel], [t("개인정보관리책임자"), b.privacyOfficer],
    [t("이메일"), SITE.order.email],
  ].map(([k, v]) => `<li>— ${esc(k)} : ${esc(v)}</li>`).join("");

  document.querySelectorAll(".acc__btn").forEach(btn =>
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!open));
      btn.nextElementSibling.classList.toggle("open", !open);
    })
  );

  renderFooter();
  initReveal();
  initBeams();
