  const qnaState = { page: 0, pageSize: 20, total: 0, items: [], q: "", status: "", dateFrom: "", dateTo: "" };
  let qnaTemplates = [];

  /* 문의 본문에 템플릿의 매칭 키워드(대소문자 무시) 중 하나라도 포함되면 그 템플릿을 기본으로
     골라준다 — 완전 자동응답이 아니라 답변창을 열었을 때 이미 채워져 있어 클릭 한 번을
     줄여주는 용도(등록 전에는 언제든 고쳐 쓰거나 드롭다운에서 다른 템플릿으로 바꿀 수 있음).
     여러 템플릿이 매칭되면 먼저 등록된(=목록 앞쪽) 템플릿을 우선한다. */
  function matchQnaTemplate(question) {
    const q = String(question || "").toLowerCase();
    return qnaTemplates.find((tpl) => (tpl.keywords || []).some((kw) => kw && q.includes(kw.toLowerCase())));
  }

  function qnaCardHTML(q) {
    const matched = q.status !== "답변완료" ? matchQnaTemplate(q.question) : null;
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
            ${qnaTemplates.map((tpl) => `<option value="${esc(tpl.id)}" ${matched && matched.id === tpl.id ? "selected" : ""}>${esc(tpl.label)}</option>`).join("")}
          </select>` : ""}
          ${matched ? `<p class="small" style="color:var(--text-muted);margin-top:4px">${esc(t("키워드가 일치해 \"{label}\" 템플릿을 미리 채웠습니다 — 확인 후 등록하거나 자유롭게 고쳐 쓰세요.", { label: matched.label }))}</p>` : ""}
          <div class="field" style="margin-top:8px">
            <textarea class="admin-qna-answer" placeholder="${esc(t("답변을 입력하세요"))}">${matched ? esc(matched.body) : ""}</textarea>
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
        const result = await adminFetch(`/api/admin/qna/${encodeURIComponent(card.dataset.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ answer }),
        });
        if (!result) { btn.disabled = false; return; }
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

