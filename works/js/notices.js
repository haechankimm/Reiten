  /* ---------- 공지·게시판 ----------
     관리자가 여러 명이 되면서(2026-09-01 마스터 관리자 도입) "정보" 탭의 단순 메모만으로는
     "누가 언제 무슨 공지를 남겼는지"가 안 남았다 — 작성자·날짜가 남는 간단한 게시판(2026-09
     요청). 수정·삭제는 본인 글이거나 마스터 관리자만(서버가 최종 검증, 여기선 버튼 노출만
     그 기준으로 맞춤). */
  let ntEditingId = null;
  const noticesState = { page: 0, pageSize: 20, total: 0, items: [] };

  function resetNoticeForm() {
    ntEditingId = null;
    el("notice-form-title").textContent = t("새 공지 작성");
    el("nt-title").value = "";
    el("nt-body").value = "";
    el("nt-cancel").hidden = true;
  }

  function noticeRowHTML(n) {
    const canEdit = n.authorEmail === currentAdminEmail || isMasterAdmin;
    return `
      <div class="panel" data-id="${esc(n.id)}">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap">
          <b>${esc(n.title)}</b>
          <span class="small tnum" style="color:var(--text-muted)">${esc(n.authorEmail)} · ${fmtDate(n.createdAt)}</span>
        </div>
        <p style="margin-top:8px;white-space:pre-wrap">${esc(n.body)}</p>
        ${canEdit ? `
          <div style="display:flex;gap:8px;margin-top:10px">
            <button type="button" class="btn btn--sm notice-edit">${esc(t("수정"))}</button>
            <button type="button" class="btn btn--sm btn--danger notice-delete">${esc(t("삭제"))}</button>
          </div>` : ""}
      </div>`;
  }

  function renderNotices() {
    el("notices-summary").textContent = t("총 {n}건", { n: noticesState.total });
    const hasMore = noticesState.items.length < noticesState.total;
    el("admin-notices-list").innerHTML = noticesState.items.length
      ? noticesState.items.map(noticeRowHTML).join("") + loadMoreHTML(hasMore, "admin-notices-more")
      : `<p class="small">${esc(t("등록된 공지가 없습니다"))}</p>`;

    el("admin-notices-list").querySelectorAll(".notice-edit").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-id]").dataset.id;
        const item = noticesState.items.find((x) => x.id === id);
        if (!item) return;
        ntEditingId = id;
        el("notice-form-title").textContent = t("공지 수정");
        el("nt-title").value = item.title;
        el("nt-body").value = item.body;
        el("nt-cancel").hidden = false;
        el("notice-form").scrollIntoView({ behavior: "smooth", block: "start" });
      })
    );
    el("admin-notices-list").querySelectorAll(".notice-delete").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        if (!confirm(t("이 공지를 삭제하시겠습니까? 되돌릴 수 없습니다."))) return;
        const result = await adminFetch(`/api/admin/notices/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!result) return;
        noticesState.items = noticesState.items.filter((x) => x.id !== id);
        noticesState.total = Math.max(0, noticesState.total - 1);
        toast(t("삭제했습니다"));
        renderNotices();
      })
    );
    el("admin-notices-more")?.addEventListener("click", () => paintAdminNotices(true));
  }

  async function paintAdminNotices(loadMore = false) {
    noticesState.page = loadMore ? noticesState.page + 1 : 1;
    const result = await adminFetch(`/api/admin/notices?page=${noticesState.page}&pageSize=${noticesState.pageSize}`);
    if (!result) return;
    noticesState.total = result.total;
    noticesState.items = loadMore ? noticesState.items.concat(result.items) : result.items;
    renderNotices();
  }

  el("notice-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = el("nt-title").value.trim();
    const body = el("nt-body").value.trim();
    if (!title || !body) { toast(t("제목과 내용을 모두 입력해 주세요.")); return; }

    const btn = el("nt-submit");
    btn.disabled = true;
    try {
      const result = ntEditingId
        ? await adminFetch(`/api/admin/notices/${encodeURIComponent(ntEditingId)}`, { method: "PATCH", body: JSON.stringify({ title, body }) })
        : await adminFetch("/api/admin/notices", { method: "POST", body: JSON.stringify({ title, body }) });
      if (!result) return;
      toast(t("저장했습니다"));
      resetNoticeForm();
      paintAdminNotices();
    } finally {
      btn.disabled = false;
    }
  });
  el("nt-cancel").addEventListener("click", () => resetNoticeForm());
  resetNoticeForm();
