  /* ---------- 즐겨찾기·자주 쓰는 기능 (2026-11-11) ----------
     - 각 화면 제목 옆 ☆를 누르면 사이드바 맨 위 "즐겨찾기"에 고정된다(★ 다시 누르면 해제).
     - 홈 "자주 쓰는 기능"은 즐겨찾기 → 이 기기에서 많이 연 화면 → 기본 순서로 채운다.
     기기(브라우저)·관리자별로 저장한다(localStorage) — 다른 사람·다른 기기에는 영향 없음. */
  const FAV_PANEL_IDS = {
    orders: "admin-orders", returns: "admin-returns", inventory: "admin-inventory", qna: "admin-qna", paymentlog: "admin-paymentlog",
    products: "admin-products", coupons: "admin-coupons", reviews: "admin-reviews", lookbook: "admin-lookbook", members: "admin-members",
    calendar: "admin-calendar", notices: "admin-notices", outbox: "admin-outbox", settings: "admin-settings", auditlog: "admin-auditlog",
    dashboard: "admin-dashboard", usagestats: "admin-usagestats", staff: "admin-staff", expenses: "admin-expenses", agent: "admin-agent",
  };
  const SHORTCUT_DESC = {
    orders: "주문 검색·상태 변경·배송 등록",
    inventory: "색상·사이즈별 수량 확인·수정",
    paymentlog: "실패·불일치한 결제 시도 확인",
    members: "회원 검색, 차단·삭제, 관리자 승격",
    outbox: "이메일·알림 발송 실패 확인",
    dashboard: "매출·베스트셀러·기기별 통계",
    calendar: "발매일·행사·휴무 일정 확인",
    expenses: "지출 기록·동업자 정산·예산",
    agent: "AI가 제안한 작업 승인·거절",
  };
  const DEFAULT_SHORTCUTS = ["orders", "inventory", "paymentlog", "members", "outbox", "dashboard", "calendar"];

  function favKey(kind) {
    const who = (typeof adminMe !== "undefined" && adminMe && adminMe.email) || "me";
    return `works_${kind}:${who.toLowerCase()}`;
  }
  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "null") || fallback; } catch (e) { return fallback; }
  }
  function writeJSON(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {}
  }
  function getFavorites() { return readJSON(favKey("favs"), []).filter((tab) => FAV_PANEL_IDS[tab]); }
  function isFavorite(tab) { return getFavorites().includes(tab); }
  function toggleFavorite(tab) {
    const favs = getFavorites();
    const next = favs.includes(tab) ? favs.filter((x) => x !== tab) : [...favs, tab];
    writeJSON(favKey("favs"), next);
    renderFavorites();
    if (typeof renderHomeShortcuts === "function") renderHomeShortcuts();
    toast(t(next.includes(tab) ? "즐겨찾기에 추가했습니다" : "즐겨찾기에서 뺐습니다"));
  }
  function countTabUse(tab) {
    if (!FAV_PANEL_IDS[tab]) return;
    const c = readJSON(favKey("tabuse"), {});
    c[tab] = (c[tab] || 0) + 1;
    writeJSON(favKey("tabuse"), c);
  }

  function navLabel(tab) {
    const b = document.querySelector(`#sidebar .nav-item[data-tab="${tab}"] span[data-i18n]`);
    return b ? b.textContent.trim() : tab;
  }

  /* 홈 "자주 쓰는 기능"에 보여줄 탭 순서 */
  function homeShortcutTabs(limit = 8) {
    const use = readJSON(favKey("tabuse"), {});
    const byUse = Object.keys(use).sort((a, b) => use[b] - use[a]).filter((tab) => use[tab] >= 3);
    const seen = new Set();
    return [...getFavorites(), ...byUse, ...DEFAULT_SHORTCUTS]
      .filter((tab) => { if (seen.has(tab) || !FAV_PANEL_IDS[tab] || !canView(tab)) return false; seen.add(tab); return true; })
      .slice(0, limit)
      .map((tab) => ({ tab, title: navLabel(tab), desc: SHORTCUT_DESC[tab] ? t(SHORTCUT_DESC[tab]) : "", fav: isFavorite(tab) }));
  }

  function renderFavorites() {
    const favs = getFavorites().filter((tab) => canView(tab));
    const box = el("nav-favorites");
    if (box) {
      box.hidden = !favs.length;
      el("nav-favorites-list").innerHTML = favs
        .map((tab) => `<button type="button" class="nav-item nav-item--fav" data-fav-tab="${esc(tab)}"><span class="nav-fav-star" aria-hidden="true">★</span><span>${esc(navLabel(tab))}</span></button>`)
        .join("");
    }
    // 각 화면 제목 옆 ☆ 버튼 상태
    Object.entries(FAV_PANEL_IDS).forEach(([tab, panelId]) => {
      const btn = document.querySelector(`#${panelId} .fav-toggle`);
      if (!btn) return;
      const on = favs.includes(tab);
      btn.textContent = on ? "★" : "☆";
      btn.setAttribute("aria-pressed", String(on));
      btn.title = t(on ? "즐겨찾기에서 빼기" : "즐겨찾기에 추가(사이드바 맨 위·홈에 고정)");
    });
  }

  (function initFavorites() {
    // 화면 제목 옆에 ☆ 버튼을 붙인다
    Object.entries(FAV_PANEL_IDS).forEach(([tab, panelId]) => {
      const title = document.querySelector(`#${panelId} .content-head .content-title`);
      if (!title || title.querySelector(".fav-toggle")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fav-toggle";
      btn.dataset.favToggle = tab;
      btn.textContent = "☆";
      btn.setAttribute("aria-pressed", "false");
      title.appendChild(btn);
      btn.addEventListener("click", () => toggleFavorite(tab));
    });
    el("nav-favorites-list")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fav-tab]");
      if (b) goToTab(b.dataset.favTab);
    });
    document.querySelectorAll("#sidebar .nav-item[data-tab]").forEach((b) => b.addEventListener("click", () => countTabUse(b.dataset.tab)));
  })();
