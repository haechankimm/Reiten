  /* ---------- 매입 장부 (2026-11-10, 마이그레이션 050) ----------
     피클이 공급처 거래명세서·세금계산서·영수증 메일에서 기록한 매입(상태 "확인 대기")을 사람이 확인하거나 제외한다.
     금액을 잘못 읽었으면 합계를 고친 뒤 확인. 확인된 매입만 월간 정산 엑셀("매입 내역" 시트·"순매출 - 매입")에 들어간다.
     공급처명·품목은 외부 메일에서 온 글이라 esc()로만 넣는다. */
  const INVOICE_DOC_LABEL = { statement: "거래명세서", tax_invoice: "세금계산서", receipt: "영수증", other: "기타" };
  const INVOICE_STATUS_LABEL = { RECORDED: "확인 대기", CONFIRMED: "확인", REJECTED: "제외" };
  const INVOICE_STATUS_CLASS = { RECORDED: "st-pending", CONFIRMED: "st-done", REJECTED: "st-neutral" };
  const invoiceWon = (n) => `${Number(n || 0).toLocaleString("ko-KR")}${t("원")}`;

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
    list.innerHTML = res.items.length ? res.items.map(invoiceRowHTML).join("") : `<p style="color:var(--text-muted)">${esc(t("이 달의 매입 기록이 없습니다"))}</p>`;
  }

  el("invoice-month")?.addEventListener("change", paintSupplierInvoices);
  el("supplier-invoices-list")?.addEventListener("click", async (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    let body = null;
    if (e.target.closest(".invoice-confirm")) {
      const total = Math.floor(Number(row.querySelector(".invoice-total").value));
      if (!(total >= 0)) { toast(t("합계 금액을 확인해 주세요")); return; }
      body = { status: "CONFIRMED", totalAmount: total };
    } else if (e.target.closest(".invoice-reject")) body = { status: "REJECTED" };
    else if (e.target.closest(".invoice-reopen")) body = { status: "RECORDED" };
    if (!body) return;
    const res = await adminFetch(`/api/admin/supplier-invoices/${encodeURIComponent(row.dataset.id)}`, { method: "PATCH", body: JSON.stringify(body) });
    if (res) paintSupplierInvoices();
  });
