  /* ---------- 상품 관리 ---------- */
  let pfEditingId = null;
  /* 상품 사진·상세 콘텐츠 목록(서버 products.media) — { kind: gallery|detail|video|text, src, text, caption, color }.
     color가 비어 있으면 공통(모든 컬러에서 보임), 있으면 고객이 그 컬러를 골랐을 때만 보인다. */
  let pfMedia = [];
  let pfMediaFilter = "all"; // "all" | "" (공통만) | 컬러 키
  let pfSelectedColors = [];
  const PF_SIZE_OPTIONS = ["XS", "S", "M", "L", "XL"];
  const CATEGORY_BASE = ["후드티", "후드집업", "크롭 후드티", "티셔츠"];
  let pfKnownCategories = [...CATEGORY_BASE];

  function renderPfCategory(selected) {
    const known = selected && !pfKnownCategories.includes(selected) ? [...pfKnownCategories, selected] : pfKnownCategories;
    el("pf-category").innerHTML =
      known.map((c) => `<option value="${esc(c)}">${esc(t(c))}</option>`).join("") +
      `<option value="__custom__">${esc(t("직접 입력 (새 카테고리)"))}</option>`;
    el("pf-category").value = selected && known.includes(selected) ? selected : known[0];
    el("pf-category-custom").hidden = true;
    el("pf-category-custom").value = "";
  }

  el("pf-category").addEventListener("change", () => {
    const isCustom = el("pf-category").value === "__custom__";
    el("pf-category-custom").hidden = !isCustom;
    if (isCustom) el("pf-category-custom").focus();
  });

  function renderPfColors() {
    el("pf-colors").innerHTML = Object.values(COLORS).map((c) => `
      <button type="button" class="chip pf-color" data-c="${c.key}" aria-pressed="${pfSelectedColors.includes(c.key)}">
        <span class="pf-color-dot" style="background:${esc(c.hex)}"></span>${esc(t(c.label))}
      </button>
    `).join("");
    el("pf-colors").querySelectorAll(".pf-color").forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.dataset.c;
        pfSelectedColors = pfSelectedColors.includes(k) ? pfSelectedColors.filter((x) => x !== k) : [...pfSelectedColors, k];
        if (pfMediaFilter && pfMediaFilter !== "all" && !pfSelectedColors.includes(pfMediaFilter)) pfMediaFilter = "all";
        renderPfColors();
        renderPfPhotos();
      })
    );
    renderColorManager();
  }


  /* 영어·일본어 상품 문구 입력칸(044) — 상품 저장 때 같이 보낸다. */
  function fillTranslationFields(tr) {
    for (const lang of ["en", "ja"]) {
      const v = (tr && tr[lang]) || {};
      if (!el(`pf-${lang}-name`)) continue;
      el(`pf-${lang}-name`).value = v.name || "";
      el(`pf-${lang}-short`).value = v.short || "";
      el(`pf-${lang}-desc`).value = v.desc || "";
      el(`pf-${lang}-details`).value = (v.details || []).join("\n");
    }
  }
  function readTranslationFields() {
    const out = {};
    for (const lang of ["en", "ja"]) {
      if (!el(`pf-${lang}-name`)) continue;
      out[lang] = {
        name: el(`pf-${lang}-name`).value.trim(),
        short: el(`pf-${lang}-short`).value.trim(),
        desc: el(`pf-${lang}-desc`).value.trim(),
        details: el(`pf-${lang}-details`).value.split("\n").map((x) => x.trim()).filter(Boolean),
      };
    }
    return out;
  }

  function resetProductForm() {
    pfEditingId = null;
    pfMedia = [];
    pfMediaFilter = "all";
    pfSelectedColors = [];
    el("product-form-title").textContent = t("새 상품 추가");
    el("pf-id").value = "";
    el("pf-id").disabled = false;
    el("pf-name").value = "";
    el("pf-nameko").value = "";
    el("pf-type").value = "hoodie";
    renderPfCategory();
    el("pf-price").value = "";
    el("pf-badge").value = "";
    el("pf-short").value = "";
    el("pf-desc").value = "";
    el("pf-details").value = "";
    fillTranslationFields({});
    el("pf-modelinfo").value = "";
    el("pf-sizetable").value = "hoodie";
    el("pf-charmready").checked = false;
    el("pf-active").checked = true;
    el("pf-cancel").hidden = true;
    el("pf-view-live").hidden = true;
    renderPfColors();
    renderPfPhotos();
  }

  function fillProductForm(p) {
    pfEditingId = p.id;
    pfMedia = (p.media && p.media.length
      ? p.media
      : (p.images || []).map((src, i) => (src ? { kind: "gallery", src, color: (p.imageColors || [])[i] || null } : null)).filter(Boolean)
    ).map((m) => ({ ...m }));
    pfMediaFilter = "all";
    pfSelectedColors = [...(p.colors || [])];
    el("product-form-title").textContent = t("상품 수정") + " — " + p.id;
    el("pf-id").value = p.id;
    el("pf-id").disabled = true;
    el("pf-name").value = p.name || "";
    el("pf-nameko").value = p.nameKo || "";
    el("pf-type").value = p.type || "hoodie";
    renderPfCategory(p.category || "");
    el("pf-price").value = p.price;
    el("pf-badge").value = p.badge || "";
    el("pf-short").value = p.short || "";
    el("pf-desc").value = p.desc || "";
    el("pf-details").value = (p.details || []).join("\n");
    fillTranslationFields(p.translations || {});
    el("pf-modelinfo").value = p.modelInfo || "";
    el("pf-sizetable").value = p.sizeTable || "hoodie";
    el("pf-charmready").checked = !!p.charmReady;
    el("pf-active").checked = p.active !== false;
    el("pf-cancel").hidden = false;
    el("pf-view-live").href = `/product.html?id=${encodeURIComponent(p.id)}`;
    el("pf-view-live").hidden = false;
    renderPfColors();
    renderPfPhotos();
    el("product-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* 기존 상품을 그대로 복사해 새 상품 등록 폼에 채운다(2026-11-11) — 컬러·사이즈 표·가격·설명·사진을 다시 입력하지 않게.
     상품 ID만 새로 정하면 되고, 재고·원가 구성은 각 화면의 "복사해 오기"로 가져온다. */
  function duplicateIntoForm(p) {
    fillProductForm(p);
    pfEditingId = null;
    el("product-form-title").textContent = t("새 상품 추가") + " — " + t("{name} 복사본", { name: t(p.nameKo) });
    el("pf-id").value = "";
    el("pf-id").disabled = false;
    el("pf-nameko").value = (p.nameKo || "") + " " + t("(복사)");
    el("pf-active").checked = false; // 실수로 바로 공개되지 않게
    el("pf-view-live").hidden = true;
    el("pf-id").focus();
    toast(t("복사한 내용으로 새 상품 폼을 채웠습니다 — 상품 ID를 정하고 저장하세요(비공개로 시작)"));
  }

  el("product-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = el("pf-id").value.trim();
    if (!pfEditingId && !/^[a-z0-9-]{2,60}$/.test(id)) {
      toast(t("상품 ID는 영문 소문자·숫자·하이픈만 2~60자로 입력해 주세요."));
      return;
    }
    const category = el("pf-category").value === "__custom__" ? el("pf-category-custom").value.trim() : el("pf-category").value;
    if (!category) {
      toast(t("카테고리를 입력해 주세요."));
      return;
    }

    const body = {
      name: el("pf-name").value.trim(),
      nameKo: el("pf-nameko").value.trim(),
      type: el("pf-type").value,
      category,
      price: Number(el("pf-price").value),
      badge: el("pf-badge").value.trim(),
      short: el("pf-short").value.trim(),
      desc: el("pf-desc").value.trim(),
      details: el("pf-details").value.split("\n").map((s) => s.trim()).filter(Boolean),
      translations: readTranslationFields(),
      colors: pfSelectedColors,
      sizes: PF_SIZE_OPTIONS,
      soldOut: [], // 품절은 재고 탭 수량으로만 판단(예전 수동 품절 체크는 저장할 때 비운다)
      modelInfo: el("pf-modelinfo").value.trim(),
      sizeTable: el("pf-sizetable").value,
      charmReady: el("pf-charmready").checked,
      active: el("pf-active").checked,
      media: pfMedia.filter((m) => m.kind !== "text" || (m.text || "").trim()),
    };

    const btn = el("pf-submit");
    btn.disabled = true;
    try {
      const result = pfEditingId
        ? await adminFetch(`/api/admin/products/${encodeURIComponent(pfEditingId)}`, { method: "PATCH", body: JSON.stringify(body) })
        : await adminFetch("/api/admin/products", { method: "POST", body: JSON.stringify({ id, ...body }) });

      if (!result) return;
      toast(result.mediaSkipped
        ? t("저장했지만 DB 마이그레이션 041 전이라 상세 콘텐츠·모델 정보는 빠졌습니다(상품 사진 앞 6장만 저장)")
        : result.translationsSkipped
          ? t("저장했지만 DB 마이그레이션 044 전이라 영어·일본어 문구는 빠졌습니다")
          : t("상품을 저장했습니다"));
      /* 관리자 미리보기와 실제 사이트가 다르게 보이는 걸(사진 비율 사고 같은) 저장한 그 자리에서
         바로 확인할 수 있게, 실제 상품 페이지 링크를 새 탭으로 열 수 있게 켜둔다.
         resetProductForm()이 폼을 새 상품 등록 상태로 되돌리므로, 이 링크는 그 뒤에 켜야 한다. */
      resetProductForm();
      el("pf-view-live").href = `/product.html?id=${encodeURIComponent(result.id)}`;
      el("pf-view-live").hidden = false;
      paintAdminProducts();
      // 사이즈·컬러를 바꾼 상품이 재고 탭엔 옛 칸으로 남아 있었다(2026-10-28 정기 감사) — 재고 화면도 같이 새로 그린다.
      if (canView("inventory") && typeof paintAdminInventory === "function") paintAdminInventory();
    } finally {
      btn.disabled = false;
    }
  });

  el("pf-cancel").addEventListener("click", () => resetProductForm());
  resetProductForm();

  const productsState = { page: 0, pageSize: 50, total: 0, items: [] };

  /* 상품이 몇 개 안 될 땐 하나씩 눌러도 되지만, 상품을 여러 개 한꺼번에 공개/비공개로 돌리거나
     (예: 카드사 심사 전 사진 없는 상품 몰아서 숨기기), 새 컬러를 여러 상품에 한 번에 추가하거나,
     여러 개를 한꺼번에 정리해서 삭제하고 싶을 때는 하나씩 누르는 게 번거롭다는 피드백을 받아
     체크박스 다중 선택 + 상단 일괄 처리 바를 추가했다. */
  const selectedProductIds = new Set();

  function productRowHTML(p) {
    const img = p.images.find(Boolean);
    return `
      <div class="grid-card" data-id="${esc(p.id)}">
        <div class="grid-card-thumb">
          <label class="grid-card-select">
            <input type="checkbox" class="product-select" data-id="${esc(p.id)}" ${selectedProductIds.has(p.id) ? "checked" : ""}>
          </label>
          ${img ? `<img src="${esc(img)}" alt="">` : ""}
          ${p.active ? "" : `<span class="grid-card-badge">${esc(t("비공개"))}</span>`}
        </div>
        <div class="grid-card-body">
          <b>${esc(t(p.nameKo))}</b>
          <div class="small tnum">${money(p.price)}</div>
        </div>
        <div class="grid-card-actions">
          <button type="button" class="btn btn--sm admin-product-edit">${esc(t("수정"))}</button>
          <button type="button" class="btn btn--sm btn--ghost admin-product-duplicate" title="${esc(t("이 상품을 복사해 새 상품 만들기"))}">${esc(t("복사"))}</button>
          <button type="button" class="btn btn--sm btn--danger admin-product-delete">${esc(t("삭제"))}</button>
        </div>
      </div>`;
  }

  function updateProductsBulkBar() {
    const n = selectedProductIds.size;
    el("products-bulk-actions").hidden = n === 0;
    el("products-selected-count").textContent = n ? t("{n}개 선택됨", { n }) : "";
    const loadedIds = productsState.items.map((p) => p.id);
    el("products-select-all").checked = loadedIds.length > 0 && loadedIds.every((id) => selectedProductIds.has(id));
  }

  function renderAdminProducts() {
    productsState.items.forEach((p) => {
      if (p.category && !pfKnownCategories.includes(p.category)) pfKnownCategories.push(p.category);
    });
    const hasMore = productsState.items.length < productsState.total;
    el("products-list").innerHTML = productsState.items.map(productRowHTML).join("") + loadMoreHTML(hasMore, "products-list-more");

    const colorSelect = el("products-bulk-color-select");
    const prevColorValue = colorSelect.value;
    colorSelect.innerHTML = Object.values(COLORS).map((c) => `<option value="${esc(c.key)}">${esc(t(c.label))}</option>`).join("");
    if ([...colorSelect.options].some((o) => o.value === prevColorValue)) colorSelect.value = prevColorValue;

    /* 인라인 onclick은 CSP(helmet 기본값 script-src-attr 'none')에 막혀 실행되지 않았다(2026-10-28 정기 감사) —
       체크박스 칸 클릭이 카드로 번지지 않게 하는 처리를 여기서 리스너로 붙인다. */
    el("products-list").querySelectorAll(".grid-card-select").forEach((label) =>
      label.addEventListener("click", (e) => e.stopPropagation())
    );
    el("products-list").querySelectorAll(".product-select").forEach((cb) =>
      cb.addEventListener("change", () => {
        if (cb.checked) selectedProductIds.add(cb.dataset.id);
        else selectedProductIds.delete(cb.dataset.id);
        updateProductsBulkBar();
      })
    );

    el("products-list").querySelectorAll(".admin-product-edit").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-id]").dataset.id;
        const p = productsState.items.find((x) => x.id === id);
        if (p) fillProductForm(p);
      })
    );
    el("products-list").querySelectorAll(".admin-product-duplicate").forEach((btn) =>
      btn.addEventListener("click", () => {
        const p = productsState.items.find((x) => x.id === btn.closest("[data-id]").dataset.id);
        if (p) duplicateIntoForm(p);
      })
    );
    el("products-list").querySelectorAll(".admin-product-delete").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        if (!confirm(t("정말 삭제하시겠습니까? 되돌릴 수 없습니다.") + "\n" + id)) return;
        if (!(await adminFetch(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" }))) return;
        if (pfEditingId === id) resetProductForm();
        // 선택해 둔 상품을 하나씩 지우면 일괄 처리 바에 지워진 상품이 계속 "N개 선택됨"으로 남았다(2026-10-28 정기 감사).
        selectedProductIds.delete(id);
        updateProductsBulkBar();
        toast(t("상품을 삭제했습니다"));
        paintAdminProducts();
      })
    );

    el("products-list-more")?.addEventListener("click", () => paintAdminProducts(true));
    updateProductsBulkBar();
  }

  /* 전체 선택은 "지금까지 불러온(더 보기 포함) 상품" 기준이다 — 검색 없이 전체 상품이 목록에
     있을 때가 많아 실사용에는 무리 없지만, 페이지네이션 중 일부만 불러온 상태에서는 그만큼만
     선택된다(더 보기를 눌러 마저 불러오면 그때 다시 전체 선택하면 됨). */
  el("products-select-all").addEventListener("change", () => {
    if (el("products-select-all").checked) productsState.items.forEach((p) => selectedProductIds.add(p.id));
    else productsState.items.forEach((p) => selectedProductIds.delete(p.id));
    renderAdminProducts();
  });

  async function runProductsBulkAction(fn) {
    const ids = [...selectedProductIds];
    if (!ids.length) return;
    const result = await fn(ids);
    if (!result) return; // adminFetch가 이미 실패 사유를 토스트로 띄움
    selectedProductIds.clear();
    paintAdminProducts();
    return result;
  }

  el("products-bulk-active").addEventListener("click", () =>
    runProductsBulkAction(async (ids) => {
      const r = await adminFetch("/api/admin/products/bulk-active", { method: "PATCH", body: JSON.stringify({ ids, active: true }) });
      if (r) toast(t("{n}개 상품을 공개 처리했습니다", { n: r.count }));
      return r;
    })
  );
  el("products-bulk-inactive").addEventListener("click", () =>
    runProductsBulkAction(async (ids) => {
      const r = await adminFetch("/api/admin/products/bulk-active", { method: "PATCH", body: JSON.stringify({ ids, active: false }) });
      if (r) toast(t("{n}개 상품을 비공개 처리했습니다", { n: r.count }));
      return r;
    })
  );
  el("products-bulk-color-add").addEventListener("click", () =>
    runProductsBulkAction(async (ids) => {
      const color = el("products-bulk-color-select").value;
      if (!color) { toast(t("추가할 컬러를 선택해 주세요.")); return null; }
      const r = await adminFetch("/api/admin/products/bulk-color", { method: "PATCH", body: JSON.stringify({ ids, color }) });
      if (r) toast(t("{n}개 상품에 컬러를 추가했습니다", { n: r.count }));
      return r;
    })
  );
  /* 일괄 가격 수정(2026-09) — 세일 시즌에 여러 상품 가격을 한 번에 바꾸는 용도. mode는
     서버(routes/products.js의 bulk-price)가 그대로 검증하므로 여기선 빈 값만 막는다. */
  el("products-bulk-price-apply").addEventListener("click", () =>
    runProductsBulkAction(async (ids) => {
      const mode = el("products-bulk-price-mode").value;
      const value = Number(el("products-bulk-price-value").value);
      if (!Number.isFinite(value) || el("products-bulk-price-value").value.trim() === "") {
        toast(t("적용할 값을 입력해 주세요."));
        return null;
      }
      const modeLabel = mode === "percent" ? "%" : mode === "fixed" ? t("원 조정") : t("원으로 지정");
      if (!confirm(t("선택한 {n}개 상품 가격을 {value}{mode} 적용할까요?", { n: ids.length, value, mode: modeLabel }))) return null;
      const r = await adminFetch("/api/admin/products/bulk-price", { method: "PATCH", body: JSON.stringify({ ids, mode, value }) });
      if (r) toast(t("{n}개 상품 가격을 수정했습니다", { n: r.count }));
      return r;
    })
  );
  el("products-bulk-delete").addEventListener("click", () =>
    runProductsBulkAction(async (ids) => {
      if (!confirm(t("선택한 {n}개 상품을 정말 삭제하시겠습니까? 되돌릴 수 없습니다.", { n: ids.length }))) return null;
      const r = await adminFetch("/api/admin/products/bulk", { method: "DELETE", body: JSON.stringify({ ids }) });
      if (r && pfEditingId && ids.includes(pfEditingId)) resetProductForm();
      if (r) toast(t("{n}개 상품을 삭제했습니다", { n: r.count }));
      return r;
    })
  );

  async function paintAdminProducts(loadMore = false) {
    productsState.page = loadMore ? productsState.page + 1 : 1;
    const result = await adminFetch(`/api/admin/products?page=${productsState.page}&pageSize=${productsState.pageSize}`);
    if (!result) return;
    productsState.total = result.total;
    productsState.items = loadMore ? productsState.items.concat(result.items) : result.items;
    renderAdminProducts();
  }
