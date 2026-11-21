  /* ---------- 단체 주문 문의 (2026-11-21, 마이그레이션 056) ----------
     고객 사이트 group-order.html로 들어온 라이딩 크루·동호회 단체복 문의. 견적·결제는 사람이 전화·메일로 하고,
     여기서는 상태(접수→상담중→견적발송→확정/종료)·담당자·메모만 관리한다. 서버: server/routes/groupInquiries.js(권한 영역 "groups"). */
  const groupsState = { page: 0, pageSize: 30, total: 0, items: [] };
  const GROUP_STATUS_CLASS = { "접수": "st-pending", "상담중": "st-confirmed", "견적발송": "st-shipping", "확정": "st-done", "종료": "st-neutral" };
  const GROUP_STATUSES = ["접수", "상담중", "견적발송", "확정", "종료"];

  function groupRowHTML(g) {
    const edit = canEdit("groups");
    const lines = [
      [t("담당자 이름"), g.contactName],
      [t("연락처"), g.tel],
      [t("이메일"), g.email],
      [t("희망 수령일"), g.desiredDate || ""],
      [t("원하는 상품·컬러"), g.products],
      [t("로고·문구 인쇄 요청"), g.customization],
      [t("그 밖에 문의"), g.message],
    ].filter(([, v]) => v);
    return `
      <details class="panel" data-id="${esc(g.id)}" data-compact style="padding:12px 14px">
        <summary style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;cursor:pointer">
          <span class="status-chip ${GROUP_STATUS_CLASS[g.status] || "st-neutral"}">${esc(t(g.status))}</span>
          <b>${esc(g.teamName)}</b>
          <span class="m-label">${esc(t("{n}벌", { n: g.quantity }))}</span>
          <span class="small tnum" style="margin-left:auto;color:var(--text-muted)">${esc(fmtDate(g.createdAt))}</span>
        </summary>
        <div style="display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:4px 14px;margin-top:10px" class="small">
          ${lines.map(([k, v]) => `<span class="m-label">${esc(k)}</span><span style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(v)}</span>`).join("")}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px 14px;margin-top:12px;align-items:end">
          <div class="field" style="margin:0">
            <label>${esc(t("상태"))}</label>
            <select class="mini-select group-status" ${edit ? "" : "disabled"}>${GROUP_STATUSES.map((s) => `<option value="${esc(s)}" ${s === g.status ? "selected" : ""}>${esc(t(s))}</option>`).join("")}</select>
          </div>
          <div class="field" style="margin:0">
            <label>${esc(t("담당자"))}</label>
            <select class="mini-select group-assignee" ${edit ? "" : "disabled"}>${adminAssigneeOptionsHTML(g.assignedTo)}</select>
          </div>
        </div>
        <div class="field" style="margin:10px 0 0">
          <label>${esc(t("내부 메모 (고객에게 안 보임)"))}</label>
          <textarea class="group-memo" rows="2" maxlength="2000" ${edit ? "" : "disabled"}>${esc(g.adminMemo)}</textarea>
        </div>
        ${edit ? `<div style="display:flex;gap:8px;margin-top:10px">
          <button type="button" class="btn btn--sm group-save">${esc(t("저장"))}</button>
          <a class="btn btn--sm btn--ghost" href="mailto:${esc(g.email)}">${esc(t("메일 쓰기"))}</a>
        </div>` : ""}
      </details>`;
  }

  function renderGroups() {
    el("groups-summary").textContent = t("총 {n}건", { n: groupsState.total });
    const hasMore = groupsState.items.length < groupsState.total;
    el("admin-groups-list").innerHTML = groupsState.items.length
      ? groupsState.items.map(groupRowHTML).join("") + loadMoreHTML(hasMore, "admin-groups-more")
      : `<p class="small">${esc(t("단체 주문 문의가 없습니다"))}</p>`;
    el("admin-groups-more")?.addEventListener("click", () => paintAdminGroups(true));
  }

  async function paintAdminGroups(loadMore = false) {
    groupsState.page = loadMore ? groupsState.page + 1 : 1;
    const status = el("groups-status").value;
    const result = await adminFetch(`/api/admin/group-inquiries?page=${groupsState.page}&pageSize=${groupsState.pageSize}&status=${encodeURIComponent(status)}`);
    if (!result) return;
    if (result.migrationMissing) {
      el("groups-summary").textContent = "";
      el("admin-groups-list").innerHTML = `<p class="small">${esc(t("DB 마이그레이션 056을 먼저 실행해 주세요."))}</p>`;
      return;
    }
    groupsState.total = result.total;
    groupsState.items = loadMore ? groupsState.items.concat(result.items) : result.items;
    renderGroups();
  }

  el("groups-status").addEventListener("change", () => paintAdminGroups());
  el("admin-groups-list").addEventListener("click", async (e) => {
    const btn = e.target.closest(".group-save");
    if (!btn) return;
    const card = btn.closest("[data-id]");
    btn.disabled = true;
    try {
      const r = await adminFetch(`/api/admin/group-inquiries/${encodeURIComponent(card.dataset.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: card.querySelector(".group-status").value,
          assignedTo: card.querySelector(".group-assignee").value || null,
          adminMemo: card.querySelector(".group-memo").value,
        }),
      });
      if (!r) return;
      const i = groupsState.items.findIndex((x) => x.id === r.id);
      if (i >= 0) groupsState.items[i] = r;
      toast(t("저장했습니다"));
      const chip = card.querySelector(".status-chip");
      chip.className = `status-chip ${GROUP_STATUS_CLASS[r.status] || "st-neutral"}`;
      chip.textContent = t(r.status);
    } finally {
      btn.disabled = false;
    }
  });
