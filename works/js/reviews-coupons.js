  /* ---------- 리뷰 승인 ---------- */
  const reviewsState = { page: 0, pageSize: 20, total: 0, items: [], q: "", status: "", dateFrom: "", dateTo: "" };

  /* 리뷰는 돈이 걸려 있지 않아 반품·주문보다 훨씬 안전하게 일괄 처리할 수 있다 — 상품 탭과
     같은 체크박스 다중 선택 + 상단 바 패턴(products.js 참고). */
  const selectedReviewIds = new Set();

  function stars(n) { return "★".repeat(n) + "☆".repeat(5 - n); }

  function reviewCardHTML(r) {
    return `
      <div class="panel" data-id="${esc(r.id)}">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline">
          <label class="checkbox" style="gap:6px"><input type="checkbox" class="review-select" data-id="${esc(r.id)}" ${selectedReviewIds.has(r.id) ? "checked" : ""}><b>${esc(r.name)}</b></label>
          <span class="small tnum">${fmtDate(r.at)}</span>
        </div>
        <div style="margin-top:6px;letter-spacing:.05em">${stars(r.rating)}</div>
        <div class="small" style="margin-top:6px">
          ${esc(r.productId)} ·
          ${r.approved ? `<span style="color:var(--ok)">${esc(t("게시중"))}</span>` : `<span style="color:var(--danger)">${esc(t("승인 대기"))}</span>`}
          ${r.orderNo ? ` · <span style="color:var(--ok)" title="${esc(r.orderNo)}">✓ ${esc(t("구매 인증"))}</span>` : ` · <span style="color:var(--text-muted)">${esc(t("인증 정보 없음(예전 리뷰)"))}</span>`}
        </div>
        <p style="margin-top:10px">${esc(r.comment)}</p>
        ${r.photoUrl ? `<img src="${esc(r.photoUrl)}" alt="" loading="lazy" style="margin-top:10px;max-width:180px;border-radius:8px;display:block">` : ""}
        ${r.instagramHandle ? `<p class="small" style="margin-top:8px">Instagram @${esc(r.instagramHandle)}</p>` : ""}
        <div style="display:flex;gap:8px;margin-top:12px">
          <button type="button" class="btn btn--sm admin-review-toggle">${esc(r.approved ? t("숨기기") : t("승인"))}</button>
          <button type="button" class="btn btn--sm btn--danger admin-review-delete">${esc(t("삭제"))}</button>
        </div>
      </div>`;
  }

  function updateReviewsBulkBar() {
    const n = selectedReviewIds.size;
    el("reviews-bulk-actions").hidden = n === 0;
    el("reviews-selected-count").textContent = n ? t("{n}개 선택됨", { n }) : "";
    const loadedIds = reviewsState.items.map((r) => r.id);
    el("reviews-select-all").checked = loadedIds.length > 0 && loadedIds.every((id) => selectedReviewIds.has(id));
  }

  function renderAdminReviews() {
    el("reviews-summary").textContent = t("총 {n}건", { n: reviewsState.total });
    const hasMore = reviewsState.items.length < reviewsState.total;
    el("admin-reviews-list").innerHTML = reviewsState.items.length
      ? reviewsState.items.map(reviewCardHTML).join("") + loadMoreHTML(hasMore, "admin-reviews-more")
      : `<p class="small">${esc(t("조건에 맞는 리뷰가 없습니다"))}</p>`;

    el("admin-reviews-list").querySelectorAll(".review-select").forEach((cb) =>
      cb.addEventListener("change", () => {
        if (cb.checked) selectedReviewIds.add(cb.dataset.id);
        else selectedReviewIds.delete(cb.dataset.id);
        updateReviewsBulkBar();
      })
    );

    el("admin-reviews-list").querySelectorAll(".admin-review-toggle").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        const item = reviewsState.items.find((x) => x.id === id);
        if (!item) return;
        const nextApproved = !item.approved;
        btn.disabled = true;
        await adminFetch(`/api/admin/reviews/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ approved: nextApproved }),
        });
        item.approved = nextApproved;
        toast(nextApproved ? t("리뷰를 승인했습니다") : t("리뷰를 숨겼습니다"));
        renderAdminReviews();
      })
    );

    el("admin-reviews-list").querySelectorAll(".admin-review-delete").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        if (!confirm(t("이 리뷰를 삭제하시겠습니까? 되돌릴 수 없습니다."))) return;
        await adminFetch(`/api/admin/reviews/${encodeURIComponent(id)}`, { method: "DELETE" });
        reviewsState.items = reviewsState.items.filter((x) => x.id !== id);
        reviewsState.total = Math.max(0, reviewsState.total - 1);
        selectedReviewIds.delete(id);
        toast(t("리뷰를 삭제했습니다"));
        renderAdminReviews();
      })
    );

    el("admin-reviews-more")?.addEventListener("click", () => paintAdminReviews(true));
    updateReviewsBulkBar();
  }

  el("reviews-select-all").addEventListener("change", () => {
    if (el("reviews-select-all").checked) reviewsState.items.forEach((r) => selectedReviewIds.add(r.id));
    else reviewsState.items.forEach((r) => selectedReviewIds.delete(r.id));
    renderAdminReviews();
  });

  async function runReviewsBulkApprove(approved) {
    const ids = [...selectedReviewIds];
    if (!ids.length) return;
    const r = await adminFetch("/api/admin/reviews/bulk-approve", { method: "PATCH", body: JSON.stringify({ ids, approved }) });
    if (!r) return; // adminFetch가 이미 실패 사유를 토스트로 띄움
    selectedReviewIds.clear();
    toast(approved ? t("{n}개 리뷰를 승인했습니다", { n: r.count }) : t("{n}개 리뷰를 숨겼습니다", { n: r.count }));
    paintAdminReviews();
  }
  el("reviews-bulk-approve").addEventListener("click", () => runReviewsBulkApprove(true));
  el("reviews-bulk-hide").addEventListener("click", () => runReviewsBulkApprove(false));

  function reviewsQueryParams() {
    const params = new URLSearchParams({ page: reviewsState.page, pageSize: reviewsState.pageSize });
    if (reviewsState.q) params.set("q", reviewsState.q);
    if (reviewsState.status) params.set("status", reviewsState.status);
    if (reviewsState.dateFrom) params.set("dateFrom", reviewsState.dateFrom);
    if (reviewsState.dateTo) params.set("dateTo", reviewsState.dateTo);
    return params;
  }

  async function paintAdminReviews(loadMore = false) {
    reviewsState.page = loadMore ? reviewsState.page + 1 : 1;
    const result = await adminFetch(`/api/admin/reviews?${reviewsQueryParams().toString()}`);
    if (!result) return;
    reviewsState.total = result.total;
    reviewsState.items = loadMore ? reviewsState.items.concat(result.items) : result.items;
    renderAdminReviews();
  }

  el("rv-search").addEventListener("click", () => {
    reviewsState.q = el("rv-q").value.trim();
    reviewsState.status = el("rv-status").value;
    reviewsState.dateFrom = el("rv-from").value;
    reviewsState.dateTo = el("rv-to").value;
    paintAdminReviews();
  });
  el("rv-reset").addEventListener("click", () => {
    el("rv-q").value = "";
    el("rv-status").value = "";
    el("rv-from").value = "";
    el("rv-to").value = "";
    el("rv-search").click();
  });
  el("rv-q").addEventListener("keydown", (e) => { if (e.key === "Enter") el("rv-search").click(); });

  /* ---------- 쿠폰 ----------
     할인율·정액, 적용 상품, 기간, 사용 한도를 관리자가 직접 만들 수 있게 한다.
     "상품 관리"의 색상 팔레트 관리와 같은 패턴 — cpEditingCode가 null이면 새로 만드는 중,
     코드가 들어 있으면 그 쿠폰을 수정하는 중이다. */
  const couponsState = { items: [] };
  let cpEditingCode = null;
  let cpSelectedProductIds = [];

  function couponScopeLabel(c) {
    return c.scope === "products" ? t("{n}개 상품 지정", { n: c.productIds.length }) : t("전체 상품");
  }

  function couponDiscountLabel(c) {
    return c.discountType === "percent" ? `${c.discountValue}%` : money(c.discountValue);
  }

  function couponCardHTML(c) {
    const period =
      c.startsAt || c.endsAt
        ? `${c.startsAt ? c.startsAt.slice(0, 10) : "-"} ~ ${c.endsAt ? c.endsAt.slice(0, 10) : "-"}`
        : t("기간 제한 없음");
    return `
      <div class="panel" data-code="${esc(c.code)}" style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
        <div>
          <div style="display:flex;gap:8px;align-items:center">
            <b class="tnum">${esc(c.code)}</b>
            <span class="status-chip ${c.active ? "st-confirmed" : "st-neutral"}">${esc(t(c.active ? "활성" : "비활성"))}</span>
          </div>
          <p class="small" style="margin-top:6px">
            ${esc(couponDiscountLabel(c))} ${esc(t("할인"))} · ${esc(couponScopeLabel(c))}
            ${c.minSubtotal ? ` · ${esc(t("최소 {n} 이상", { n: money(c.minSubtotal) }))}` : ""}
            ${c.usageLimit ? ` · ${esc(t("한도 {n}회", { n: c.usageLimit }))}` : ""}
          </p>
          <p class="small" style="margin-top:4px;color:var(--text-muted)">${esc(period)}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn--sm btn--ghost cp-toggle">${esc(t(c.active ? "비활성화" : "활성화"))}</button>
          <button type="button" class="btn btn--sm btn--ghost cp-edit">${esc(t("수정"))}</button>
          <button type="button" class="btn btn--sm btn--danger cp-delete">${esc(t("삭제"))}</button>
        </div>
      </div>`;
  }

  function renderAdminCoupons() {
    el("admin-coupons-list").innerHTML = couponsState.items.length
      ? couponsState.items.map(couponCardHTML).join("")
      : `<p class="small">${esc(t("등록된 쿠폰이 없습니다"))}</p>`;

    el("admin-coupons-list").querySelectorAll(".cp-toggle").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const code = btn.closest("[data-code]").dataset.code;
        const c = couponsState.items.find((x) => x.code === code);
        if (!c) return;
        const result = await adminFetch(`/api/admin/coupons/${encodeURIComponent(code)}`, {
          method: "PATCH",
          body: JSON.stringify({ active: !c.active }),
        });
        if (!result) return;
        c.active = result.active;
        renderAdminCoupons();
      })
    );
    el("admin-coupons-list").querySelectorAll(".cp-edit").forEach((btn) =>
      btn.addEventListener("click", () => {
        const code = btn.closest("[data-code]").dataset.code;
        const c = couponsState.items.find((x) => x.code === code);
        if (c) fillCouponForm(c);
      })
    );
    el("admin-coupons-list").querySelectorAll(".cp-delete").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const code = btn.closest("[data-code]").dataset.code;
        if (!confirm(t("이 쿠폰을 삭제하시겠습니까? 되돌릴 수 없습니다."))) return;
        const result = await adminFetch(`/api/admin/coupons/${encodeURIComponent(code)}`, { method: "DELETE" });
        if (!result) return;
        couponsState.items = couponsState.items.filter((x) => x.code !== code);
        if (cpEditingCode === code) resetCouponForm();
        renderAdminCoupons();
        toast(t("쿠폰을 삭제했습니다"));
      })
    );
  }

  async function paintAdminCoupons() {
    const result = await adminFetch("/api/admin/coupons");
    if (!result) return;
    couponsState.items = result;
    renderAdminCoupons();
  }

  /* 적용 상품 선택 칩 — 상품 등록 폼의 컬러 칩과 같은 토글 방식. scope가 "지정 상품만"일 때만 보인다. */
  function renderCouponProductChips() {
    const products = productsState.items;
    if (!products.length) {
      el("cp-products").innerHTML = `<p class="small">${esc(t("상품 목록을 불러오는 중입니다…"))}</p>`;
      return;
    }
    el("cp-products").innerHTML = products
      .map(
        (p) => `<button type="button" class="chip cp-product" data-id="${esc(p.id)}" aria-pressed="${cpSelectedProductIds.includes(p.id)}">${esc(t(p.nameKo))}</button>`
      )
      .join("");
    el("cp-products").querySelectorAll(".cp-product").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.id;
        cpSelectedProductIds = cpSelectedProductIds.includes(id) ? cpSelectedProductIds.filter((x) => x !== id) : [...cpSelectedProductIds, id];
        renderCouponProductChips();
      })
    );
  }

  function syncCouponScopeUI() {
    const isProducts = el("cp-scope").value === "products";
    el("cp-products-field").hidden = !isProducts;
    if (isProducts) renderCouponProductChips();
  }
  el("cp-scope").addEventListener("change", syncCouponScopeUI);

  function resetCouponForm() {
    cpEditingCode = null;
    cpSelectedProductIds = [];
    el("coupon-form-title").textContent = t("새 쿠폰");
    el("coupon-form").reset();
    el("cp-code").disabled = false;
    el("cp-active").checked = true;
    el("cp-cancel").hidden = true;
    syncCouponScopeUI();
  }

  function fillCouponForm(c) {
    cpEditingCode = c.code;
    cpSelectedProductIds = [...c.productIds];
    el("coupon-form-title").textContent = t("쿠폰 수정") + ` — ${c.code}`;
    el("cp-code").value = c.code;
    el("cp-code").disabled = true; // 코드 자체가 기본키라 수정 중에는 바꿀 수 없다.
    el("cp-discount-type").value = c.discountType;
    el("cp-discount-value").value = c.discountValue;
    el("cp-scope").value = c.scope;
    el("cp-min-subtotal").value = c.minSubtotal || 0;
    el("cp-usage-limit").value = c.usageLimit || "";
    el("cp-starts").value = c.startsAt ? c.startsAt.slice(0, 10) : "";
    el("cp-ends").value = c.endsAt ? c.endsAt.slice(0, 10) : "";
    el("cp-active").checked = c.active;
    el("cp-cancel").hidden = false;
    syncCouponScopeUI();
  }

  el("cp-cancel").addEventListener("click", resetCouponForm);

  el("coupon-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const scope = el("cp-scope").value;
    if (scope === "products" && !cpSelectedProductIds.length) {
      toast(t("적용할 상품을 하나 이상 선택해 주세요."));
      return;
    }
    const body = {
      discountType: el("cp-discount-type").value,
      discountValue: Number(el("cp-discount-value").value),
      scope,
      productIds: cpSelectedProductIds,
      minSubtotal: Number(el("cp-min-subtotal").value) || 0,
      usageLimit: el("cp-usage-limit").value ? Number(el("cp-usage-limit").value) : null,
      startsAt: el("cp-starts").value ? `${el("cp-starts").value}T00:00:00+09:00` : null,
      endsAt: el("cp-ends").value ? `${el("cp-ends").value}T23:59:59+09:00` : null,
      active: el("cp-active").checked,
    };

    const saveBtn = el("cp-save");
    saveBtn.disabled = true;
    let result;
    if (cpEditingCode) {
      result = await adminFetch(`/api/admin/coupons/${encodeURIComponent(cpEditingCode)}`, { method: "PATCH", body: JSON.stringify(body) });
    } else {
      result = await adminFetch("/api/admin/coupons", { method: "POST", body: JSON.stringify({ code: el("cp-code").value, ...body }) });
    }
    saveBtn.disabled = false;
    if (!result) return;

    const idx = couponsState.items.findIndex((x) => x.code === result.code);
    if (idx > -1) couponsState.items[idx] = result;
    else couponsState.items.unshift(result);
    renderAdminCoupons();
    toast(t(cpEditingCode ? "쿠폰을 수정했습니다" : "쿠폰을 만들었습니다"));
    resetCouponForm();
  });

  resetCouponForm();

