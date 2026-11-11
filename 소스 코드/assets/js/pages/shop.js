/* shop.html 전용 스크립트 — 예전엔 HTML 안 인라인 <script>였다(2026-11-11 분리, 동작 동일). */
  applyI18n();
  renderHeader("shop.html");
  renderFooter();

  (async () => {
    await Promise.all([loadProducts(), loadColors()]);

    const cats = ["전체", ...new Set(PRODUCTS.map(p => p.category))];
    let active = qs("cat") || "전체";
    if (!cats.includes(active)) active = "전체";

    const catsEl = document.getElementById("cats");
    const gridEl = document.getElementById("grid");
    const noneEl = document.getElementById("none");
    const searchEl = document.getElementById("shop-search");
    searchEl.value = qs("q") || "";

    // 상품 수가 적어(9종 안팎) 서버 검색 없이 이름·설명·카테고리를 그대로 훑는 클라이언트 필터로 충분하다.
    function matchesSearch(p, needle) {
      if (!needle) return true;
      // 관리자가 넣은 영어·일본어 상품명·요약(translations)으로도 찾을 수 있게 한다 — 화면에 보이는 이름으로 검색해도 안 나왔다(2026-10-28 정기 감사)
      const tr = productTranslation(p) || {};
      const haystack = [p.nameKo, p.name, p.short, p.desc, t(p.category), tr.name, tr.short]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    }

    function paint() {
      catsEl.innerHTML = cats.map(c =>
        `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === active}">${esc(t(c))}</button>`
      ).join("");

      const needle = searchEl.value.trim().toLowerCase();
      const list = (active === "전체" ? PRODUCTS : PRODUCTS.filter(p => p.category === active))
        .filter(p => matchesSearch(p, needle));
      gridEl.innerHTML = list.map((p, i) => productCard(p, i * 50)).join("");
      noneEl.hidden = list.length > 0;
      bindWishlistButtons(gridEl);
      noneEl.querySelector("p").textContent = needle
        ? t("검색 결과가 없습니다.")
        : t("해당 카테고리의 상품이 아직 없습니다.");

      catsEl.querySelectorAll(".chip").forEach(b =>
        b.addEventListener("click", () => {
          active = b.dataset.cat;
          const u = new URL(location.href);
          if (active === "전체") u.searchParams.delete("cat");
          else u.searchParams.set("cat", active);
          history.replaceState(null, "", u);
          paint();
        })
      );
      initReveal();
      initBeams();
    }

    let searchDebounce;
    searchEl.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        const u = new URL(location.href);
        if (searchEl.value.trim()) u.searchParams.set("q", searchEl.value.trim());
        else u.searchParams.delete("q");
        history.replaceState(null, "", u);
        paint();
      }, 150);
    });

    paint();
  })();
