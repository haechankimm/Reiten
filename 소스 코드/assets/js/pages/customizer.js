/* customizer.html 전용 스크립트 — 예전엔 HTML 안 인라인 <script>였다(2026-11-11 분리, 동작 동일). */
  applyI18n();
  renderHeader("customizer.html");

  (async () => {
  await Promise.all([loadProducts(), loadColors()]);

  const BASES = PRODUCTS.filter(p => p.charmReady);
  /* 지금 판매 중인 집업이 하나도 없으면(전부 비공개 등) 흰 화면으로 죽지 않게 안내만 띄운다. */
  if (!BASES.length) {
    document.getElementById("main").innerHTML = `
      <section class="sec"><div class="wrap" style="text-align:center;padding:60px 0">
        <p class="eyebrow">Zip Charm Studio</p>
        <h1 class="h-xl" style="margin-top:12px">${esc(t("스튜디오 준비 중입니다"))}</h1>
        <p class="lede" style="margin:14px auto 0;max-width:44ch">${esc(t("지퍼 참을 달 수 있는 집업이 곧 다시 입고됩니다."))}</p>
        <a class="btn" style="margin-top:22px" href="shop.html">${esc(t("상품 보러 가기"))}</a>
      </div></section>`;
    return;
  }

  const state = {
    base: BASES.find(b => b.id === qs("id")) || BASES[0],
    color: null,
    charm: qs("charm") && getCharm(qs("charm")) ? qs("charm") : "star",
    finish: "silver",
    extras: [],
    size: null,
    qty: 1,
    light: false,
  };
  /* 재고 판정은 product.html과 같다 — soldOut(관리자가 체크한 전체 품절) + outOfStockByColor(서버가 계산한
     컬러별 실재고 0). 예전 스튜디오는 soldOut만 보고, 처음 사이즈·집업/컬러를 바꿀 때는 그것조차 안 봐서
     품절 사이즈가 선택된 채로 담겼다(서버에서 재고 부족으로 거절됨). 상품 컬러가 팔레트에 하나도 없으면
     팔레트 첫 컬러로 대신 채우지 않고 null로 두고 담기를 막는다(2026-10-28 정기 감사). */
  function sizeOut(base, color, s) {
    return (base.soldOut || []).includes(s) ||
      ((base.outOfStockByColor && base.outOfStockByColor[color]) || []).includes(s);
  }
  // 원하는 사이즈가 살 수 있으면 그대로, 아니면 첫 번째 재고 있는 사이즈, 그것도 없으면 원하는 사이즈(품절 표시용)
  function pickSize(prefer) {
    const sizes = state.base.sizes || [];
    if (sizes.includes(prefer) && !sizeOut(state.base, state.color, prefer)) return prefer;
    return sizes.find(s => !sizeOut(state.base, state.color, s)) || (sizes.includes(prefer) ? prefer : sizes[0] || null);
  }
  function pickColor() {
    return state.base.colors.find(c => COLORS[c]) || null;
  }

  state.color = pickColor();
  state.size = pickSize(state.base.sizes[1] || state.base.sizes[0]);

  const el = (id) => document.getElementById(id);

  function charmCost() { return state.charm === "none" ? 0 : CHARM_PRICE; }
  function extrasCost() { return state.extras.length * EXTRA_PRICE; }
  function unitPrice() { return state.base.price + charmCost() + extrasCost(); }

  function paintPreview() {
    el("preview").innerHTML = hoodieSVG({
      colorHex: state.color ? COLORS[state.color].hex : undefined,
      charmKey: state.charm,
      finishKey: state.finish,
      type: state.base.type,
    });
    const c = getCharm(state.charm);
    el("stage-caption").textContent =
      `${productName(state.base)}${state.color ? " · " + t(COLORS[state.color].label) : ""}` +
      (state.charm === "none" ? " · " + t("참 없음") : ` · ${t(c.label)} (${t(getFinish(state.finish).label)})`);
  }

  function paintControls() {
    // base
    el("bases").innerHTML = BASES.map(b =>
      `<button class="chip" type="button" data-b="${b.id}" aria-pressed="${b.id === state.base.id}">${esc(productName(b))}</button>`
    ).join("");
    el("base-name").textContent = money(state.base.price);

    // color
    el("colors").innerHTML = state.base.colors.filter(c => COLORS[c]).map(c =>
      `<button class="color-dot" type="button" data-c="${c}" aria-pressed="${c === state.color}"
               aria-label="${esc(t(COLORS[c].label))}" style="background:${COLORS[c].hex}"></button>`
    ).join("");
    el("color-name").textContent = state.color ? t(COLORS[state.color].label) : "";

    // charms
    el("charms").innerHTML = CHARMS.map(c => `
      <button class="charm-btn" type="button" data-k="${c.key}" aria-pressed="${c.key === state.charm}">
        ${c.key === "none"
          ? `<svg viewBox="0 0 100 120" aria-hidden="true"><path d="M28,44 L72,88 M72,44 L28,88" stroke="currentColor" stroke-width="7" stroke-linecap="round" opacity=".35" fill="none"/></svg>`
          : charmSVG(c.key, state.finish)}
        <small>${esc(t(c.label))}</small>
      </button>`).join("");
    el("charm-name").textContent = t(getCharm(state.charm).label);

    // finish
    el("finishes").innerHTML = FINISHES.map(f =>
      `<button class="chip" type="button" data-f="${f.key}" aria-pressed="${f.key === state.finish}"
               ${state.charm === "none" ? "disabled" : ""}>${esc(t(f.label))}</button>`
    ).join("");
    el("finish-note").textContent = state.charm === "none" ? "—" : t(getFinish(state.finish).note);

    // extras
    el("extras").innerHTML = EXTRAS.map(x => `
      <button class="chip" type="button" data-x="${x.key}" aria-pressed="${state.extras.includes(x.key)}">${esc(t(x.label))}</button>
    `).join("");
    el("extras-note").textContent = state.extras.length
      ? t("{n}개 선택", { n: state.extras.length })
      : "—";

    // size
    el("sizes").innerHTML = state.base.sizes.map(s => {
      const out = sizeOut(state.base, state.color, s);
      return `<button class="chip" type="button" data-s="${s}" ${out ? "disabled" : ""} aria-pressed="${s === state.size}"
                ${out ? `aria-label="${esc(t("{size} 품절", { size: s }))}" title="${esc(t("품절"))}"` : ""}>${s}</button>`;
    }).join("");

    // 담기·바로 주문 — 고를 컬러가 없거나 지금 컬러의 모든 사이즈가 품절이면 막는다(사이즈가 비어 있는 상품은 품절 아님)
    const sizes = state.base.sizes || [];
    const noColor = !state.color;
    const soldAll = noColor || (sizes.length > 0 && sizes.every(s => sizeOut(state.base, state.color, s)));
    el("add").disabled = soldAll;
    el("buy").disabled = soldAll;
    el("add").textContent = noColor ? t("구매할 수 있는 컬러가 없습니다") : soldAll ? t("품절") : t("장바구니 담기");

    el("qty").textContent = state.qty;

    // summary
    el("sum-base").textContent = productName(state.base);
    el("sum-base-v").textContent = money(state.base.price);
    el("sum-charm").textContent = state.charm === "none" ? t("지퍼 참 (선택 안 함)") : t("지퍼 참 — {charm}", { charm: t(getCharm(state.charm).label) });
    el("sum-charm-v").textContent = state.charm === "none" ? "—" : (CHARM_PRICE ? money(CHARM_PRICE) : t("무료"));
    el("sum-extras-v").textContent = extrasCost() ? money(extrasCost()) : "—";
    el("sum-total").textContent = money(unitPrice() * state.qty);
  }

  function paint() {
    paintPreview();
    paintControls();
    bind();
  }

  function bind() {
    el("bases").querySelectorAll(".chip").forEach(b => b.addEventListener("click", () => {
      state.base = getProduct(b.dataset.b);
      if (!state.base.colors.includes(state.color) || !COLORS[state.color]) {
        state.color = pickColor();
      }
      state.size = pickSize(state.size);
      paint();
    }));
    el("colors").querySelectorAll(".color-dot").forEach(b => b.addEventListener("click", () => {
      state.color = b.dataset.c;
      state.size = pickSize(state.size); // 이 컬러에서 품절인 사이즈였으면 살 수 있는 사이즈로 옮긴다
      paint();
    }));
    el("charms").querySelectorAll(".charm-btn").forEach(b => b.addEventListener("click", () => {
      state.charm = b.dataset.k; paint();
    }));
    el("finishes").querySelectorAll(".chip").forEach(b => b.addEventListener("click", () => {
      state.finish = b.dataset.f; paint();
    }));
    el("extras").querySelectorAll(".chip").forEach(b => b.addEventListener("click", () => {
      const k = b.dataset.x;
      state.extras = state.extras.includes(k)
        ? state.extras.filter(x => x !== k)
        : [...state.extras, k];
      paint();
    }));
    el("sizes").querySelectorAll(".chip").forEach(b => b.addEventListener("click", () => {
      state.size = b.dataset.s; paint();
    }));
  }

  el("minus").addEventListener("click", () => { state.qty = Math.max(1, state.qty - 1); paintControls(); bind(); });
  el("plus").addEventListener("click", () => { state.qty = Math.min(99, state.qty + 1); paintControls(); bind(); });

  // 라이트 스위치
  document.querySelectorAll(".js-light").forEach(btn =>
    btn.addEventListener("click", () => {
      state.light = !state.light;
      btn.setAttribute("aria-pressed", String(state.light));
      el("stage").classList.toggle("dark", state.light);
    })
  );

  // 담기
  function comboItem() {
    const opts = [
      { label: t("컬러"), value: t(COLORS[state.color].label) },
      { label: t("사이즈"), value: state.size },
      {
        label: t("지퍼 참"),
        value: state.charm === "none" ? t("선택 안 함")
          : `${t(getCharm(state.charm).label)} · ${t(getFinish(state.finish).label)}`,
      },
    ];
    if (state.extras.length) {
      opts.push({
        label: t("추가 아이템"),
        value: state.extras.map(k => t(EXTRAS.find(x => x.key === k).label)).join(", "),
      });
    }
    return {
      /* 같은 조합이면 같은 줄로 합쳐지도록 정규화한다 — 참 없음이면 마감은 의미가 없고(예전엔 마감만 바꿔도
         다른 줄로 담겼다), 추가 아이템은 고른 순서와 무관하게 정렬한다(2026-10-28 정기 감사). */
      sig: [state.base.id, state.color, state.size,
            state.charm === "none" ? "none" : state.charm + "|" + state.finish,
            ...[...state.extras].sort()].join("|"),
      productId: state.base.id,
      name: productName(state.base),
      image: state.base.images.find(Boolean) || null,
      color: state.color,
      size: state.size,
      charm: state.charm === "none" ? null : { key: state.charm, finish: state.finish },
      extras: state.extras,
      unit: unitPrice(),
      qty: state.qty,
      opts,
    };
  }

  el("add").addEventListener("click", () => {
    if (el("add").disabled) return;
    Cart.add(comboItem());
    toast(t("조합을 장바구니에 담았습니다"));
  });
  el("buy").addEventListener("click", () => { if (el("buy").disabled) return; Cart.add(comboItem()); location.href = "cart.html"; });

  el("add-charm").addEventListener("click", () => {
    if (state.charm === "none") { toast(t("먼저 참을 선택해 주세요")); return; }
    Cart.add({
      sig: ["charm", state.charm, state.finish].join("|"),
      productId: "charm-" + state.charm,
      name: t("지퍼 참 — {charm}", { charm: t(getCharm(state.charm).label) }),
      image: null,
      charm: { key: state.charm, finish: state.finish },
      unit: CHARM_PRICE,
      qty: 1,
      opts: [{ label: t("마감"), value: t(getFinish(state.finish).label) }],
    });
    toast(t("참을 장바구니에 담았습니다"));
  });

  // 카탈로그
  el("catalogue").innerHTML = CHARMS.filter(c => c.key !== "none").map((c, i) => `
    <button class="charm-btn" type="button" data-k="${c.key}" data-reveal="${i * 40}" style="padding:20px 10px 14px">
      <span style="display:block;width:56px">${charmSVG(c.key, "silver", { attrs: 'style="width:56px;height:56px"' })}</span>
      <small style="font-size:12px;color:var(--ink)">${esc(t(c.label))}</small>
      <small>${CHARM_PRICE ? money(CHARM_PRICE) : t("무료")}</small>
    </button>`).join("");
  el("catalogue").querySelectorAll(".charm-btn").forEach(b =>
    b.addEventListener("click", () => {
      state.charm = b.dataset.k;
      paint();
      document.querySelector(".studio").scrollIntoView({ behavior: "smooth", block: "start" });
    })
  );

  el("charm-price-1").textContent = CHARM_PRICE ? money(CHARM_PRICE) : t("무료");
  el("charm-price-2").textContent = CHARM_PRICE ? money(CHARM_PRICE) : t("무료");

  paint();
  renderFooter();
  initReveal();
  })();
