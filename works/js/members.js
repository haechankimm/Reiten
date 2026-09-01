  /* ---------- 회원 계정 관리 ----------
     admins.js의 "관리자 계정 관리"와 짝을 이루는 화면이지만 대상은 반대다 — 이쪽은 일반
     고객(role=customer) 계정만 다룬다. 차단·삭제처럼 되돌리기 어렵거나 민감한 동작은 다른
     탭의 삭제류 버튼과 같은 원칙으로 confirm()에 결과를 분명히 적어 한 번 더 확인시킨다. */
  const membersState = { page: 0, pageSize: 20, total: 0, items: [], q: "" };

  function memberRowHTML(m) {
    const lastSignIn = m.lastSignInAt ? fmtDate(m.lastSignInAt) : t("로그인 기록 없음");
    return `
      <div class="panel" data-id="${esc(m.id)}" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <b>${esc(m.email)}</b>${m.name ? ` <span class="small" style="color:var(--text-muted)">(${esc(m.name)})</span>` : ""}
          ${m.banned ? `<span class="status-chip st-overdue" style="margin-left:6px">${esc(t("차단됨"))}</span>` : ""}
          <div class="small tnum" style="color:var(--text-muted);margin-top:2px">
            ${esc(t("가입일"))} ${fmtDate(m.createdAt)} ·
            ${m.emailConfirmed ? esc(t("이메일 인증됨")) : esc(t("이메일 미인증"))} ·
            ${esc(t("마지막 로그인"))} ${esc(lastSignIn)}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn--sm member-ban-toggle">${esc(m.banned ? t("차단 해제") : t("차단"))}</button>
          <button type="button" class="btn btn--sm btn--danger member-delete">${esc(t("삭제"))}</button>
        </div>
      </div>`;
  }

  function renderAdminMembers() {
    el("members-summary").textContent = t("총 {n}명", { n: membersState.total });
    const hasMore = membersState.items.length < membersState.total;
    el("admin-members-list").innerHTML = membersState.items.length
      ? membersState.items.map(memberRowHTML).join("") + loadMoreHTML(hasMore, "admin-members-more")
      : `<p class="small">${esc(t("조건에 맞는 회원이 없습니다"))}</p>`;

    el("admin-members-list").querySelectorAll(".member-ban-toggle").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        const item = membersState.items.find((x) => x.id === id);
        if (!item) return;
        const nextBanned = !item.banned;
        if (nextBanned && !confirm(t("이 계정을 차단할까요? 차단하면 이 이메일로 로그인할 수 없게 됩니다."))) return;
        btn.disabled = true;
        const result = await adminFetch(`/api/admin/members/${encodeURIComponent(id)}/ban`, {
          method: "PATCH",
          body: JSON.stringify({ banned: nextBanned }),
        });
        btn.disabled = false;
        if (!result) return;
        item.banned = nextBanned;
        toast(nextBanned ? t("계정을 차단했습니다") : t("차단을 해제했습니다"));
        renderAdminMembers();
      })
    );

    el("admin-members-list").querySelectorAll(".member-delete").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        if (!confirm(t("이 회원 계정을 삭제하시겠습니까? 되돌릴 수 없습니다. 과거 주문·문의 기록은 회원 정보 없이 그대로 남습니다."))) return;
        btn.disabled = true;
        const result = await adminFetch(`/api/admin/members/${encodeURIComponent(id)}`, { method: "DELETE" });
        btn.disabled = false;
        if (!result) return;
        membersState.items = membersState.items.filter((x) => x.id !== id);
        membersState.total = Math.max(0, membersState.total - 1);
        toast(t("회원 계정을 삭제했습니다"));
        renderAdminMembers();
      })
    );

    el("admin-members-more")?.addEventListener("click", () => paintAdminMembers(true));
  }

  async function paintAdminMembers(loadMore = false) {
    membersState.page = loadMore ? membersState.page + 1 : 1;
    const params = new URLSearchParams({ page: membersState.page, pageSize: membersState.pageSize });
    if (membersState.q) params.set("q", membersState.q);
    const result = await adminFetch(`/api/admin/members?${params.toString()}`);
    if (!result) return;
    membersState.total = result.total;
    membersState.items = loadMore ? membersState.items.concat(result.items) : result.items;
    renderAdminMembers();
  }

  el("mb-search").addEventListener("click", () => {
    membersState.q = el("mb-q").value.trim();
    paintAdminMembers();
  });
  el("mb-q").addEventListener("keydown", (e) => { if (e.key === "Enter") el("mb-search").click(); });
  el("mb-reset").addEventListener("click", () => {
    el("mb-q").value = "";
    membersState.q = "";
    paintAdminMembers();
  });
