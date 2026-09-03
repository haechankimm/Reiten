  /* ---------- 결제 트랜잭션 로그 ----------
     주문(orders)은 성공해서 실제로 만들어진 주문만 보여준다 — 결제가 실패·불일치·에러로
     끝나 주문으로 안 이어진 시도는 지금까지 어디에도 안 남았다(server/lib/adminLog.js의
     logPaymentAttempt 참고, 2026-09 "결제 트랜잭션 로그(주문과 분리된 원장)" 요청). 조회
     전용이라 orders.js의 필터·페이지네이션 패턴을 그대로 따른다. */
  const paymentLogState = { page: 0, pageSize: 20, total: 0, items: [], q: "", status: "", dateFrom: "", dateTo: "" };

  const PAYMENT_STATUS_CLASS = { paid: "st-done", failed: "st-overdue", mismatch: "st-pending", error: "st-overdue" };

  function paymentLogRowHTML(r) {
    return `
      <div class="panel" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <b class="tnum">${esc(r.paymentId)}</b>
          <span class="status-chip ${PAYMENT_STATUS_CLASS[r.status] || "st-neutral"}" style="margin-left:6px">${esc(t(r.statusLabel))}</span>
          <div class="small tnum" style="color:var(--text-muted);margin-top:2px">
            ${fmtDate(r.createdAt)}${r.orderNo ? ` · ${esc(r.orderNo)}` : ""}${r.amount != null ? ` · ${money(r.amount)}` : ""}
          </div>
          ${r.reason ? `<div class="small" style="color:var(--text-muted);margin-top:2px">${esc(r.reason)}</div>` : ""}
        </div>
      </div>`;
  }

  function renderPaymentLog() {
    el("paymentlog-summary").textContent = t("총 {n}건", { n: paymentLogState.total });
    const hasMore = paymentLogState.items.length < paymentLogState.total;
    el("admin-paymentlog-list").innerHTML = paymentLogState.items.length
      ? paymentLogState.items.map(paymentLogRowHTML).join("") + loadMoreHTML(hasMore, "admin-paymentlog-more")
      : `<p class="small">${esc(t("조건에 맞는 기록이 없습니다"))}</p>`;
    el("admin-paymentlog-more")?.addEventListener("click", () => paintAdminPaymentLog(true));
  }

  function paymentLogQueryParams() {
    const params = new URLSearchParams({ page: paymentLogState.page, pageSize: paymentLogState.pageSize });
    if (paymentLogState.q) params.set("q", paymentLogState.q);
    if (paymentLogState.status) params.set("status", paymentLogState.status);
    if (paymentLogState.dateFrom) params.set("dateFrom", paymentLogState.dateFrom);
    if (paymentLogState.dateTo) params.set("dateTo", paymentLogState.dateTo);
    return params;
  }

  async function paintAdminPaymentLog(loadMore = false) {
    paymentLogState.page = loadMore ? paymentLogState.page + 1 : 1;
    const result = await adminFetch(`/api/admin/payment-log?${paymentLogQueryParams().toString()}`);
    if (!result) return;
    paymentLogState.total = result.total;
    paymentLogState.items = loadMore ? paymentLogState.items.concat(result.items) : result.items;
    renderPaymentLog();
  }

  el("pl-search").addEventListener("click", () => {
    paymentLogState.q = el("pl-q").value.trim();
    paymentLogState.status = el("pl-status").value;
    paymentLogState.dateFrom = el("pl-from").value;
    paymentLogState.dateTo = el("pl-to").value;
    paintAdminPaymentLog();
  });
  el("pl-q").addEventListener("keydown", (e) => { if (e.key === "Enter") el("pl-search").click(); });
  el("pl-reset").addEventListener("click", () => {
    el("pl-q").value = "";
    el("pl-status").value = "";
    el("pl-from").value = "";
    el("pl-to").value = "";
    paymentLogState.q = paymentLogState.status = paymentLogState.dateFrom = paymentLogState.dateTo = "";
    paintAdminPaymentLog();
  });
  el("pl-export").addEventListener("click", () => {
    const params = paymentLogQueryParams();
    params.delete("page");
    params.delete("pageSize");
    downloadExportFile(`/api/admin/payment-log/export?${params.toString()}`, "reiten-payment-log", "csv");
  });
