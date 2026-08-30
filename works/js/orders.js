  /* ---------- 전체 주문 (리스트 + 디테일 패널) ---------- */
  const ordersState = { page: 0, pageSize: 20, total: 0, items: [], q: "", status: "", dateFrom: "", dateTo: "" };
  let selectedOrderNo = null;

  function orderStatusChip(status) {
    return `<span class="status-chip ${ORDER_STATUS_CLASS[status] || "st-neutral"}">${esc(t(status))}</span>`;
  }

  /* 서버(server.js)가 미입금 주문을 24시간(PENDING_CANCEL_HOURS) 뒤 자동 취소하기까지 그
     사이 며칠씩 방치돼도 목록만 봐서는 몰랐다는 피드백 — 아직 자동취소 크론이 안 도는
     순간에도 "이미 24시간이 지났다"를 바로 알 수 있게 뱃지를 따로 붙인다. */
  const PENDING_CANCEL_HOURS = 24;
  function orderOverdueBadge(o) {
    if (o.status !== "입금대기") return "";
    const hours = (Date.now() - new Date(o.at).getTime()) / 3600000;
    if (hours < PENDING_CANCEL_HOURS) return "";
    return `<span class="status-chip st-overdue">${esc(t("{h}시간 경과", { h: PENDING_CANCEL_HOURS }))}</span>`;
  }

  function orderListRowHTML(o) {
    return `
      <button type="button" class="prow ${o.no === selectedOrderNo ? "is-selected" : ""}" data-no="${esc(o.no)}">
        <span>
          <span class="prow-id">${esc(o.no)}</span>
          <div class="prow-sub">${esc(o.customer.name)} · ${o.items.map((it) => `${esc(it.name)} × ${it.qty}`).join(", ")}</div>
        </span>
        <span style="text-align:right">
          <div class="prow-amount tnum">${money(o.total)}</div>
          <div style="margin-top:3px;display:flex;gap:4px;justify-content:flex-end">${orderStatusChip(o.status)}${orderOverdueBadge(o)}</div>
        </span>
      </button>`;
  }

  function orderDetailHTML(o) {
    return `
      <div class="detail-head">
        <div>
          <div class="detail-title tnum">${esc(o.no)}</div>
          <div class="detail-sub tnum">${fmtDate(o.at)}</div>
        </div>
        <span style="display:flex;gap:4px">${orderStatusChip(o.status)}${orderOverdueBadge(o)}</span>
      </div>
      <div class="detail-grid">
        <div class="detail-field"><label>${esc(t("주문자"))}</label><div>${esc(o.customer.name)} · ${esc(o.customer.tel)}</div></div>
        <div class="detail-field"><label>${esc(t("배송지"))}</label><div>[${esc(o.customer.zip)}] ${esc(o.customer.addr)} ${esc(o.customer.addr2 || "")}</div></div>
        <div class="detail-field"><label>${esc(t("입금자명"))}</label><div>${esc(o.customer.payer)}</div></div>
        <div class="detail-field"><label>${esc(t("메모"))}</label><div>${esc(o.customer.memo || "-")}</div></div>
      </div>
      <div class="detail-items">
        ${o.items.map((it) => `<div class="detail-item"><span>${esc(it.name)} (${esc(it.options)}) × ${it.qty}</span><span class="tnum">${money(it.sum)}</span></div>`).join("")}
        <div class="detail-total"><span>${esc(t("총 결제금액"))}</span><span class="tnum">${money(o.total)}</span></div>
      </div>
      <div class="detail-field" style="margin-top:16px">
        <label>${esc(t("상태"))}</label>
        <select class="mini-select" id="od-status">${ORDER_STATUSES.map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${esc(t(s))}</option>`).join("")}</select>
      </div>
      <div class="detail-field" id="od-cancel-reason-field" ${o.status === "취소" ? "" : "hidden"} style="margin-top:8px">
        <label>${esc(t("취소 사유 (선택)"))}</label>
        <input type="text" id="od-cancel-reason" placeholder="${esc(t("예: 고객 요청, 재고 소진 등"))}" maxlength="300">
        <p class="small" style="color:var(--text-muted);margin-top:4px">${esc(t("취소로 바꿔 저장하면 재고가 자동으로 복원되고, 카드결제 건은 환불도 자동 시도됩니다."))}</p>
      </div>
      <div class="detail-ship">
        <select id="od-courier">
          <option value="" ${!o.courier ? "selected" : ""}>${esc(t("택배사 선택"))}</option>
          ${COURIERS.map((c) => `<option value="${c.key}" ${c.key === o.courier ? "selected" : ""}>${esc(c.label)}</option>`).join("")}
        </select>
        <input type="text" id="od-tracking" placeholder="${esc(t("운송장번호"))}" value="${esc(o.trackingNo || "")}">
        <button type="button" class="primary-btn" id="od-save">${esc(t("저장"))}</button>
      </div>`;
  }

  function renderOrdersSplit() {
    const hasMore = ordersState.items.length < ordersState.total;
    el("orders-plist").innerHTML = ordersState.items.map(orderListRowHTML).join("") + loadMoreHTML(hasMore, "admin-orders-more");
    el("orders-summary").textContent = t("총 {n}건", { n: ordersState.total });

    el("orders-plist").querySelectorAll(".prow").forEach((btn) =>
      btn.addEventListener("click", () => { selectedOrderNo = btn.dataset.no; renderOrdersSplit(); })
    );
    el("admin-orders-more")?.addEventListener("click", () => paintAdminOrders(true));

    if (!selectedOrderNo && ordersState.items.length) selectedOrderNo = ordersState.items[0].no;
    const o = ordersState.items.find((x) => x.no === selectedOrderNo);
    el("orders-detail").innerHTML = o ? orderDetailHTML(o) : `<p class="small" style="padding:4px">${esc(t("주문이 없습니다"))}</p>`;

    if (o) {
      /* 예전엔 상태 드롭다운이 고르는 즉시 저장돼서(배송정보 저장 버튼과 저장 방식이 서로 달라
         헷갈렸고, 활동 로그에도 상태 변경과 배송정보 변경이 따로따로 쌓였다) — 이제 상태도
         드롭다운만으로는 저장되지 않고, 배송정보와 함께 이 버튼 하나로만 저장된다(한 번의
         저장 = 활동 로그 한 줄). */
      el("od-status").addEventListener("change", () => {
        el("od-cancel-reason-field").hidden = el("od-status").value !== "취소";
      });

      el("od-save").addEventListener("click", async () => {
        const status = el("od-status").value;
        const courier = el("od-courier").value;
        const trackingNo = el("od-tracking").value.trim();
        const cancelReason = el("od-cancel-reason").value.trim();
        const isNewCancel = status === "취소" && o.status !== "취소";
        const result = await adminFetch(`/api/admin/orders/${encodeURIComponent(o.no)}`, {
          method: "PATCH",
          body: JSON.stringify({ status, courier, trackingNo, cancelReason }),
        });
        if (!result) return;
        o.status = status;
        o.courier = courier;
        o.trackingNo = trackingNo;
        if (isNewCancel && result.cancel) {
          if (result.cancel.refund === "card" && result.cancel.ok) toast(t("주문을 취소하고 카드 결제도 자동 환불했습니다"));
          else if (result.cancel.refund === "card" && !result.cancel.ok) toast(t("주문은 취소됐지만 카드 환불에 실패했습니다 — 관리자 메일을 확인해 직접 처리해 주세요"));
          else if (result.cancel.refund === "bank_manual") toast(t("주문을 취소했습니다 — 무통장입금은 계좌로 직접 환불해 주세요"));
          else toast(t("주문을 취소했습니다"));
        } else {
          toast(t("주문 정보를 저장했습니다"));
        }
        renderOrdersSplit();
        /* 매출 집계(computeDashboardStats)는 저장 시점마다 취소 건을 이미 제외하고 다시
           계산하지만, 대시보드 탭 자체는 로그인 시점에 한 번만 그려서 방금 취소한 주문의
           매출이 그대로 남아있는 것처럼 보인다는 피드백 — 주문을 저장할 때마다 대시보드도
           같이 새로고침한다. */
        paintAdminDashboard();
      });
    }
  }

  function ordersQueryParams() {
    const params = new URLSearchParams({ page: ordersState.page, pageSize: ordersState.pageSize });
    if (ordersState.q) params.set("q", ordersState.q);
    if (ordersState.status) params.set("status", ordersState.status);
    if (ordersState.dateFrom) params.set("dateFrom", ordersState.dateFrom);
    if (ordersState.dateTo) params.set("dateTo", ordersState.dateTo);
    return params;
  }

  async function paintAdminOrders(loadMore = false) {
    ordersState.page = loadMore ? ordersState.page + 1 : 1;
    const result = await adminFetch(`/api/admin/orders?${ordersQueryParams().toString()}`);
    if (!result) return;
    ordersState.total = result.total;
    ordersState.items = loadMore ? ordersState.items.concat(result.items) : result.items;
    if (!loadMore) selectedOrderNo = null;
    renderOrdersSplit();
  }

  function renderOrderStatusOptions() {
    const select = el("ord-status");
    const known = new Set([...select.options].map((o) => o.value));
    ORDER_STATUSES.forEach((s) => {
      if (known.has(s)) return;
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = t(s);
      select.appendChild(opt);
    });
  }

  renderOrderStatusOptions();
  el("ord-search").addEventListener("click", () => {
    ordersState.q = el("ord-q").value.trim();
    ordersState.status = el("ord-status").value;
    ordersState.dateFrom = el("ord-from").value;
    ordersState.dateTo = el("ord-to").value;
    paintAdminOrders();
  });
  el("ord-reset").addEventListener("click", () => {
    el("ord-q").value = "";
    el("ord-status").value = "";
    el("ord-from").value = "";
    el("ord-to").value = "";
    el("ord-search").click();
  });
  el("ord-q").addEventListener("keydown", (e) => { if (e.key === "Enter") el("ord-search").click(); });

  /* 지금 화면에 걸려 있는 검색·필터 조건 그대로 서버에 다시 물어서(페이지네이션만 빼고) 파일로 받는다.
     인증 헤더가 필요해서 <a href>로 바로 못 걸고, fetch → blob → 임시 링크 클릭 방식을 쓴다.
     주문·재고·대시보드 내보내기가 모두 이 방식을 공유한다. */
  async function downloadExportFile(url, filenamePrefix, format) {
    const token = await getAccessToken();
    if (!token) { toast(t("로그인이 만료되었습니다. 다시 로그인해 주세요.")); return; }
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    } catch (e) {
      toast(t("요청이 실패했습니다"));
      return;
    }
    if (!res.ok) {
      let message = "";
      try { message = (await res.json()).error || ""; } catch (e) {}
      toast(message || t("요청이 실패했습니다") + ` (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = dlUrl;
    a.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(dlUrl);
  }

  function wireExportMenu(btnId, menuId, onFormat) {
    el(btnId).addEventListener("click", (e) => {
      e.stopPropagation();
      el(menuId).hidden = !el(menuId).hidden;
    });
    el(menuId).querySelectorAll("[data-format]").forEach((b) =>
      b.addEventListener("click", () => {
        el(menuId).hidden = true;
        onFormat(b.dataset.format);
      })
    );
    document.addEventListener("click", (e) => {
      if (!el(menuId).hidden && !el(menuId).contains(e.target) && e.target !== el(btnId)) {
        el(menuId).hidden = true;
      }
    });
  }

  function downloadOrdersExport(format) {
    const params = ordersQueryParams();
    params.delete("page");
    params.delete("pageSize");
    params.set("format", format);
    return downloadExportFile(`/api/admin/orders/export?${params.toString()}`, "reiten-orders", format);
  }
  wireExportMenu("ord-export", "ord-export-menu", downloadOrdersExport);

  const returnsState = { page: 0, pageSize: 20, total: 0, items: [], q: "", status: "", dateFrom: "", dateTo: "" };

