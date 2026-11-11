/* lookbook.html 전용 스크립트 — 예전엔 HTML 안 인라인 <script>였다(2026-11-11 분리, 동작 동일). */
  applyI18n();
  renderHeader("lookbook.html");

  (async () => {
    await loadLookbook();

    document.getElementById("look").innerHTML = LOOKBOOK.map((l, i) => `
      <figure class="${l.span}" data-reveal="${(i % 3) * 70}">
        ${l.src
          ? `<div class="shot" style="aspect-ratio:${l.ratio}"><img src="${l.src}" alt="${esc(t(l.label))}" loading="lazy"></div>`
          : `<div class="ph" style="aspect-ratio:${l.ratio}">
               <span class="ph__label">${esc(l.ratio.replace("/", " : "))} · ${t("사진 준비중")}</span>
             </div>`}
        <figcaption><span>${esc(t(l.label))}</span><span>${esc(t(l.note))}</span></figcaption>
      </figure>`).join("");

    renderFooter();
    initReveal();
    initBeams();
  })();
