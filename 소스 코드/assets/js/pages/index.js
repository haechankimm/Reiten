/* index.html 전용 스크립트 — 예전엔 HTML 안 인라인 <script>였다(2026-11-11 분리, 동작 동일). */
  applyI18n();
  renderHeader("index.html");
  renderFooter();

  (async () => {
    await Promise.all([loadProducts(), loadLookbook(), loadColors()]);

    document.getElementById("freeover").textContent = money(SITE.shipping.freeOver);

    document.getElementById("home-grid").innerHTML =
      PRODUCTS.map((p, i) => productCard(p, i * 60)).join("");
    bindWishlistButtons(document.getElementById("home-grid"));

    document.getElementById("charm-preview").innerHTML = CHARMS
      .filter(c => c.key !== "none")
      .slice(0, 8)
      .map((c, i) => `
        <div class="charm-btn" data-reveal="${i * 40}" style="pointer-events:none">
          ${charmSVG(c.key, i % 2 ? "color" : "silver")}
          <small>${esc(t(c.label))}</small>
        </div>`)
      .join("");

    document.getElementById("look-teaser").innerHTML = LOOKBOOK.slice(0, 3).map((l, i) => `
      <figure class="${l.span}" data-reveal="${i * 70}">
        ${l.src
          ? `<div class="shot" style="aspect-ratio:${l.ratio}"><img src="${l.src}" alt="${esc(t(l.label))}" loading="lazy"></div>`
          : `<div class="ph" style="aspect-ratio:${l.ratio}"><span class="ph__label">${t("사진 준비중")}</span></div>`}
        <figcaption><span>${esc(t(l.label))}</span><span>${esc(t(l.note))}</span></figcaption>
      </figure>`).join("");

    initReveal();
    initBeams();
  })();
