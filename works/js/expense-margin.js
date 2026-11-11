  /* 지출·정산 — 상품별 마진·원가 구성 (2026-11-11 큰 파일 나누기 — 내용·순서는 그대로). expenses.js 다음에 불러온다 */

  /* ---------- 상품별 마진·원가 구성(2026-11-11, 053) ----------
     상품마다 "원가 구성 ▾"을 펼쳐 본체·인쇄·포장·배송 등 항목을 적는다. 항목마다 "금액 ÷ 몇 벌 기준" = 1벌당 원가
     (예: 택배비 3,000원을 10벌 묶음으로 보냈으면 10벌 기준 → 1벌 300원). 항목 합계가 1벌 원가가 된다.
     항목이 없으면 1벌 원가 한 칸에 직접 적는다. 지출 입력 때 "어느 상품 원가"를 고르면 그 달 연결 지출로 보인다. */
  const COST_KIND_ORDER = ["body", "material", "print", "labor", "packaging", "shipping", "other"];
  function costRowHTML(c, kinds) {
    return `<div class="cost-row exp-grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) minmax(0,.7fr) minmax(0,1.6fr) auto">
      <input class="cr-name" value="${esc(c.name || "")}" placeholder="${esc(t("예: 후디 본체(무지)"))}">
      <select class="cr-kind">${COST_KIND_ORDER.map((k) => `<option value="${k}" ${k === (c.kind || "other") ? "selected" : ""}>${esc(t(kinds[k] || k))}</option>`).join("")}</select>
      <input class="cr-amount" type="number" min="0" value="${esc(c.amount ?? "")}" placeholder="${esc(t("금액"))}">
      <input class="cr-per" type="number" min="1" value="${esc(c.perQty || 1)}" title="${esc(t("몇 벌 기준"))}">
      <input class="cr-basis" value="${esc(c.basis || "")}" placeholder="${esc(t("거래처·조건(예: 30벌 이상 무료배송)"))}">
      <button type="button" class="btn btn--sm btn--ghost cr-remove" aria-label="${esc(t("삭제"))}">✕</button>
    </div>`;
  }
  /* 원가 구성이 있는 다른 상품 — 그 항목들을 그대로 붙여 넣고 금액만 고치면 된다(2026-11-11) */
  function costSources(m) {
    return ((expState.margin && expState.margin.items) || []).filter((x) => x.productId !== m.productId && x.components.length);
  }
  function costEditorHTML(m, kinds) {
    const rows = m.components.length ? m.components : [{ kind: "body", perQty: 1 }];
    return `<div class="cost-editor mini-form" style="grid-template-columns:1fr">
      <div class="form-head">${esc(t("{name} 1벌 원가 구성", { name: t(m.name) }))}</div>
      ${costSources(m).length ? `<div class="cost-copy small"><span class="m-label">${esc(t("다른 상품에서 가져오기"))}</span>
        <select class="cost-copy-from"><option value="">${esc(t("상품 선택…"))}</option>${costSources(m).map((x) => `<option value="${esc(x.productId)}">${esc(t(x.name))} · ${esc(t("{n}개 항목", { n: x.components.length }))} · ${esc(expWon(x.unitCost))}</option>`).join("")}</select></div>` : ""}
      <button type="button" class="form-x cost-close" aria-label="${esc(t("닫기"))}" title="${esc(t("닫기"))}">✕</button>
      <div class="exp-grid small" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) minmax(0,.7fr) minmax(0,1.6fr) auto;color:var(--text-muted)">
        <span>${esc(t("항목"))}</span><span>${esc(t("종류"))}</span><span>${esc(t("금액(원)"))}</span><span>${esc(t("몇 벌 기준"))}</span><span>${esc(t("메모(거래처·조건)"))}</span><span></span>
      </div>
      <div class="cost-rows">${rows.map((c) => costRowHTML(c, kinds)).join("")}</div>
      <div class="cost-sum small"></div>
      <div class="mini-form-actions">
        <button type="button" class="btn btn--sm btn--ghost cost-add">${esc(t("+ 항목"))}</button>
        <button type="button" class="btn btn--sm cost-save">${esc(t("원가 구성 저장"))}</button>
        <button type="button" class="btn btn--sm btn--ghost cost-close">${esc(t("닫기"))}</button>
        <span class="small" style="color:var(--text-muted)">${esc(t("배송비처럼 묶음으로 드는 비용은 '몇 벌 기준'에 묶음 수량을 넣으세요. 합계가 1벌 원가가 됩니다."))}</span>
      </div>
    </div>`;
  }
  function updateCostSum(editor) {
    let sum = 0;
    editor.querySelectorAll(".cost-row").forEach((r) => {
      const amt = Number(r.querySelector(".cr-amount").value) || 0;
      const per = Math.max(1, Number(r.querySelector(".cr-per").value) || 1);
      sum += amt / per;
    });
    editor.querySelector(".cost-sum").innerHTML = `<b>${esc(t("1벌 원가 합계"))} ${esc(expWon(sum))}</b>`;
  }
  function paintMargin(margin) {
    if (!margin) return;
    expState.margin = margin;
    registerProductNames((margin.items || []).map((m) => ({ nameKo: m.name, name: m.nameEn })));
    const kinds = margin.kinds || {};
    const tt = margin.totals || {};
    const editable = expEditable();
    // 지표 이름(판매액·원가·마진…)은 .m-label(작고 흐린 글씨), 상품 이름은 .m-name(진한 글씨)으로 구분한다(2026-11-11)
    const summary = `<div class="tnum" style="margin-bottom:8px"><span class="m-label">${esc(t("이번 달 판매액"))}</span> <b>${esc(expWon(tt.revenue))}</b> · <span class="m-label">${esc(t("원가"))}</span> <b>${esc(expWon(tt.cost))}</b> · <span class="m-label">${esc(t("마진"))}</span> <b>${esc(expWon(tt.margin))}</b>${tt.marginRate != null ? ` (${Math.round(tt.marginRate * 100)}%)` : ""}
      ${tt.missingCost ? `<div style="color:var(--status-pending-ink)">${esc(t("팔렸는데 원가가 없는 상품 {n}개 — 마진 합계에서 빠졌습니다", { n: tt.missingCost }))}</div>` : ""}</div>`;
    const sort = (el("exp-margin-sort") && el("exp-margin-sort").value) || "revenue";
    const sorted = [...(margin.items || [])].sort((a, b) =>
      sort === "name" ? String(a.name).localeCompare(String(b.name), "ko")
        : sort === "marginLow" ? (a.margin ?? Infinity) - (b.margin ?? Infinity)
        : sort === "noCost" ? (a.unitCost == null ? 0 : 1) - (b.unitCost == null ? 0 : 1) || (b.revenue || 0) - (a.revenue || 0)
        : (b.revenue || 0) - (a.revenue || 0));
    const COLS = "minmax(0,1.6fr) minmax(0,.4fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.1fr) auto";
    el("exp-margin").innerHTML = summary + (sorted.length
      ? `<div class="exp-grid margin-head" style="grid-template-columns:${COLS}">
          <span class="m-label">${esc(t("상품"))}</span><span class="m-label">${esc(t("판매"))}</span><span class="m-label">${esc(t("판매액"))}</span><span class="m-label">${esc(t("1벌 원가"))}</span><span class="m-label">${esc(t("마진"))}</span><span></span>
        </div>
        ${sorted.map((m) => `<div class="margin-row" data-pid="${esc(m.productId)}">
          <div class="exp-grid" style="grid-template-columns:${COLS};padding:6px 0;border-top:1px solid var(--border)">
            <span class="m-name">${esc(t(m.name))}${m.linkedExpenses ? `<div class="m-label">${esc(t("이번 달 연결 지출 {v}", { v: expWon(m.linkedExpenses) }))}</div>` : ""}</span>
            <span class="tnum">${m.qty}</span>
            <span class="tnum">${esc(expWon(m.revenue))}</span>
            ${m.components.length
              ? `<span class="tnum">${esc(expWon(m.unitCost))}</span>`
              : `<input type="number" min="0" class="exp-cost-input" data-pid="${esc(m.productId)}" value="${esc(m.unitCost ?? "")}" placeholder="${esc(t("직접 입력"))}">`}
            <span class="tnum">${m.margin == null ? "—" : `${esc(expWon(m.margin))}${m.revenue ? ` (${Math.round(m.marginRate * 100)}%)` : ""}`}</span>
            ${editable && !margin.costItemsMissing ? `<button type="button" class="btn btn--sm btn--ghost cost-toggle" data-i18n="원가 구성">원가 구성</button>` : "<span></span>"}
          </div>
          ${m.components.length ? `<div class="small tnum m-parts"><span class="m-label">${esc(t("1벌 원가 구성"))}</span> ${m.components.map((c) => `<span class="m-part">${esc(c.name)} <b>${esc(expWon(c.perPiece))}</b></span>`).join('<span class="m-plus">+</span>')}</div>` : ""}
        </div>`).join("")}`
      : `<p style="color:var(--text-muted)">${esc(t("상품이 없습니다"))}</p>`);
    el("exp-margin").querySelectorAll(".cost-toggle").forEach((b) => setDisclosure(b, false));
  }
  el("exp-margin")?.addEventListener("click", async (e) => {
    const row = e.target.closest(".margin-row");
    if (!row) return;
    const toggle = row.querySelector(".cost-toggle");
    const editor = row.querySelector(".cost-editor");
    const m = (expState.margin.items || []).find((x) => x.productId === row.dataset.pid);
    if (e.target.closest(".cost-toggle") || e.target.closest(".cost-close")) {
      if (editor) { editor.remove(); setDisclosure(toggle, false); return; }
      row.insertAdjacentHTML("beforeend", costEditorHTML(m, expState.margin.kinds || {}));
      updateCostSum(row.querySelector(".cost-editor"));
      setDisclosure(toggle, true);
      return;
    }
    if (!editor) return;
    if (e.target.closest(".cost-add")) { editor.querySelector(".cost-rows").insertAdjacentHTML("beforeend", costRowHTML({ kind: "other", perQty: 1 }, expState.margin.kinds || {})); updateCostSum(editor); return; }
    if (e.target.closest(".cr-remove")) { e.target.closest(".cost-row").remove(); updateCostSum(editor); return; }
    if (e.target.closest(".cost-save")) {
      const items = [...editor.querySelectorAll(".cost-row")].map((r) => ({
        name: r.querySelector(".cr-name").value.trim(), kind: r.querySelector(".cr-kind").value,
        amount: Number(r.querySelector(".cr-amount").value), perQty: Number(r.querySelector(".cr-per").value) || 1, basis: r.querySelector(".cr-basis").value.trim(),
      })).filter((x) => x.name || x.amount);
      const before = m.components.map((c) => ({ name: c.name, kind: c.kind, amount: c.amount, perQty: c.perQty, basis: c.basis }));
      const r = await adminFetch(`/api/admin/expenses/cost-items/${encodeURIComponent(m.productId)}`, { method: "PUT", body: JSON.stringify({ items }) });
      if (!r) return;
      paintMargin(await adminFetch(`/api/admin/expenses/margin?month=${expMonth()}`));
      toast(t("원가 구성을 저장했습니다"), {
        undo: async () => {
          const x = await adminFetch(`/api/admin/expenses/cost-items/${encodeURIComponent(m.productId)}`, { method: "PUT", body: JSON.stringify({ items: before }) });
          paintMargin(await adminFetch(`/api/admin/expenses/margin?month=${expMonth()}`));
          return !!x;
        },
      });
    }
  });
  el("exp-margin")?.addEventListener("change", (e) => {
    const sel = e.target.closest(".cost-copy-from");
    if (!sel || !sel.value) return;
    const editor = sel.closest(".cost-editor");
    const src = (expState.margin.items || []).find((x) => x.productId === sel.value);
    sel.value = "";
    if (!src) return;
    const box = editor.querySelector(".cost-rows");
    const hasContent = [...box.querySelectorAll(".cost-row")].some((r) => r.querySelector(".cr-name").value.trim() || r.querySelector(".cr-amount").value);
    const replace = !hasContent || confirm(t("지금 항목을 지우고 가져온 항목으로 바꿀까요?\n확인: 바꾸기 · 취소: 지금 항목 뒤에 추가"));
    const html = src.components.map((c) => costRowHTML(c, expState.margin.kinds || {})).join("");
    if (replace) box.innerHTML = html; else box.insertAdjacentHTML("beforeend", html);
    updateCostSum(editor);
    toast(t("{name}의 원가 항목 {n}개를 가져왔습니다 — 고친 뒤 '원가 구성 저장'", { name: t(src.name), n: src.components.length }));
  });
  el("exp-margin-sort")?.addEventListener("change", () => paintMargin(expState.margin));
  el("exp-margin")?.addEventListener("input", (e) => {
    const editor = e.target.closest(".cost-editor");
    if (editor && (e.target.matches(".cr-amount") || e.target.matches(".cr-per"))) updateCostSum(editor);
  });
  el("exp-cost-save")?.addEventListener("click", async () => {
    const costs = {};
    el("exp-margin").querySelectorAll(".exp-cost-input").forEach((i) => { costs[i.dataset.pid] = i.value === "" ? null : Number(i.value); });
    if (!Object.keys(costs).length) { toast(t("직접 입력할 원가 칸이 없습니다(원가 구성으로 관리 중)")); return; }
    if (await adminFetch("/api/admin/expenses/unit-costs", { method: "PUT", body: JSON.stringify({ costs }) })) { toast(t("원가를 저장했습니다")); paintMargin(await adminFetch(`/api/admin/expenses/margin?month=${expMonth()}`)); }
  });
