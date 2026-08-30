  const qnaState = { page: 0, pageSize: 20, total: 0, items: [], q: "", status: "", dateFrom: "", dateTo: "" };
  let qnaTemplates = [];

  function qnaCardHTML(q) {
    return `
      <div class="panel" data-id="${esc(q.id)}">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline">
          <b>${esc(q.name)}</b>
          <span class="small tnum">${fmtDate(q.at)}</span>
        </div>
        <div class="small" style="margin-top:6px">${esc(q.productId)} ${q.secret ? "· 🔒 " + esc(t("비밀글")) : ""}</div>
        <p style="margin-top:10px">${esc(q.question)}</p>
        ${
          q.status === "답변완료"
            ? `<div class="notice" style="margin-top:12px"><b>${esc(t("답변"))}</b><p style="margin-top:6px">${esc(q.answer)}</p></div>`
            : `
          ${qnaTemplates.length ? `
          <select class="mini-select admin-qna-template-pick" style="margin-top:12px">
            <option value="">${esc(t("빠른 답변 템플릿 선택..."))}</option>
            ${qnaTemplates.map((tpl) => `<option value="${esc(tpl.id)}">${esc(tpl.label)}</option>`).join("")}
          </select>` : ""}
          <div class="field" style="margin-top:8px">
            <textarea class="admin-qna-answer" placeholder="${esc(t("답변을 입력하세요"))}"></textarea>
          </div>
          <button type="button" class="btn btn--sm admin-qna-submit">${esc(t("답변 등록"))}</button>`
        }
      </div>`;
  }

  function renderAdminQna() {
    el("qna-summary").textContent = t("총 {n}건", { n: qnaState.total });
    const hasMore = qnaState.items.length < qnaState.total;
    el("admin-qna-list").innerHTML = qnaState.items.length
      ? qnaState.items.map(qnaCardHTML).join("") + loadMoreHTML(hasMore, "admin-qna-more")
      : `<p class="small">${esc(t("조건에 맞는 문의가 없습니다"))}</p>`;

    el("admin-qna-list").querySelectorAll(".admin-qna-template-pick").forEach((sel) =>
      sel.addEventListener("change", () => {
        if (!sel.value) return;
        const tpl = qnaTemplates.find((t) => t.id === sel.value);
        if (tpl) sel.closest("[data-id]").querySelector(".admin-qna-answer").value = tpl.body;
        sel.value = "";
      })
    );

    el("admin-qna-list").querySelectorAll(".admin-qna-submit").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const card = btn.closest("[data-id]");
        const answer = card.querySelector(".admin-qna-answer").value.trim();
        if (!answer) { toast(t("답변 내용을 입력해 주세요.")); return; }
        btn.disabled = true;
        await adminFetch(`/api/admin/qna/${encodeURIComponent(card.dataset.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ answer }),
        });
        toast(t("답변을 등록했습니다"));
        const idx = qnaState.items.findIndex((x) => x.id === card.dataset.id);
        if (idx > -1) qnaState.items[idx] = { ...qnaState.items[idx], answer, status: "답변완료" };
        renderAdminQna();
      })
    );

    el("admin-qna-more")?.addEventListener("click", () => paintAdminQna(true));
  }

  function qnaQueryParams() {
    const params = new URLSearchParams({ page: qnaState.page, pageSize: qnaState.pageSize });
    if (qnaState.q) params.set("q", qnaState.q);
    if (qnaState.status) params.set("status", qnaState.status);
    if (qnaState.dateFrom) params.set("dateFrom", qnaState.dateFrom);
    if (qnaState.dateTo) params.set("dateTo", qnaState.dateTo);
    return params;
  }

  async function paintAdminQna(loadMore = false) {
    qnaState.page = loadMore ? qnaState.page + 1 : 1;
    const result = await adminFetch(`/api/admin/qna?${qnaQueryParams().toString()}`);
    if (!result) return;
    qnaState.total = result.total;
    qnaState.items = loadMore ? qnaState.items.concat(result.items) : result.items;
    renderAdminQna();
  }

  el("qna-search").addEventListener("click", () => {
    qnaState.q = el("qna-q").value.trim();
    qnaState.status = el("qna-status").value;
    qnaState.dateFrom = el("qna-from").value;
    qnaState.dateTo = el("qna-to").value;
    paintAdminQna();
  });
  el("qna-reset").addEventListener("click", () => {
    el("qna-q").value = "";
    el("qna-status").value = "";
    el("qna-from").value = "";
    el("qna-to").value = "";
    el("qna-search").click();
  });
  el("qna-q").addEventListener("keydown", (e) => { if (e.key === "Enter") el("qna-search").click(); });

