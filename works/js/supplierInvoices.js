  /* ---------- 매입 장부 (2026-11-10, 마이그레이션 050) ----------
     실시간 에이전트 AI가 공급처 거래명세서·세금계산서·영수증 메일에서 기록한 매입(상태 "확인 대기")을 사람이 확인하거나 제외한다.
     금액을 잘못 읽었으면 합계를 고친 뒤 확인. 확인된 매입만 월간 정산 엑셀("매입 내역" 시트·"순매출 - 매입")에 들어간다.
     공급처명·품목은 외부 메일에서 온 글이라 esc()로만 넣는다. */
  const INVOICE_DOC_LABEL = { statement: "거래명세서", tax_invoice: "세금계산서", receipt: "영수증", other: "기타" };
  const INVOICE_STATUS_LABEL = { RECORDED: "확인 대기", CONFIRMED: "확인", REJECTED: "제외" };
  const INVOICE_STATUS_CLASS = { RECORDED: "st-pending", CONFIRMED: "st-done", REJECTED: "st-neutral" };
  const invoiceState = { items: new Map() };
  const invoiceWon = (n) => `${Number(n || 0).toLocaleString("ko-KR")}${t("원")}`;

  /* 직접 입력·수정 폼(2026-11-11) — AI가 놓친 매입을 넣거나, 잘못 읽은 값을 고친다(확인된 줄도). 바꾸기 전 값은 활동 로그에. */
  function invoiceFormHTML(v) {
    const isEdit = !!v;
    v = v || {};
    return `
      <div class="invoice-form mini-form">
        <label>${esc(t("공급처 이름"))}<input class="if-supplier-label" value="${esc(v.supplierLabel || "")}" placeholder="${esc(t("예: 프린트캔버스"))}"></label>
        <label>${esc(t("공급처 식별자(영문)"))}<input class="if-supplier-name" value="${esc(v.supplierName || "")}" placeholder="printcanvas"></label>
        <label>${esc(t("문서 종류"))}<select class="if-doc-type">${Object.keys(INVOICE_DOC_LABEL).map((k) => `<option value="${k}" ${k === (v.docType || "statement") ? "selected" : ""}>${esc(t(INVOICE_DOC_LABEL[k]))}</option>`).join("")}</select></label>
        <label>${esc(t("문서번호"))}<input class="if-doc-number" value="${esc(v.docNumber || "")}"></label>
        <label>${esc(t("발행일"))}<input type="date" class="if-issued" value="${esc(v.issuedOn || new Date().toISOString().slice(0, 10))}"></label>
        <label>${esc(t("공급가액"))}<input type="number" min="0" class="if-supply" value="${esc(v.supplyAmount ?? "")}"></label>
        <label>${esc(t("부가세"))}<input type="number" min="0" class="if-vat" value="${esc(v.vatAmount ?? "")}"></label>
        <label>${esc(t("합계(원)"))}<input type="number" min="0" class="if-total" value="${esc(v.totalAmount ?? "")}" required></label>
        <label class="mini-form-wide">${esc(t("품목 요약"))}<input class="if-items" value="${esc(v.itemsSummary || "")}"></label>
        <div class="mini-form-actions">
          <button type="button" class="btn btn--sm if-save">${esc(t(isEdit ? "저장" : "등록"))}</button>
          <button type="button" class="btn btn--sm btn--ghost if-cancel">${esc(t("닫기"))}</button>
          <span class="small" style="color:var(--text-muted);align-self:center">${esc(t(isEdit ? "바꾸기 전 값은 활동 로그에 남습니다." : "직접 입력한 매입은 바로 확인 상태로 저장됩니다."))}</span>
        </div>
      </div>`;
  }

  function readInvoiceForm(form) {
    const num = (sel) => (form.querySelector(sel).value === "" ? "" : Number(form.querySelector(sel).value));
    const label = form.querySelector(".if-supplier-label").value.trim();
    return {
      supplierLabel: label,
      supplierName: form.querySelector(".if-supplier-name").value.trim() || label,
      docType: form.querySelector(".if-doc-type").value,
      docNumber: form.querySelector(".if-doc-number").value.trim(),
      issuedOn: form.querySelector(".if-issued").value,
      supplyAmount: num(".if-supply"),
      vatAmount: num(".if-vat"),
      totalAmount: num(".if-total"),
      itemsSummary: form.querySelector(".if-items").value.trim(),
    };
  }

  function invoiceRowHTML(v) {
    const pending = v.status === "RECORDED";
    return `
      <div data-id="${esc(v.id)}" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border)">
        <div style="flex:1;min-width:220px">
          <span class="status-chip ${INVOICE_STATUS_CLASS[v.status] || "st-neutral"}">${esc(t(INVOICE_STATUS_LABEL[v.status] || v.status))}</span>
          <b style="margin-left:6px">${esc(v.supplierLabel || v.supplierName)}</b>
          <span style="color:var(--text-muted);margin-left:6px">${esc(t(INVOICE_DOC_LABEL[v.docType] || v.docType))} · <span class="tnum">${esc(v.issuedOn)}</span>${v.docNumber ? ` · <span class="tnum">${esc(v.docNumber)}</span>` : ""}</span>
          ${v.itemsSummary ? `<div style="margin-top:2px">${esc(v.itemsSummary)}</div>` : ""}
          <div class="tnum" style="margin-top:2px">${esc(invoiceWon(v.totalAmount))}${v.supplyAmount != null ? ` <span style="color:var(--text-muted)">(${esc(t("공급가액"))} ${esc(invoiceWon(v.supplyAmount))} + ${esc(t("부가세"))} ${esc(invoiceWon(v.vatAmount))})</span>` : ""}
            ${v.amountMismatch ? ` <span style="color:var(--danger)">${esc(t("공급가액+부가세가 합계와 다릅니다"))}</span>` : ""}</div>
        </div>
        <button type="button" class="btn btn--sm btn--ghost invoice-edit">${esc(t("수정"))}</button>
        ${pending ? `
        <input type="number" class="invoice-total" value="${esc(v.totalAmount)}" min="0" style="width:120px" title="${esc(t("합계(원)"))}">
        <button type="button" class="btn btn--sm invoice-confirm">${esc(t("확인"))}</button>
        <button type="button" class="btn btn--sm btn--ghost invoice-reject">${esc(t("제외"))}</button>` : `
        <button type="button" class="btn btn--sm btn--ghost invoice-reopen">${esc(t("확인 대기로 되돌리기"))}</button>`}
      </div>`;
  }

  async function paintSupplierInvoices() {
    const list = el("supplier-invoices-list");
    if (!list) return;
    const monthInput = el("invoice-month");
    if (!monthInput.value) {
      const d = new Date();
      monthInput.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    const res = await adminFetch(`/api/admin/supplier-invoices?month=${encodeURIComponent(monthInput.value)}`);
    if (!res) return;
    if (res.migrationMissing) {
      el("supplier-invoices-totals").textContent = "";
      list.innerHTML = `<p>${esc(t("DB 마이그레이션 050을 실행하면 매입 장부를 쓸 수 있습니다."))}</p>`;
      return;
    }
    el("supplier-invoices-totals").innerHTML =
      `<b>${esc(t("확인된 매입"))} ${esc(invoiceWon(res.totals.confirmed))}</b> · ${esc(t("확인 대기"))} ${esc(invoiceWon(res.totals.recorded))}` +
      (res.bySupplier.length ? `<div style="color:var(--text-muted);margin-top:2px">${res.bySupplier.map((p) => `${esc(p.label || p.name)} ${esc(invoiceWon(p.total))}`).join(" · ")}</div>` : "");
    invoiceState.items = new Map(res.items.map((v) => [v.id, v]));
    list.innerHTML = res.items.length ? res.items.map(invoiceRowHTML).join("") : `<p style="color:var(--text-muted)">${esc(t("이 달의 매입 기록이 없습니다"))}</p>`;
  }

  el("invoice-month")?.addEventListener("change", paintSupplierInvoices);
  el("supplier-invoices-list")?.addEventListener("click", async (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".invoice-edit")) {
      if (!row.querySelector(".invoice-form")) row.insertAdjacentHTML("beforeend", invoiceFormHTML(invoiceState.items.get(id)));
      return;
    }
    const form = row.querySelector(".invoice-form");
    if (form && e.target.closest(".if-cancel")) { form.remove(); return; }
    if (form && e.target.closest(".if-save")) {
      const before = invoiceState.items.get(id) || {};
      const r = await adminFetch(`/api/admin/supplier-invoices/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(readInvoiceForm(form)) });
      if (!r) return;
      paintSupplierInvoices();
      if (r.unchanged) { toast(t("바뀐 내용이 없습니다")); return; }
      toast(t("저장했습니다"), {
        undo: async () => {
          const back = {
            supplierName: before.supplierName, supplierLabel: before.supplierLabel || "", docType: before.docType, docNumber: before.docNumber || "",
            issuedOn: before.issuedOn, supplyAmount: before.supplyAmount ?? "", vatAmount: before.vatAmount ?? "", totalAmount: before.totalAmount, itemsSummary: before.itemsSummary || "",
          };
          const x = await adminFetch(`/api/admin/supplier-invoices/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(back) });
          paintSupplierInvoices();
          return !!x;
        },
      });
      return;
    }
    let body = null;
    if (e.target.closest(".invoice-confirm")) {
      const total = Math.floor(Number(row.querySelector(".invoice-total").value));
      if (!(total >= 0)) { toast(t("합계 금액을 확인해 주세요")); return; }
      body = { status: "CONFIRMED", totalAmount: total };
    } else if (e.target.closest(".invoice-reject")) body = { status: "REJECTED" };
    else if (e.target.closest(".invoice-reopen")) body = { status: "RECORDED" };
    if (!body) return;
    const before = invoiceState.items.get(id) || {};
    const res = await adminFetch(`/api/admin/supplier-invoices/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
    if (!res) return;
    paintSupplierInvoices();
    // 되돌리기 — 상태(와 확인 때 고친 합계)를 원래대로
    const msg = { CONFIRMED: "매입을 확인했습니다", REJECTED: "매입을 제외했습니다", RECORDED: "확인 대기로 되돌렸습니다" }[body.status];
    toast(t(msg), {
      undo: async () => {
        const back = { status: before.status };
        if (body.totalAmount !== undefined && before.totalAmount !== undefined) back.totalAmount = before.totalAmount;
        const r = await adminFetch(`/api/admin/supplier-invoices/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(back) });
        paintSupplierInvoices();
        return !!r;
      },
    });
  });

  /* "+ 직접 입력" */
  el("supplier-invoices-new")?.addEventListener("click", () => {
    const box = el("supplier-invoices-newform");
    box.innerHTML = box.innerHTML.trim() ? "" : invoiceFormHTML(null);
  });
  el("supplier-invoices-newform")?.addEventListener("click", async (e) => {
    const box = el("supplier-invoices-newform");
    const form = box.querySelector(".invoice-form");
    if (!form) return;
    if (e.target.closest(".if-cancel")) { box.innerHTML = ""; return; }
    if (!e.target.closest(".if-save")) return;
    const body = readInvoiceForm(form);
    if (!body.supplierName || body.totalAmount === "" || !body.issuedOn) { toast(t("공급처·발행일·합계는 꼭 입력해 주세요")); return; }
    const r = await adminFetch("/api/admin/supplier-invoices", { method: "POST", body: JSON.stringify(body) });
    if (!r) return;
    box.innerHTML = "";
    toast(t("등록했습니다"));
    paintSupplierInvoices();
  });
