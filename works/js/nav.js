  /* ---------- 사이드바 탭 전환 ---------- */
  function switchTabs(navSelector, panelIds) {
    document.querySelectorAll(navSelector).forEach((b) =>
      b.addEventListener("click", () => {
        document.querySelectorAll(navSelector).forEach((x) => x.classList.toggle("is-active", x === b));
        Object.keys(panelIds).forEach((key) => (el(panelIds[key]).hidden = key !== b.dataset.tab));
      })
    );
  }
  switchTabs("#sidebar .nav-item", {
    home: "admin-home",
    orders: "admin-orders", returns: "admin-returns", inventory: "admin-inventory", qna: "admin-qna",
    paymentlog: "admin-paymentlog",
    products: "admin-products", coupons: "admin-coupons", reviews: "admin-reviews", lookbook: "admin-lookbook",
    members: "admin-members", notices: "admin-notices", outbox: "admin-outbox", settings: "admin-settings", auditlog: "admin-auditlog",
    dashboard: "admin-dashboard",
  });

  /* ---------- 사이드바 카테고리 아코디언 ----------
     figlo WORKS의 펼침/접힘 가능한 카테고리 그룹을 본떴다(2026-09) — 기본은 전부 펼침, 접은
     상태는 관리자별 브라우저에 기억해둔다(로그인할 때마다 다시 펼 필요 없게). 배지가 있는
     탭(주문·반품·재고·Q&A)은 전부 "업무" 그룹 안에 있고 그 그룹은 첫 방문 때 항상 펼쳐진
     상태로 시작하므로, 접힌 그룹 안의 배지를 강제로 펼쳐 보여주는 로직은 따로 두지 않았다
     (필요해지면 이 함수에 추가). */
  const NAV_GROUP_STORAGE_KEY = "works_nav_group_state";
  function initNavGroups() {
    let state = {};
    try { state = JSON.parse(localStorage.getItem(NAV_GROUP_STORAGE_KEY) || "{}"); } catch (e) {}

    document.querySelectorAll(".nav-group").forEach((group) => {
      const key = group.dataset.group;
      const header = group.querySelector(".nav-group-header");
      const body = group.querySelector(".nav-group-body");
      const expanded = state[key] !== false; // 기본값: 펼침
      body.hidden = !expanded;
      header.setAttribute("aria-expanded", String(expanded));

      header.addEventListener("click", () => {
        const nextExpanded = body.hidden; // 지금 숨겨져 있으면 펼치는 동작
        body.hidden = !nextExpanded;
        header.setAttribute("aria-expanded", String(nextExpanded));
        state[key] = nextExpanded;
        try { localStorage.setItem(NAV_GROUP_STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
      });
    });
  }
  initNavGroups();

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
  /* 알림 우선순위(severity) — 예전엔 배지가 전부 빨강이라 "품절 재고 1건"과 "환불 실패 1건"이
     똑같이 급해 보였다(2026-09 지적). 서버(/api/admin/notifications)가 내려주는 severity를
     그대로 색으로 매핑하고, 빨강(critical)은 실제 시스템 오류에만 쓴다 — 안 그러면 정작 봐야
     할 진짜 위험 신호가 평소에도 늘 떠 있는 흔한 알림들 사이에 묻힌다. */
  const NOTIF_SEVERITY_RANK = { critical: 3, warning: 2, info: 1 };
  function notifRowHTML(it) {
    if (!it.count) return "";
    const severity = NOTIF_SEVERITY_RANK[it.severity] ? it.severity : "info";
    return `<button type="button" class="notif-row notif-row--${severity}" data-tab="${esc(it.tab)}">
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
    // 벨 배지 자체도 지금 떠 있는 알림 중 가장 급한 등급의 색으로 — 열어보기 전에도 우선순위를 알 수 있게.
    const worst = result.items
      .filter((it) => it.count > 0)
      .reduce((acc, it) => (NOTIF_SEVERITY_RANK[it.severity] > NOTIF_SEVERITY_RANK[acc] ? it.severity : acc), "info");
    el("notif-badge").className = `notif-badge notif-badge--${worst}`;

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
  /* 예전엔 detail을 JSON.stringify로 그대로 찍어서("{\"orderNo\":\"R...\",\"amount\":89000,
     ...}") 관리자가 코드를 읽지 않는 한 뭐가 문제인지 알기 어려웠다(2026-09 사용자 지적) —
     자주 나오는 필드에 한글 라벨을 붙여 "주문번호: R... · 금액: 89,000원" 형태의 한 줄
     요약으로 바꾼다. 모르는 필드가 섞여 있어도(새 오류 타입 추가 시 라벨을 깜빡해도) 필드명을
     그대로 라벨 삼아 보여주므로 정보가 사라지지는 않는다. */
  const SYSTEM_ERROR_DETAIL_LABEL = {
    orderNo: "주문번호", amount: "금액", error: "오류 내용", paymentId: "결제ID",
    productId: "상품", color: "컬러", size: "사이즈", stage: "단계",
    couponCode: "쿠폰코드", userId: "회원", pointsUsed: "사용 적립금",
    source: "발생 위치", dbError: "DB 오류", paymentCancelled: "결제 취소 여부",
  };
  function systemErrorDetailText(detail) {
    if (!detail || typeof detail !== "object") return "";
    return Object.entries(detail)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => {
        const label = t(SYSTEM_ERROR_DETAIL_LABEL[k] || k);
        const value = k === "amount" && typeof v === "number" ? money(v) : String(v);
        return `${label}: ${value}`;
      })
      .join(" · ");
  }

  function notifErrorItemHTML(it) {
    const detail = esc(systemErrorDetailText(it.detail));
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
    /* "시스템 오류" 행을 누르면 열렸다가 바로 꺼지는 것처럼 보인다던 버그(2026-09 재현) —
       이 리스너가 showSystemErrors()를 부르면서 el("notif-list").innerHTML을 통째로 바꾸는데,
       그러면 방금 클릭한 버튼(e.target)이 그 순간 DOM에서 떨어져 나간다. 클릭 이벤트는 원래
       계산된 전파 경로(notif-list → notif-panel → notif-wrap → document)를 그대로 따라가
       document까지 버블링되는데, 거기 있는 "바깥 클릭 시 닫기" 리스너가 매번 그 시점에
       `notif-wrap.contains(e.target)`을 다시 확인한다 — e.target은 이미 트리에서 떨어져 나가
       어디에도 속하지 않은 상태라 contains()가 false를 반환해, 방금 연 패널을 "바깥을 클릭한
       것"으로 오인해 즉시 닫아버렸다. 벨 토글 버튼과 마찬가지로 여기서도 전파를 막아 근본
       원인을 없앤다. */
    e.stopPropagation();
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

