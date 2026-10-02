  /* ---------- PIN(2단계 인증) · 내 권한 · 공용 입력 대화상자 ----------
     서버(/api/admin 관문, server/lib/adminGuard.js)가 로그인 후 두 번째로 PIN을 요구하고, 직원마다
     영역별 권한(없음/보기/편집)을 적용한다. 이 파일은 ① 모든 /api/admin 요청에 PIN 토큰 헤더를
     자동으로 붙이고 ② 로그인 직후 PIN 설정/입력 창을 띄우고 ③ 내 권한을 기억해 화면(탭)을 걸러낸다.
     화면에서 숨기는 것은 편의일 뿐 실제 차단은 항상 서버가 한다. */
  const PIN_STORAGE_KEY = "works_pin_token";
  let adminMe = null;

  (function installPinHeader() {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      try {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        if (url.startsWith("/api/admin/") && !url.startsWith("/api/admin/login-lock")) {
          const token = sessionStorage.getItem(PIN_STORAGE_KEY);
          if (token) init = { ...(init || {}), headers: { ...((init && init.headers) || {}), "X-Admin-Pin": token } };
        }
      } catch (e) {}
      return originalFetch(input, init);
    };
  })();

  function setPinToken(token) {
    try { sessionStorage.setItem(PIN_STORAGE_KEY, token); } catch (e) {}
  }
  function clearPinToken() {
    try { sessionStorage.removeItem(PIN_STORAGE_KEY); } catch (e) {}
  }

  /* 권한: 탭 → 영역 → 레벨. home은 항상, staff는 마스터만. */
  function permLevelForTab(tab) {
    if (!adminMe) return "none";
    if (tab === "systemErrors") tab = "paymentlog"; // 알림센터의 시스템 오류 행은 결제 영역 권한을 따른다
    if (tab === "home") return "edit";
    if (tab === "staff") return adminMe.isMaster ? "edit" : "none";
    const area = adminMe.tabAreas && adminMe.tabAreas[tab];
    return area ? adminMe.permissions[area] || "none" : "none";
  }
  function canView(tab) { return permLevelForTab(tab) !== "none"; }
  function canEdit(tab) { return permLevelForTab(tab) === "edit"; }

  /* 범용 입력 대화상자. fields: [{id,label,type,numeric,maxlength}], onSubmit(values) → 에러 문자열이면 표시하고
     유지, 성공하면 falsy 반환. dismissible=false면 취소 불가(필수 PIN 입력). 닫히면 resolve(true/false). */
  function askDialog({ title, desc, fields, submitLabel, dismissible = true, onSubmit }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "dlg-overlay";
      overlay.innerHTML = `
        <form class="dlg-card" novalidate>
          <h3>${esc(title)}</h3>
          ${desc ? `<p class="small" style="color:var(--text-muted)">${esc(desc)}</p>` : ""}
          ${fields.map((f) => `
            <div class="field">
              <label for="dlg-${esc(f.id)}">${esc(f.label)}</label>
              <input id="dlg-${esc(f.id)}" type="${f.type || "password"}" autocomplete="off"
                ${f.numeric ? 'inputmode="numeric" pattern="[0-9]*" class="pin-input"' : ""} ${f.maxlength ? `maxlength="${f.maxlength}"` : ""}>
            </div>`).join("")}
          <p class="err" id="dlg-err"></p>
          <div class="dlg-actions">
            ${dismissible ? `<button type="button" class="btn btn--ghost" id="dlg-cancel">${esc(t("취소"))}</button>` : ""}
            <button type="submit" class="btn" id="dlg-submit">${esc(submitLabel || t("확인"))}</button>
          </div>
        </form>`;
      document.body.appendChild(overlay);
      const form = overlay.querySelector("form");
      const errEl = overlay.querySelector("#dlg-err");
      const close = (result) => { overlay.remove(); resolve(result); };
      overlay.querySelector("input")?.focus();
      overlay.querySelector("#dlg-cancel")?.addEventListener("click", () => close(false));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const values = {};
        fields.forEach((f) => { values[f.id] = overlay.querySelector(`#dlg-${f.id}`).value; });
        const btn = overlay.querySelector("#dlg-submit");
        btn.disabled = true;
        const message = await onSubmit(values);
        btn.disabled = false;
        if (message) {
          errEl.textContent = message;
          errEl.classList.add("on");
          return;
        }
        close(true);
      });
    });
  }

  async function pinRequest(path, body) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(body),
    });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    return { ok: res.ok, data };
  }

  const PIN_FIELD = { type: "password", numeric: true, maxlength: 6 };
  function checkNewPin(p1, p2) {
    if (!/^\d{6}$/.test(p1)) return t("PIN은 숫자 6자리여야 합니다.");
    if (p1 !== p2) return t("PIN이 서로 일치하지 않습니다.");
    return "";
  }

  async function runPinSetup() {
    return askDialog({
      title: t("PIN 설정"),
      desc: t("로그인 후 한 번 더 확인하는 숫자 6자리 PIN을 정해 주세요. 잊으면 마스터 관리자가 초기화할 수 있습니다."),
      dismissible: false,
      fields: [{ id: "pin1", label: t("새 PIN (숫자 6자리)"), ...PIN_FIELD }, { id: "pin2", label: t("PIN 확인"), ...PIN_FIELD }],
      submitLabel: t("설정"),
      onSubmit: async ({ pin1, pin2 }) => {
        const bad = checkNewPin(pin1, pin2);
        if (bad) return bad;
        const r = await pinRequest("/api/admin/pin/setup", { pin: pin1 });
        if (!r.ok) return r.data.error || t("PIN 설정에 실패했습니다.");
        setPinToken(r.data.token);
        return "";
      },
    });
  }

  async function runPinVerify() {
    return askDialog({
      title: t("PIN 입력"),
      desc: t("보안을 위해 PIN 6자리를 입력해 주세요."),
      dismissible: false,
      fields: [{ id: "pin", label: "PIN", ...PIN_FIELD }],
      submitLabel: t("확인"),
      onSubmit: async ({ pin }) => {
        const r = await pinRequest("/api/admin/pin/verify", { pin });
        if (!r.ok) return r.data.error || t("PIN 확인에 실패했습니다.");
        setPinToken(r.data.token);
        return "";
      },
    });
  }

  async function changeMyPin() {
    return askDialog({
      title: t("내 PIN 변경"),
      fields: [
        { id: "cur", label: t("현재 PIN"), ...PIN_FIELD },
        { id: "pin1", label: t("새 PIN (숫자 6자리)"), ...PIN_FIELD },
        { id: "pin2", label: t("새 PIN 확인"), ...PIN_FIELD },
      ],
      submitLabel: t("변경"),
      onSubmit: async ({ cur, pin1, pin2 }) => {
        const bad = checkNewPin(pin1, pin2);
        if (bad) return bad;
        const r = await pinRequest("/api/admin/pin/change", { currentPin: cur, newPin: pin1 });
        if (!r.ok) return r.data.error || t("PIN 변경에 실패했습니다.");
        setPinToken(r.data.token);
        toast(t("PIN을 변경했습니다"));
        return "";
      },
    });
  }

  /* 로그인 직후 호출: 내 상태를 읽고 필요하면 PIN 설정/입력을 거친 뒤 최종 상태를 돌려준다(관리자가
     아니면 null). PIN 기능용 마이그레이션이 없으면 서버가 pin.enabled=false로 알려줘 그냥 통과한다. */
  async function loadAdminAccess() {
    const token = await getAccessToken();
    if (!token) return null;
    const fetchMe = async () => {
      const res = await fetch("/api/admin/me", { headers: { Authorization: "Bearer " + token } });
      return res.ok ? res.json() : null;
    };
    let me = await fetchMe();
    if (!me) return null;
    if (me.pin.enabled && !me.pin.verified) {
      const done = me.pin.set ? await runPinVerify() : await runPinSetup();
      if (!done) return null;
      me = await fetchMe();
      if (!me) return null;
    }
    adminMe = me;
    return me;
  }

  el("change-pin")?.addEventListener("click", changeMyPin);

  /* ---------- "보기만" 권한 화면 처리 ----------
     권한이 view인 탭에서는 수정·삭제 버튼과 입력 폼을 숨기거나 잠그고, 맨 위에 "보기 전용" 안내를 띄운다.
     목록·검색·필터·내보내기는 그대로 쓸 수 있다. 화면 처리는 편의일 뿐 실제 차단은 서버(adminGuard)가 한다.
     hide: 숨길 요소, hidePanel: 그 요소가 들어 있는 패널째 숨김, disable: 보이되 잠금(값 확인용). */
  const READONLY_RULES = [
    { tab: "orders", panel: "admin-orders", hide: ["#ord-bulk-toggle", "#ord-bulk-input", "#ord-bulk-submit", "#od-save"], disable: ["#od-status", "#od-courier", "#od-tracking", "#od-assignee", "#od-internal-note", "#od-cancel-reason"] },
    { tab: "returns", panel: "admin-returns", hide: [".admin-return-save", ".admin-return-restock"], disable: [".admin-return-status", ".admin-return-assignee", ".admin-return-note"] },
    { tab: "inventory", panel: "admin-inventory", hide: ["#inv-save-btn", ".inv-bulk-qty-apply", ".inv-bulk-qty-input"], disable: [".admin-inv-qty"] },
    { tab: "qna", panel: "admin-qna", hide: [".admin-qna-submit", ".admin-qna-save-meta", ".admin-qna-template-pick"], disable: [".admin-qna-answer", ".admin-qna-note", ".admin-qna-assignee"] },
    { tab: "paymentlog", panel: null, hide: [".notif-error-resolve"] },
    { tab: "reviews", panel: "admin-reviews", hide: ["#reviews-bulk-approve", "#reviews-bulk-hide", "#reviews-select-all", ".review-select", ".admin-review-delete", ".admin-review-toggle"] },
    { tab: "coupons", panel: "admin-coupons", hidePanel: ["#coupon-form"], hide: [".cp-delete", ".cp-edit", ".cp-toggle"] },
    { tab: "products", panel: "admin-products", hidePanel: ["#product-form", "#products-bulk-bar"], hide: [".admin-product-delete", ".admin-product-edit", ".grid-card-select"] },
    { tab: "lookbook", panel: "admin-lookbook", hidePanel: ["#lookbook-form"], hide: [".look-tile-add"], disable: [".look-tile"] },
    { tab: "members", panel: "admin-members", hide: [".member-ban-toggle", ".member-delete", ".member-promote", ".member-resend", ".member-verify"] },
    { tab: "calendar", panel: "admin-calendar", hide: ["#cal-new", "#cal-add-for-day", "#cal-f-save", "#cal-f-delete"], disable: ["#cal-f-title", "#cal-f-date", "#cal-f-memo"] },
    { tab: "calendar", panel: "admin-home", hide: ["#handoff-submit", ".handoff-delete"], disable: ["#handoff-input"] },
    { tab: "notices", panel: "admin-notices", hidePanel: ["#notice-form"], hide: [".notice-delete", ".notice-edit"] },
    { tab: "outbox", panel: "admin-outbox", hide: [".outbox-resolve"] },
    { tab: "settings", panel: "admin-settings", hidePanel: ["#settings-form", "#qna-template-form"], hide: [".admin-setting-edit", ".qt-delete"] },
  ];

  function applyReadOnly() {
    if (!adminMe || adminMe.isMaster) return;
    const hideSel = [];
    const disableSel = [];
    for (const r of READONLY_RULES) {
      if (!canView(r.tab) || canEdit(r.tab)) continue;
      const scope = r.panel ? `#${r.panel} ` : "";
      const panel = r.panel && el(r.panel);
      if (panel && r.panel !== "admin-home" && !panel.querySelector(".ro-banner")) {
        panel.classList.add("is-readonly");
        const banner = `<p class="ro-banner">${esc(t("보기 전용 — 이 화면은 조회만 할 수 있습니다. 수정이 필요하면 마스터 관리자에게 권한을 요청하세요."))}</p>`;
        const head = panel.querySelector(".content-head");
        if (head) head.insertAdjacentHTML("afterend", banner);
        else panel.insertAdjacentHTML("afterbegin", banner);
      }
      (r.hidePanel || []).forEach((s) => {
        const target = document.querySelector(scope + s);
        const box = target && (target.closest(".panel") || target);
        if (box) box.hidden = true;
      });
      (r.hide || []).forEach((s) => hideSel.push(scope + s));
      (r.disable || []).forEach((s) => disableSel.push(scope + s));
    }
    if (!hideSel.length && !disableSel.length) return;
    const style = document.createElement("style");
    style.textContent =
      (hideSel.length ? `${hideSel.join(",")}{display:none!important}` : "") +
      (disableSel.length ? `${disableSel.join(",")}{pointer-events:none!important;opacity:.6}` : "");
    document.head.appendChild(style);
    // 목록은 나중에 다시 그려지므로, 새로 생긴 입력칸도 계속 잠근다
    if (disableSel.length) {
      const lock = () => document.querySelectorAll(disableSel.join(",")).forEach((e) => { if (!e.disabled) e.disabled = true; });
      lock();
      new MutationObserver(lock).observe(document.body, { childList: true, subtree: true });
    }
  }


  /* ---------- 등급 배지: 메인 관리자 / 운영자 / 일반회원 ---------- */
  const ROLE_META = {
    main: { label: "메인 관리자", cls: "role-main", icon: "★ " },
    operator: { label: "운영자", cls: "role-op", icon: "" },
    member: { label: "일반회원", cls: "role-member", icon: "" },
  };
  function roleBadgeHTML(kind) {
    const m = ROLE_META[kind] || ROLE_META.member;
    return `<span class="role-badge ${m.cls}">${m.icon}${esc(t(m.label))}</span>`;
  }

  /* 사이드바 맨 위 "내 등급" 카드 + 상단 이름 옆 등급 표시 */
  function paintMyRole(profile) {
    const kind = adminMe && adminMe.isMaster ? "main" : "operator";
    const name = (profile && (profile.name || profile.email)) || "";
    const box = el("sidebar-me");
    if (box) {
      box.innerHTML = `<div class="sidebar-me-name">${esc(name)}</div>${roleBadgeHTML(kind)}`;
      box.classList.toggle("sidebar-me--main", kind === "main");
      box.hidden = false;
    }
    const roleText = el("admin-role-text");
    if (roleText) roleText.textContent = " · " + t(ROLE_META[kind].label);
  }
