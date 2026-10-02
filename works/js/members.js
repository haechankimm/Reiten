  /* ---------- 회원 계정 관리 ----------
     admins.js의 "관리자 계정 관리"와 짝을 이루는 화면이지만 대상은 반대다 — 이쪽은 일반
     고객(role=customer) 계정만 다룬다. 차단·승격·삭제처럼 되돌리기 어렵거나 민감한 동작은
     다른 탭의 삭제류 버튼과 같은 원칙으로 confirm()에 결과를 분명히 적어 한 번 더 확인시킨다. */
  const membersState = { page: 0, pageSize: 20, total: 0, items: [], adminItems: [], q: "" };

  /* 마스터 관리자에게만 서버가 함께 내려주는 관리자 계정 행(2026-09-01) — 페이지네이션
     대상인 일반 회원과 섞이지 않도록 항상 목록 맨 위에 별도로 그린다. 계정 삭제·차단 같은
     동작은 전부 role=customer 대상으로만 만들어져 있어(members.js 서버 쪽 참고) 관리자
     행에는 버튼을 아예 안 붙인다 — 눌러도 서버가 거부할 버튼을 보여주지 않기 위함. */
  function adminMemberRowHTML(m) {
    return `
      <div class="panel member-admin-row member-row--${m.isMaster ? "main" : "op"}" data-id="${esc(m.id)}" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <b>${esc(m.email)}</b>${m.name ? ` <span class="small" style="color:var(--text-muted)">(${esc(m.name)})</span>` : ""}
          <span style="margin-left:6px">${roleBadgeHTML(m.isMaster ? "main" : "operator")}</span>
          <div class="small tnum" style="color:var(--text-muted);margin-top:2px">
            ${esc(t("가입일"))} ${fmtDate(m.createdAt)}${m.phone ? ` · ${esc(m.phone)}` : ""}
          </div>
        </div>
        ${!m.isMaster && isMasterAdmin ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn--sm btn--ghost member-open-staff">${esc(t("권한 설정"))}</button>
          <button type="button" class="btn btn--sm btn--danger member-demote">${esc(t("일반회원으로 강등"))}</button>
        </div>` : ""}
      </div>`;
  }

  function memberRowHTML(m) {
    const lastSignIn = m.lastSignInAt ? fmtDate(m.lastSignInAt) : t("로그인 기록 없음");
    return `
      <div class="panel" data-id="${esc(m.id)}" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <b>${esc(m.email)}</b>${m.name ? ` <span class="small" style="color:var(--text-muted)">(${esc(m.name)})</span>` : ""}
          <span style="margin-left:6px">${roleBadgeHTML("member")}</span>
          ${m.banned ? `<span class="status-chip st-overdue" style="margin-left:6px">${esc(t("차단됨"))}</span>` : ""}
          <div class="small tnum" style="color:var(--text-muted);margin-top:2px">
            ${esc(t("가입일"))} ${fmtDate(m.createdAt)} ·
            ${m.emailConfirmed ? esc(t("이메일 인증됨")) : esc(t("이메일 미인증"))} ·
            ${esc(t("마지막 로그인"))} ${esc(lastSignIn)}${m.phone ? ` · ${esc(m.phone)}` : ""}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn--sm member-view-orders">${esc(t("주문 보기"))}</button>
          ${!m.emailConfirmed ? `<button type="button" class="btn btn--sm member-resend">${esc(t("인증 메일 재발송"))}</button>` : ""}
          ${!m.emailConfirmed ? `<button type="button" class="btn btn--sm btn--ghost member-verify">${esc(t("수동으로 인증 처리"))}</button>` : ""}
          ${isMasterAdmin ? `<button type="button" class="btn btn--sm member-promote">${esc(t("운영자로 승격"))}</button>` : ""}
          <button type="button" class="btn btn--sm member-ban-toggle">${esc(m.banned ? t("차단 해제") : t("차단"))}</button>
          <button type="button" class="btn btn--sm btn--danger member-delete">${esc(t("삭제"))}</button>
        </div>
      </div>`;
  }

  function renderAdminMembers() {
    const admins = membersState.adminItems || [];
    el("members-summary").textContent = admins.length
      ? t("메인 관리자 {m}명 · 운영자 {o}명 · 일반회원 {n}명", { m: admins.filter((a) => a.isMaster).length, o: admins.filter((a) => !a.isMaster).length, n: membersState.total })
      : t("일반회원 {n}명", { n: membersState.total });
    const hasMore = membersState.items.length < membersState.total;
    const adminRows = (membersState.adminItems || []).map(adminMemberRowHTML).join("");
    const customerRows = membersState.items.length
      ? membersState.items.map(memberRowHTML).join("") + loadMoreHTML(hasMore, "admin-members-more")
      : `<p class="small">${esc(t("조건에 맞는 회원이 없습니다"))}</p>`;
    el("admin-members-list").innerHTML = adminRows + customerRows;
    el("admin-members-list").querySelectorAll(".member-open-staff").forEach((btn) =>
      btn.addEventListener("click", () => { goToTab("staff"); paintAdminStaff(); })
    );

    /* 운영자 → 일반회원 강등. 서버는 "정보" 탭의 "권한 해제"와 같은 엔드포인트(routes/admins.js)를
       그대로 쓴다 — 계정·주문 기록은 그대로 두고 role만 customer로 되돌린다. */
    el("admin-members-list").querySelectorAll(".member-demote").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        const item = (membersState.adminItems || []).find((x) => x.id === id);
        if (!item) return;
        if (!confirm(t("{email} 님을 일반회원으로 강등할까요? Works에 더 이상 들어올 수 없게 되며, 계정과 주문 기록은 그대로 남습니다.", { email: item.email }))) return;
        btn.disabled = true;
        const result = await adminFetch(`/api/admin/admins/${encodeURIComponent(id)}`, { method: "DELETE" });
        btn.disabled = false;
        if (!result) return;
        membersState.adminItems = membersState.adminItems.filter((x) => x.id !== id);
        membersState.items = [{ ...item, role: "customer", isMaster: false }, ...membersState.items];
        membersState.total += 1;
        toast(t("일반회원으로 강등했습니다"));
        renderAdminMembers();
      })
    );

    el("admin-members-list").querySelectorAll(".member-view-orders").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-id]").dataset.id;
        const item = membersState.items.find((x) => x.id === id);
        if (!item) return;
        el("ord-q").value = item.email;
        el("ord-search").click();
        document.querySelector('.nav-item[data-tab="orders"]')?.click();
      })
    );

    el("admin-members-list").querySelectorAll(".member-resend").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        btn.disabled = true;
        const result = await adminFetch(`/api/admin/members/${encodeURIComponent(id)}/resend-confirmation`, { method: "POST" });
        btn.disabled = false;
        if (!result) return;
        toast(t("인증 메일을 다시 보냈습니다"));
      })
    );

    el("admin-members-list").querySelectorAll(".member-verify").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        if (!confirm(t("본인 확인 없이 이 계정의 이메일을 인증됨으로 처리할까요? 인증 메일 발송이 계속 안 될 때만 쓰는 예외 처리입니다."))) return;
        btn.disabled = true;
        const result = await adminFetch(`/api/admin/members/${encodeURIComponent(id)}/verify-email`, { method: "PATCH" });
        btn.disabled = false;
        if (!result) return;
        const item = membersState.items.find((x) => x.id === id);
        if (item) item.emailConfirmed = true;
        toast(t("이메일 인증 처리를 완료했습니다"));
        renderAdminMembers();
      })
    );

    el("admin-members-list").querySelectorAll(".member-promote").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        const item = membersState.items.find((x) => x.id === id);
        if (!item) return;
        if (!confirm(t("{email} 님을 운영자로 승격할까요? 메인 관리자가 아닌 운영자로 올라가며, 기본 권한(주문·반품·재고·Q&A·협업 수정)으로 시작합니다. 권한은 \"권한 설정\"에서 바꿀 수 있습니다.", { email: item.email }))) return;
        btn.disabled = true;
        const result = await adminFetch(`/api/admin/members/${encodeURIComponent(id)}/promote`, { method: "PATCH" });
        btn.disabled = false;
        if (!result) return;
        /* 승격된 계정은 일반회원 목록에서 빠지고 위쪽 관리자 행으로 옮겨 그린다 — 예전엔 빼기만
           해서 새로고침 전까지 목록에서 사라진 것처럼 보였다. 승격은 항상 운영자(isMaster=false)다. */
        membersState.items = membersState.items.filter((x) => x.id !== id);
        membersState.total = Math.max(0, membersState.total - 1);
        membersState.adminItems = [...(membersState.adminItems || []), { ...item, role: "admin", isMaster: false }];
        toast(t("운영자로 승격했습니다"));
        renderAdminMembers();
      })
    );

    el("admin-members-list").querySelectorAll(".member-ban-toggle").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        const item = membersState.items.find((x) => x.id === id);
        if (!item) return;
        const nextBanned = !item.banned;
        if (nextBanned && !confirm(t("이 계정을 사이트에서 차단할까요? 로그인이 바로 끊기고, 이 이메일로는 회원·비회원 주문과 문의 작성이 모두 막힙니다. (이미 한 주문의 반품 신청은 가능)"))) return;
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
    membersState.adminItems = result.adminItems || []; // 마스터 관리자에게만 옴(server 참고), 매번 전체 목록이라 그대로 덮어씀
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

  el("mb-export").addEventListener("click", () => {
    trackUsage("feature:export:mb-export");
    const params = new URLSearchParams();
    if (membersState.q) params.set("q", membersState.q);
    downloadExportFile(`/api/admin/members/export?${params.toString()}`, "reiten-members", "csv");
  });
