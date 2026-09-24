  /* ---------- 직원·권한 탭 (마스터 관리자 전용) ----------
     서버의 /api/admin/staff* 는 마스터가 아니면 403이라, 이 탭을 숨기는 것은 편의일 뿐 방어선이 아니다.
     영역별 레벨: none(접근 불가) / view(보기만) / edit(보기+수정). 새 직원은 초대·승격 시 기본 권한
     (주문·반품·재고·문의·협업)으로 시작하고 여기서 조정한다. */
  const PERM_LEVEL_LABEL = { none: "접근 불가", view: "보기만", edit: "보기+수정" };

  function staffCardHTML(s, areas) {
    const badges = [
      s.pinSet ? `<span class="small" style="color:var(--text-muted)">${esc(t("PIN 설정됨"))}</span>` : `<span class="small" style="color:var(--danger)">${esc(t("PIN 미설정(다음 로그인 때 직접 설정)"))}</span>`,
      s.pinLocked ? `<span class="small" style="color:var(--danger)">${esc(t("PIN 잠김"))}</span>` : "",
      s.customized ? "" : `<span class="small" style="color:var(--danger)">${esc(t("권한 미설정 — 현재 전체 허용 상태"))}</span>`,
    ].filter(Boolean).join(" · ");

    const rows = areas.map((a) => `
      <label class="perm-row">
        <span>${esc(t(a.label))}</span>
        <select data-area="${esc(a.key)}">
          ${["none", "view", "edit"].map((lv) => `<option value="${lv}" ${s.permissions[a.key] === lv ? "selected" : ""}>${esc(t(PERM_LEVEL_LABEL[lv]))}</option>`).join("")}
        </select>
      </label>`).join("");

    return `
      <div class="panel" data-id="${esc(s.id)}">
        <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;justify-content:space-between">
          <div style="min-width:0">
            <b>${esc(s.name || s.email)}</b>
            <div class="small tnum" style="color:var(--text-muted)">${esc(s.email)}</div>
            <div style="margin-top:4px">${badges}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="btn btn--sm staff-save">${esc(t("권한 저장"))}</button>
            <button type="button" class="btn btn--sm btn--ghost staff-pin-set">${esc(t("PIN 지정"))}</button>
            <button type="button" class="btn btn--sm btn--ghost staff-pin-reset">${esc(t("PIN 초기화"))}</button>
            <button type="button" class="btn btn--sm btn--ghost staff-password">${esc(t("비밀번호 변경"))}</button>
          </div>
        </div>
        <div class="perm-grid">${rows}</div>
      </div>`;
  }

  async function paintAdminStaff() {
    if (!adminMe || !adminMe.isMaster) return;
    const result = await adminFetch("/api/admin/staff");
    if (!result) return;
    el("staff-migration-note").hidden = !result.migrationMissing;
    el("staff-list").innerHTML = result.items.length
      ? result.items.map((s) => staffCardHTML(s, result.areas)).join("")
      : `<p class="small" style="color:var(--text-muted)">${esc(t("등록된 직원이 없습니다. '정보' 탭에서 이메일로 초대하면 여기에 나타납니다."))}</p>`;

    el("staff-list").querySelectorAll("[data-id]").forEach((card) => {
      const id = card.dataset.id;
      const staff = result.items.find((x) => x.id === id);
      const label = staff.name || staff.email;

      card.querySelector(".staff-save").addEventListener("click", async () => {
        const permissions = {};
        card.querySelectorAll("select[data-area]").forEach((sel) => { permissions[sel.dataset.area] = sel.value; });
        const r = await adminFetch(`/api/admin/staff/${encodeURIComponent(id)}/permissions`, { method: "PUT", body: JSON.stringify({ permissions }) });
        if (!r) return;
        toast(t("권한을 저장했습니다"));
        paintAdminStaff();
      });

      card.querySelector(".staff-pin-set").addEventListener("click", () =>
        askDialog({
          title: t("{name} PIN 지정", { name: label }),
          desc: t("직원에게 알려줄 숫자 6자리 PIN입니다. 직원은 로그인 후 '내 PIN 변경'으로 스스로 바꿀 수 있습니다."),
          fields: [{ id: "pin", label: t("PIN (숫자 6자리)"), type: "password", numeric: true, maxlength: 6 }],
          submitLabel: t("지정"),
          onSubmit: async ({ pin }) => {
            if (!/^\d{6}$/.test(pin)) return t("PIN은 숫자 6자리여야 합니다.");
            const r = await adminFetch(`/api/admin/staff/${encodeURIComponent(id)}/pin`, { method: "POST", body: JSON.stringify({ pin }) });
            return r ? "" : t("PIN 지정에 실패했습니다.");
          },
        }).then((done) => { if (done) { toast(t("PIN을 지정했습니다")); paintAdminStaff(); } })
      );

      card.querySelector(".staff-pin-reset").addEventListener("click", async () => {
        if (!confirm(t("{name}의 PIN을 초기화할까요? 다음 로그인 때 직원이 새 PIN을 직접 설정합니다.", { name: label }))) return;
        const r = await adminFetch(`/api/admin/staff/${encodeURIComponent(id)}/pin`, { method: "POST", body: JSON.stringify({ reset: true }) });
        if (!r) return;
        toast(t("PIN을 초기화했습니다"));
        paintAdminStaff();
      });

      card.querySelector(".staff-password").addEventListener("click", () =>
        askDialog({
          title: t("{name} 비밀번호 변경", { name: label }),
          desc: t("새 비밀번호를 입력하면 즉시 바뀝니다. 직원에게 직접 안전하게 전달해 주세요."),
          fields: [{ id: "pw", label: t("새 비밀번호 (8자 이상)"), type: "password" }],
          submitLabel: t("변경"),
          onSubmit: async ({ pw }) => {
            if (pw.length < 8) return t("비밀번호는 8자 이상이어야 합니다.");
            const r = await adminFetch(`/api/admin/staff/${encodeURIComponent(id)}/password`, { method: "POST", body: JSON.stringify({ password: pw }) });
            return r ? "" : t("비밀번호 변경에 실패했습니다.");
          },
        }).then((done) => { if (done) toast(t("비밀번호를 변경했습니다")); })
      );
    });
  }

  document.querySelector('#sidebar .nav-item[data-tab="staff"]')?.addEventListener("click", paintAdminStaff);
