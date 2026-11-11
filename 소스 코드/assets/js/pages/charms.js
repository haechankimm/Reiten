/* charms.html 전용 스크립트 — 예전엔 HTML 안 인라인 <script>였다(2026-11-11 분리, 동작 동일). */
  applyI18n();
  renderHeader("");

  function tile(image, label, priceText, href) {
    const media = image
      ? `<div class="card__media"><img src="${image}" alt="${esc(label)}" loading="lazy"></div>`
      : `<div class="card__media ph"><span class="ph__label">${t("사진 준비중")}</span></div>`;
    return `
      <a class="card" href="${href}" data-reveal>
        ${media}
        <div class="card__body">
          <div class="card__name">${esc(label)}</div>
          <div class="card__price tnum">${priceText}</div>
        </div>
      </a>`;
  }

  document.getElementById("charm-grid").innerHTML = CHARMS
    .filter(c => c.key !== "none")
    .map(c => tile(c.image || null, t(c.label), CHARM_PRICE ? money(CHARM_PRICE) : t("무료"), `customizer.html?charm=${encodeURIComponent(c.key)}`))
    .join("");

  document.getElementById("extra-grid").innerHTML = EXTRAS
    .map(x => tile(x.image || null, t(x.label), money(EXTRA_PRICE), "customizer.html"))
    .join("");

  renderFooter();
  initReveal();
