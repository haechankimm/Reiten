/* reviews.html 전용 스크립트 — 예전엔 HTML 안 인라인 <script>였다(2026-11-11 분리, 동작 동일). */
  applyI18n();
  renderHeader("");

  (async () => {
  await Promise.all([loadProducts(), loadColors()]);

  const el = (id) => document.getElementById(id);
  const filterProduct = qs("product");
  let serverUp = false;
  let reviews = REVIEWS;
  let activeFilter = filterProduct && PRODUCTS.some(p => p.id === filterProduct) ? filterProduct : "all";
  let rating = 5;

  const SORTS = [
    { key: "latest", label: "최신순" },
    { key: "rating-desc", label: "별점 높은순" },
    { key: "rating-asc", label: "별점 낮은순" },
    { key: "helpful", label: "인기순" },
  ];
  let activeSort = "latest";

  const LIKED_KEY = "reiten_liked_reviews";
  function getLiked() {
    try { return JSON.parse(localStorage.getItem(LIKED_KEY)) || []; }
    catch (e) { return []; }
  }
  function markLiked(id) {
    const liked = getLiked();
    if (!liked.includes(id)) {
      liked.push(id);
      try { localStorage.setItem(LIKED_KEY, JSON.stringify(liked)); } catch (e) {}
    }
  }

  function sortReviews(list) {
    const sorted = list.slice();
    if (activeSort === "rating-desc") sorted.sort((a, b) => b.rating - a.rating || new Date(b.at) - new Date(a.at));
    else if (activeSort === "rating-asc") sorted.sort((a, b) => a.rating - b.rating || new Date(b.at) - new Date(a.at));
    else if (activeSort === "helpful") sorted.sort((a, b) => (b.helpfulCount || 0) - (a.helpfulCount || 0) || new Date(b.at) - new Date(a.at));
    else sorted.sort((a, b) => new Date(b.at) - new Date(a.at));
    return sorted;
  }

  function paintSorts() {
    el("sorts").innerHTML = SORTS.map(s => `
      <button class="chip" type="button" data-sort="${s.key}" aria-pressed="${s.key === activeSort}">
        ${esc(t(s.label))}
      </button>`).join("");
    el("sorts").querySelectorAll(".chip").forEach(b =>
      b.addEventListener("click", () => { activeSort = b.dataset.sort; paint(); }));
  }

  function productLabel(id) {
    if (id === "general") return t("전체 상품");
    const p = getProduct(id);
    return p ? productName(p) : id;
  }

  function paintFilters() {
    const cats = ["all", "general", ...PRODUCTS.map(p => p.id)];
    el("filters").innerHTML = cats.map(id => `
      <button class="chip" type="button" data-id="${id}" aria-pressed="${id === activeFilter}">
        ${id === "all" ? esc(t("전체")) : esc(productLabel(id))}
      </button>`).join("");
    el("filters").querySelectorAll(".chip").forEach(b =>
      b.addEventListener("click", () => { activeFilter = b.dataset.id; paint(); }));
  }

  function stars(n) {
    return "★".repeat(n) + "☆".repeat(5 - n);
  }

  function paintList() {
    const filtered = activeFilter === "all" ? reviews : reviews.filter(r => r.productId === activeFilter);
    const list = sortReviews(filtered);
    const liked = getLiked();
    el("list").innerHTML = list.map(r => `
      <div class="panel" data-reveal data-review-id="${esc(r.id)}">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline">
          <b>${esc(r.name)}</b>
          <span class="small tnum">${new Date(r.at).toLocaleDateString(getLang() === "ko" ? "ko-KR" : getLang() === "ja" ? "ja-JP" : "en-US")}</span>
        </div>
        <div style="margin-top:6px;color:var(--ink);letter-spacing:.05em">${stars(r.rating)}</div>
        <div class="small" style="margin-top:6px">${esc(productLabel(r.productId))}</div>
        <p style="margin-top:10px">${esc(r.comment)}</p>
        ${r.photoUrl ? `<img src="${esc(r.photoUrl)}" alt="" loading="lazy" style="margin-top:12px;max-width:220px;border-radius:8px;display:block">` : ""}
        ${r.instagramHandle ? `
          <a href="https://instagram.com/${esc(r.instagramHandle)}" target="_blank" rel="noopener noreferrer" class="insta-link" title="${esc(t("인스타그램에서 보기"))}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1"/></svg>
            <span data-i18n="인스타그램에서 보기">${esc(t("인스타그램에서 보기"))}</span> · @${esc(r.instagramHandle)}
          </a>` : ""}
        <div>
          <button type="button" class="helpful-btn" data-id="${esc(r.id)}" aria-pressed="${liked.includes(r.id)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Zm0 0 4.5-8a2 2 0 0 1 3.6 1.7L14 9h4.5a2 2 0 0 1 2 2.3l-1.3 8A2 2 0 0 1 17.2 21H7"/></svg>
            <span data-i18n="도움돼요">${esc(t("도움돼요"))}</span> (${r.helpfulCount || 0})
          </button>
        </div>
      </div>`).join("");
    el("empty").hidden = list.length > 0;

    el("list").querySelectorAll(".helpful-btn").forEach(b =>
      b.addEventListener("click", () => onHelpfulClick(b.dataset.id)));

    initReveal();
  }

  async function onHelpfulClick(id) {
    if (getLiked().includes(id)) return;
    const btn = el("list").querySelector(`.helpful-btn[data-id="${id}"]`);
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/reviews/${encodeURIComponent(id)}/helpful`, { method: "POST" });
      if (!res.ok) throw new Error("failed");
      const { helpfulCount } = await res.json();
      const r = reviews.find(x => x.id === id);
      if (r) r.helpfulCount = helpfulCount;
      markLiked(id);
      paintList();
    } catch (err) {
      toast(t("처리에 실패했습니다"));
      if (btn) btn.disabled = false;
    }
  }

  function paintRatingChips() {
    el("r-rating").innerHTML = [1, 2, 3, 4, 5].map(n => `
      <button class="chip" type="button" data-n="${n}" aria-pressed="${n === rating}">${stars(n)}</button>
    `).join("");
    el("r-rating").querySelectorAll(".chip").forEach(b =>
      b.addEventListener("click", () => { rating = Number(b.dataset.n); paintRatingChips(); }));
  }

  function paint() {
    paintFilters();
    paintSorts();
    paintList();
  }

  el("r-product").innerHTML = ["general", ...PRODUCTS.map(p => p.id)]
    .map(id => `<option value="${id}">${esc(productLabel(id))}</option>`).join("");
  if (filterProduct && PRODUCTS.some(p => p.id === filterProduct)) el("r-product").value = filterProduct;
  // 리뷰 요청 메일의 링크(?order=...&product=...#write)로 들어오면 주문번호를 채우고 작성 폼으로 이동
  if (qs("order")) {
    el("r-order-no").value = qs("order");
    if (location.hash === "#write") setTimeout(() => el("form-wrap").scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  }
  paintRatingChips();

  // 사진 리뷰 적립금 안내 — 금액은 Works "정보" 탭 설정값(/api/config), 0이면 안내 숨김
  fetch("/api/config").then((r) => (r.ok ? r.json() : null)).then((cfg) => {
    if (!cfg || !cfg.reviewPhotoPoints) return;
    const note = el("r-photo-reward");
    note.textContent = t("회원으로 주문하신 상품에 사진 리뷰를 남기면, 승인 후 적립금 {amount}을 드려요.", { amount: money(cfg.reviewPhotoPoints) });
    note.hidden = false;
  }).catch(() => {});

  el("r-photo").addEventListener("change", () => {
    const file = el("r-photo").files[0];
    el("r-photo-name").textContent = file ? file.name : t("선택된 파일 없음");
    if (file) {
      el("r-photo-preview").src = URL.createObjectURL(file);
      el("r-photo-preview").hidden = false;
    } else {
      el("r-photo-preview").hidden = true;
    }
  });

  el("review-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = el("r-name");
    const comment = el("r-comment");
    const orderNoEl = el("r-order-no");
    const telEl = el("r-tel");
    let ok = true;
    const requireField = (input) => {
      if (!input.value.trim()) { input.setAttribute("aria-invalid", "true"); input.closest(".field").querySelector(".err").classList.add("on"); ok = false; }
      else { input.setAttribute("aria-invalid", "false"); input.closest(".field").querySelector(".err").classList.remove("on"); }
    };
    requireField(name);
    requireField(comment);
    requireField(orderNoEl);
    requireField(telEl);
    if (!ok) return;

    const btn = el("r-submit");
    btn.disabled = true;
    try {
      const fd = new FormData();
      fd.append("productId", el("r-product").value);
      fd.append("orderNo", orderNoEl.value.trim());
      fd.append("tel", telEl.value.trim());
      fd.append("name", name.value.trim());
      fd.append("rating", rating);
      fd.append("comment", comment.value.trim());
      fd.append("instagram", el("r-insta").value.trim());
      const photoFile = el("r-photo").files[0];
      if (photoFile) fd.append("photo", photoFile);

      const res = await fetch("/api/reviews", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 서버가 돌려주는 이유(주문 불일치·미결제·중복 리뷰 등)를 그대로 보여준다 — cart.html의
        // 결제 오류 안내와 같은 방식(한국어 고정 문구지만, 어떤 언어 화면에서도 이유는 알 수 있어야 함).
        toast(apiErrorText(body, t("리뷰 등록에 실패했습니다")));
        return;
      }
      // 새 리뷰는 관리자 승인 전까지 공개 목록에 나오지 않으므로(스팸 방지) 화면에 바로 추가하지 않는다.
      name.value = "";
      comment.value = "";
      orderNoEl.value = "";
      telEl.value = "";
      el("r-photo").value = "";
      el("r-photo-name").textContent = t("선택된 파일 없음");
      el("r-photo-preview").hidden = true;
      el("r-insta").value = "";
      rating = 5;
      paintRatingChips();
      toast(t("리뷰가 등록되었습니다. 검수 후 노출됩니다."));
    } catch (err) {
      toast(t("리뷰 등록에 실패했습니다"));
    } finally {
      btn.disabled = false;
    }
  });

  try {
    const res = await fetch("/api/reviews");
    if (res.ok) {
      reviews = await res.json();
      serverUp = true;
    }
  } catch (err) {}

  if (!serverUp) {
    el("review-form").hidden = true;
    el("no-server-notice").hidden = false;
  }
  paint();

  renderFooter();
  })();
