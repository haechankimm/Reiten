  /* ---------- 알림 발송 실패 아웃박스 ----------
     lib/mailer.js·lib/push.js가 발송 실패 시 남기는 system_error_log(type=
     "notification_failed")를 조회 전용으로 보여준다(2026-09 요청). "해결됨 처리"는 기존
     시스템 오류 팝업이 쓰는 것과 같은 엔드포인트(POST /api/admin/system-errors/:id/resolve)를
     그대로 재사용한다 — 같은 데이터를 다른 화면에서 보여줄 뿐이라 처리 방법도 같아야 한다. */
  const outboxState = { page: 0, pageSize: 30, total: 0, items: [], resolved: false };

  function outboxRowHTML(r) {
    return `
      <div class="panel" data-id="${esc(r.id)}" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <b>${esc(r.kind || "-")}</b>
          <span class="small" style="color:var(--text-muted);margin-left:6px">${esc(r.channel)}</span>
          <div class="small tnum" style="color:var(--text-muted);margin-top:2px">${fmtDate(r.at)}${r.to ? ` · ${esc(r.to)}` : ""}</div>
          ${r.error ? `<div class="small" style="color:var(--danger);margin-top:2px">${esc(r.error)}</div>` : ""}
        </div>
        ${!r.resolved ? `<button type="button" class="btn btn--sm outbox-resolve">${esc(t("해결됨으로 표시"))}</button>` : ""}
      </div>`;
  }

  function renderOutbox() {
    el("outbox-summary").textContent = t("총 {n}건", { n: outboxState.total });
    const hasMore = outboxState.items.length < outboxState.total;
    el("admin-outbox-list").innerHTML = outboxState.items.length
      ? outboxState.items.map(outboxRowHTML).join("") + loadMoreHTML(hasMore, "admin-outbox-more")
      : `<p class="small">${esc(t("표시할 항목이 없습니다"))}</p>`;

    el("admin-outbox-list").querySelectorAll(".outbox-resolve").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        btn.disabled = true;
        const result = await adminFetch(`/api/admin/system-errors/${encodeURIComponent(id)}/resolve`, { method: "POST" });
        btn.disabled = false;
        if (!result) return;
        outboxState.items = outboxState.items.filter((x) => x.id !== id);
        outboxState.total = Math.max(0, outboxState.total - 1);
        toast(t("해결됨으로 표시했습니다"));
        renderOutbox();
      })
    );
    el("admin-outbox-more")?.addEventListener("click", () => paintAdminOutbox(true));
  }

  async function paintAdminOutbox(loadMore = false) {
    outboxState.page = loadMore ? outboxState.page + 1 : 1;
    const params = new URLSearchParams({ page: outboxState.page, pageSize: outboxState.pageSize, resolved: outboxState.resolved });
    const result = await adminFetch(`/api/admin/outbox?${params.toString()}`);
    if (!result) return;
    outboxState.total = result.total;
    outboxState.items = loadMore ? outboxState.items.concat(result.items) : result.items;
    renderOutbox();
  }

  el("outbox-tabs").querySelectorAll(".chip").forEach((b) =>
    b.addEventListener("click", () => {
      el("outbox-tabs").querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x === b));
      outboxState.resolved = b.dataset.resolved === "true";
      paintAdminOutbox();
    })
  );
