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
