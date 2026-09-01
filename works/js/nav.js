  /* ---------- 사이드바 탭 전환 ---------- */
  function switchTabs(navSelector, panelIds) {
    document.querySelectorAll(navSelector).forEach((b) =>
      b.addEventListener("click", () => {
        document.querySelectorAll(navSelector).forEach((x) => x.classList.toggle("is-active", x === b));
        Object.keys(panelIds).forEach((key) => (el(panelIds[key]).hidden = key !== b.dataset.tab));
      })
    );
  }
  switchTabs("#sidebar .nav-item", { orders: "admin-orders", returns: "admin-returns", inventory: "admin-inventory", qna: "admin-qna", products: "admin-products", coupons: "admin-coupons", reviews: "admin-reviews", lookbook: "admin-lookbook", members: "admin-members", settings: "admin-settings", dashboard: "admin-dashboard", auditlog: "admin-auditlog" });

  /* ---------- 모바일 사이드바 서랍(drawer) 열기/닫기 ----------
     좁은 화면에서만 CSS로 실제 서랍처럼 보이고(위 @media 참고), 넓은 화면에서는
     이 토글이 있어도 CSS가 .is-open을 무시하므로 사이드바는 항상 그대로 보인다. */
  function closeSidebarDrawer() {
    el("sidebar").classList.remove("is-open");
    el("sidebar-backdrop").classList.remove("is-open");
    el("sidebar-toggle").setAttribute("aria-expanded", "false");
  }
  el("sidebar-toggle").addEventListener("click", () => {
    const isOpen = el("sidebar").classList.toggle("is-open");
    el("sidebar-backdrop").classList.toggle("is-open", isOpen);
    el("sidebar-toggle").setAttribute("aria-expanded", String(isOpen));
  });
  el("sidebar-backdrop").addEventListener("click", closeSidebarDrawer);
  el("sidebar").querySelectorAll(".nav-item").forEach((b) => b.addEventListener("click", closeSidebarDrawer));

  el("admin-lang-switch").querySelectorAll("[data-admin-lang]").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.adminLang === getLang() ? "true" : "false");
    b.addEventListener("click", () => setLang(b.dataset.adminLang));
  });

  /* ---------- 알림센터 ----------
     읽음/안읽음을 DB에 저장하지 않고, 로그인 직후(그리고 벨 아이콘을 열 때마다) 그 시점 기준
     "확인이 필요한 것" 건수를 서버에서 다시 센다(server.js의 /api/admin/notifications) — 상태를
     바꾸면(입금확인 처리, 답변 등록 등) 자연히 카운트에서 빠지는 방식이라 별도 읽음 처리 UI가
     필요 없다. */
  function notifRowHTML(it) {
    if (!it.count) return "";
    return `<button type="button" class="notif-row" data-tab="${esc(it.tab)}">
      <span>${esc(t(it.label))}</span>
      <span class="notif-row-count">${it.count > 99 ? "99+" : it.count}</span>
    </button>`;
  }

  async function paintNotifications() {
    el("notif-panel").classList.remove("notif-panel--wide");
    const result = await adminFetch("/api/admin/notifications");
    if (!result) return;
    const rows = result.items.map(notifRowHTML).join("");
    el("notif-list").innerHTML = rows || `<div class="notif-empty">${esc(t("확인할 알림이 없습니다"))}</div>`;
    el("notif-badge").hidden = result.total === 0;
    el("notif-badge").textContent = result.total > 99 ? "99+" : result.total;

    /* 벨 드롭다운을 열어봐야만 알 수 있으면 눈에 잘 안 띈다는 피드백 — 같은 데이터를 왼쪽
       사이드바의 해당 탭에도 작은 빨간 배지로 바로 보이게 중복 표시한다. */
    result.items.forEach((it) => {
      const badge = el(`nav-badge-${it.tab}`);
      if (!badge) return;
      badge.hidden = it.count === 0;
      badge.textContent = it.count > 99 ? "99+" : it.count;
    });
  }

  el("notif-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = el("notif-panel").hidden;
    el("notif-panel").hidden = !willOpen;
    if (willOpen) paintNotifications(); // 열 때마다 최신 건수로 갱신
  });
  /* "시스템 오류"는 사이드바에 전용 탭이 없다 — 카드결제 이중실패·환불 실패처럼 지금까지
     관리자 이메일로만 가서 놓치기 쉬웠던 이벤트를, 탭 이동 없이 알림 패널 안에서 바로
     펼쳐 보여주고 그 자리에서 "해결" 처리까지 할 수 있게 한다. */
  function notifErrorItemHTML(it) {
    const detail = it.detail ? esc(JSON.stringify(it.detail)) : "";
    const at = new Date(it.at).toLocaleString(getLang() === "de" ? "de-DE" : "ko-KR");
    return `<div class="notif-error-item" data-id="${esc(it.id)}">
      <div class="notif-error-item-head">
        <span class="notif-error-type">${esc(t(it.label))}</span>
        <span class="notif-error-at">${esc(at)}</span>
      </div>
      ${detail ? `<div class="notif-error-detail">${detail}</div>` : ""}
      <button type="button" class="notif-error-resolve" data-id="${esc(it.id)}">${esc(t("해결됨으로 표시"))}</button>
    </div>`;
  }

  async function showSystemErrors() {
    el("notif-panel").classList.add("notif-panel--wide");
    el("notif-list").innerHTML = `<div class="notif-empty">${esc(t("불러오는 중"))}…</div>`;
    const result = await adminFetch("/api/admin/system-errors");
    const items = (result && result.items) || [];
    const back = `<button type="button" class="notif-back" id="notif-back">← ${esc(t("알림 목록"))}</button>`;
    const rows = items.map(notifErrorItemHTML).join("");
    el("notif-list").innerHTML = back + (rows || `<div class="notif-empty">${esc(t("확인할 알림이 없습니다"))}</div>`);
  }

  el("notif-list").addEventListener("click", async (e) => {
    if (e.target.closest("#notif-back")) {
      el("notif-panel").classList.remove("notif-panel--wide");
      paintNotifications();
      return;
    }
    const resolveBtn = e.target.closest(".notif-error-resolve");
    if (resolveBtn) {
      resolveBtn.disabled = true;
      const ok = await adminFetch(`/api/admin/system-errors/${resolveBtn.dataset.id}/resolve`, { method: "POST" });
      if (ok) showSystemErrors();
      else resolveBtn.disabled = false;
      return;
    }
    const row = e.target.closest(".notif-row");
    if (!row) return;
    if (row.dataset.tab === "systemErrors") {
      showSystemErrors();
      return;
    }
    el("notif-panel").hidden = true;
    document.querySelector(`.nav-item[data-tab="${row.dataset.tab}"]`)?.click();
  });
  document.addEventListener("click", (e) => {
    if (!el("notif-panel").hidden && !el("notif-wrap").contains(e.target)) el("notif-panel").hidden = true;
  });

  /* 색상 팔레트 — 이 페이지는 app.js를 안 불러오므로 소스 코드/assets/js/app.js의
     loadColors()와 같은 로직을 여기서도 별도로 둔다. 실패하면 data.js의 정적 6종이 그대로 남는다. */
  async function loadColorsLocal() {
    try {
      const res = await fetch("/api/colors");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        Object.keys(COLORS).forEach((k) => delete COLORS[k]);
        data.forEach((c) => { COLORS[c.key] = c; });
      }
    } catch (e) {}
  }

  async function adminFetch(path, opts) {
    const token = await getAccessToken();
    if (!token) {
      toast(t("로그인이 만료되었습니다. 다시 로그인해 주세요."));
      return null;
    }
    const res = await fetch(path, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(opts && opts.headers) },
    });
    if (!res.ok) {
      if (res.status === 401) {
        toast(t("로그인이 만료되었습니다. 다시 로그인해 주세요."));
      } else {
        let message = "";
        try { message = (await res.json()).error || ""; } catch (e) {}
        toast(message || t("요청이 실패했습니다") + ` (${res.status})`);
      }
      return null;
    }
    return res.json();
  }

  function loadMoreHTML(hasMore, id) {
    if (!hasMore) return "";
    return `<div style="grid-column:1/-1;text-align:center;margin-top:8px">
      <button type="button" id="${id}" class="btn btn--sm btn--ghost">${esc(t("더 보기"))}</button>
    </div>`;
  }

