  /* ---------- 상단 검색(빠른 이동) — 2026-11-11 ----------
     상단 바 검색칸(또는 Ctrl/⌘+K, "/")에 메뉴 이름이나 할 일을 치면 바로 그 화면·기능으로 간다.
     - 메뉴: 사이드바의 모든 탭(권한 없는 탭은 숨겨져 있어 자동으로 빠진다)
     - 기능: "직접 등록"·"매입 입력"·"지금 점검하기" 같은 버튼 동작
     - 검색어로 찾기: 주문번호·이름으로 주문 찾기, 회원 찾기, 문의 찾기, 반품 찾기
     항목은 아래 PALETTE_ACTIONS에 한 줄씩 추가하면 된다. */
  const PALETTE_ACTIONS = [
    { label: "공급처 송장 직접 등록", keywords: "공급처 송장 입고 택배 등록", tab: "inventory", run: () => clickWhenReady("supplier-shipments-new") },
    { label: "매입 직접 입력", keywords: "매입 장부 세금계산서 명세서 영수증", tab: "dashboard", run: () => clickWhenReady("supplier-invoices-new") },
    { label: "지금 점검하기(운영 점검)", keywords: "점검 마이그레이션 상태 오류 메일", tab: "settings", run: () => clickWhenReady("ops-check-run") },
    { label: "인수인계 노트 남기기", keywords: "인수인계 메모 노트", tab: "home", run: () => focusWhenReady("handoff-input") },
    { label: "월간 정산 엑셀 받기", keywords: "정산 엑셀 매출 리포트", tab: "dashboard", run: () => focusWhenReady("settle-month") },
  ];
  const PALETTE_QUERIES = [
    { label: "주문 찾기: {q}", tab: "orders", input: "ord-q", button: "ord-search" },
    { label: "회원 찾기: {q}", tab: "members", input: "mb-q", button: "mb-search" },
    { label: "문의 찾기: {q}", tab: "qna", input: "qna-q", button: "qna-search" },
    { label: "반품·교환 찾기: {q}", tab: "returns", input: "ret-q", button: "ret-search" },
  ];

  function clickWhenReady(id, tries = 20) {
    const b = el(id);
    if (b && b.offsetParent !== null) return b.click();
    if (tries > 0) setTimeout(() => clickWhenReady(id, tries - 1), 100);
  }
  function focusWhenReady(id, tries = 20) {
    const x = el(id);
    if (x && x.offsetParent !== null) { x.scrollIntoView({ block: "center", behavior: "smooth" }); return x.focus(); }
    if (tries > 0) setTimeout(() => focusWhenReady(id, tries - 1), 100);
  }

  const paletteState = { items: [], active: 0 };

  function paletteNavItems() {
    return [...document.querySelectorAll("#sidebar .nav-item[data-tab]")]
      .filter((b) => !b.hidden && !(b.closest(".nav-group") && b.closest(".nav-group").hidden))
      .map((b) => ({ kind: "tab", label: (b.querySelector("span[data-i18n]") || b).textContent.trim(), tab: b.dataset.tab }));
  }

  function normalize(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, "");
  }

  function paletteResults(q) {
    const nq = normalize(q);
    const tabs = paletteNavItems();
    const actions = PALETTE_ACTIONS.filter((a) => (typeof canView !== "function" || canView(a.tab))).map((a) => ({ kind: "action", label: t(a.label), keywords: a.keywords, tab: a.tab, run: a.run }));
    if (!nq) return [...tabs.slice(0, 8), ...actions].slice(0, 12);
    const score = (it) => {
      const l = normalize(it.label);
      if (l.startsWith(nq)) return 3;
      if (l.includes(nq)) return 2;
      if (normalize(it.keywords).includes(nq)) return 1;
      return 0;
    };
    const matched = [...tabs, ...actions].map((it) => ({ it, s: score(it) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.it);
    const queries = PALETTE_QUERIES.filter((x) => typeof canView !== "function" || canView(x.tab)).map((x) => ({ ...x, kind: "query", label: t(x.label, { q: q.trim() }), q: q.trim() }));
    return [...matched.slice(0, 8), ...queries];
  }

  function paletteRender() {
    const list = el("palette-list");
    const q = el("palette-input").value;
    paletteState.items = paletteResults(q);
    paletteState.active = Math.min(paletteState.active, Math.max(0, paletteState.items.length - 1));
    const icon = { tab: "→", action: "⚡", query: "🔍" };
    list.innerHTML = paletteState.items.length
      ? paletteState.items.map((it, i) => `<li role="option" class="palette-item${i === paletteState.active ? " is-active" : ""}" data-i="${i}" aria-selected="${i === paletteState.active}"><span class="palette-icon">${icon[it.kind]}</span>${esc(it.label)}</li>`).join("")
      : `<li class="palette-empty">${esc(t("찾는 메뉴가 없습니다"))}</li>`;
    list.hidden = false;
    el("palette-input").setAttribute("aria-expanded", "true");
  }

  function paletteClose() {
    el("palette-list").hidden = true;
    el("palette-input").setAttribute("aria-expanded", "false");
  }

  function paletteRun(it) {
    if (!it) return;
    paletteClose();
    el("palette-input").value = "";
    el("palette-input").blur();
    if (it.tab) goToTab(it.tab);
    if (it.kind === "action") it.run();
    if (it.kind === "query") {
      const input = el(it.input);
      if (input) { input.value = it.q; clickWhenReady(it.button); }
    }
    trackUsage(`palette:${it.kind}:${it.tab || ""}`);
  }

  (function initPalette() {
    const input = el("palette-input");
    if (!input) return;
    input.addEventListener("focus", () => { paletteState.active = 0; paletteRender(); });
    input.addEventListener("input", () => { paletteState.active = 0; paletteRender(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); paletteState.active = Math.min(paletteState.active + 1, paletteState.items.length - 1); paletteRender(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); paletteState.active = Math.max(paletteState.active - 1, 0); paletteRender(); }
      else if (e.key === "Enter") { e.preventDefault(); paletteRun(paletteState.items[paletteState.active]); }
      else if (e.key === "Escape") { paletteClose(); input.blur(); }
    });
    // 목록 클릭(포커스가 빠지기 전에 처리되도록 mousedown)
    el("palette-list").addEventListener("mousedown", (e) => {
      const li = e.target.closest(".palette-item");
      if (!li) return;
      e.preventDefault();
      paletteRun(paletteState.items[Number(li.dataset.i)]);
    });
    input.addEventListener("blur", () => setTimeout(paletteClose, 120));
    // Ctrl/⌘+K 또는 "/"(입력 중이 아닐 때)로 검색칸 열기
    document.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) || (document.activeElement && document.activeElement.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); input.focus(); input.select(); }
      else if (e.key === "/" && !typing) { e.preventDefault(); input.focus(); }
    });
  })();
