  /* 반품·교환·취소 신청 탭 (2026-11-11 큰 파일 나누기 — 내용·순서는 그대로) */

  const REQUEST_TYPE_LABEL = { return: "반품", exchange: "교환", cancel: "주문취소 신청" };
  const REQUEST_TYPE_CLASS = { return: "st-neutral", exchange: "st-neutral", cancel: "st-pending" };

  /* 신청 사유(r.reason)는 고객 신청 폼의 고정 한국어 선택지라 사전 키 그대로 t()로 번역한다(2026-10-28 정기 감사).
     고객이 직접 쓴 customReason·detail은 번역하지 않는다. */
  function returnCardHTML(r) {
    const requestType = r.requestType || "return";
    return `
      <div class="panel" data-id="${esc(r.id)}">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline">
          <span style="display:flex;gap:8px;align-items:baseline">
            <b class="tnum">${esc(r.orderNo)}</b>
            <span class="status-chip ${REQUEST_TYPE_CLASS[requestType] || "st-neutral"}">${esc(t(REQUEST_TYPE_LABEL[requestType] || requestType))}</span>
          </span>
          <span class="small tnum">${fmtDate(r.at)}</span>
        </div>
        <p class="small" style="margin-top:6px">${esc(r.contactName)} · ${esc(r.contactTel)}</p>
        <p style="margin-top:8px">${esc(t(r.reason))}${r.customReason ? " — " + esc(r.customReason) : ""}${r.detail ? " · " + esc(r.detail) : ""}</p>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span class="status-chip admin-return-status-chip ${RETURN_STATUS_CLASS[r.status] || "st-neutral"}">${esc(t(r.status))}</span>
          <select class="admin-return-status">${(RETURN_STATUSES_BY_TYPE[requestType] || RETURN_STATUSES).map((s) => `<option value="${s}" ${s === r.status ? "selected" : ""}>${esc(t(s))}</option>`).join("")}</select>
          <select class="mini-select admin-return-assignee">${adminAssigneeOptionsHTML(r.assignedTo)}</select>
          <button type="button" class="btn btn--sm admin-return-save">${esc(t("저장"))}</button>
          ${requestType === "return" && !r.refunded && hasAreaEdit("refunds") ? `<button type="button" class="btn btn--sm admin-return-refund">${esc(t("환불 처리"))}</button>` : ""}
          ${requestType === "exchange" ? `<button type="button" class="btn btn--sm admin-return-reship">${esc(t("교환 재발송"))}</button>` : ""}
          ${requestType === "exchange" && !r.restocked ? `<button type="button" class="btn btn--sm btn--ghost admin-return-restock-lines">${esc(t("회수 상품 재고 복원"))}</button>` : ""}
          ${r.restocked ? `<span class="small" style="color:var(--text-muted)">${esc(t("재고 복원 완료"))}</span>` : ""}
          ${r.refunded && requestType !== "cancel" ? `<span class="small" style="color:var(--text-muted)">${esc(t("환불 완료"))}</span>` : ""}
          ${r.refunded && requestType === "cancel" ? `<span class="small" style="color:var(--text-muted)">${esc(t("주문 취소 처리됨"))}</span>` : ""}
        </div>
        ${r.reshipTrackingNo ? `<p class="small" style="margin-top:6px">${esc(t("재발송"))}: ${esc(t((COURIERS.find((c) => c.key === r.reshipCourier) || {}).label || r.reshipCourier || ""))} ${esc(r.reshipTrackingNo)}</p>` : ""}
        ${requestType === "cancel" && r.status !== "완료" && r.status !== "반려" ? `<p class="small" style="margin-top:6px;color:var(--text-muted)">${esc(t("'완료'로 저장하면 주문이 실제로 취소되고 재고 복원·환불까지 자동으로 처리됩니다(출고 전 주문만)."))}</p>` : ""}
        <textarea class="admin-return-note" rows="2" style="margin-top:8px" placeholder="${esc(t("내부 메모 (고객에게 보이지 않음)"))}" maxlength="2000">${esc(r.internalNote || "")}</textarea>
      </div>`;
  }

  function renderAdminReturns() {
    el("returns-summary").textContent = t("총 {n}건", { n: returnsState.total });
    const hasMore = returnsState.items.length < returnsState.total;
    el("admin-returns-list").innerHTML = returnsState.items.length
      ? returnsState.items.map(returnCardHTML).join("") + loadMoreHTML(hasMore, "admin-returns-more")
      : `<p class="small">${esc(t("조건에 맞는 신청이 없습니다"))}</p>`;

    /* 상태 드롭다운을 고르는 즉시 저장하던 방식(다른 탭 만지다 실수로 스크롤하며 값이 바뀌어도
       바로 저장돼버림) 대신, "저장" 버튼을 눌러야 반영되도록 바꿨다. */
    el("admin-returns-list").querySelectorAll(".admin-return-save").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const card = btn.closest("[data-id]");
        const id = card.dataset.id;
        const status = card.querySelector(".admin-return-status").value;
        const assignedTo = card.querySelector(".admin-return-assignee").value;
        const internalNote = card.querySelector(".admin-return-note").value.trim();
        const prevItem = returnsState.items.find((x) => x.id === id);
        const type = (prevItem && prevItem.requestType) || "return";
        if (type === "return" && status === "완료" && prevItem && !prevItem.refunded) {
          toast(t("반품 완료는 '환불 처리' 버튼으로 진행해 주세요"));
          return;
        }
        if (type === "cancel" && status === "완료" && prevItem && prevItem.status !== "완료") {
          if (!confirm(t("주문 {orderNo}을(를) 실제로 취소합니다. 재고가 복원되고 결제된 금액은 환불됩니다(무통장은 직접 송금). 진행할까요?", { orderNo: prevItem.orderNo }))) return;
        }
        btn.disabled = true;
        const result = await adminFetch(`/api/admin/returns/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status, assignedTo, internalNote, expectedStatus: prevItem ? prevItem.status : undefined }),
        });
        btn.disabled = false;
        if (!result) {
          // 다른 관리자가 먼저 바꿨으면(409 STALE) 옛 상태를 들고 있어 다시 저장해도 계속 실패했다 — 목록을 다시 불러온다(2026-10-28 정기 감사).
          if (lastAdminFetchError && lastAdminFetchError.code === "STALE") paintAdminReturns();
          return;
        }

        /* 저장 버튼을 눌러도 화면이 그대로라 "정말 반영됐는지 알기 어렵다"는 피드백 — 토스트
           문구만 다르고 정작 카드의 상태 뱃지(item.status)는 갱신 안 하던 버그였다. 환불 결과와
           무관하게 상태는 항상 저장된 것이므로, 네 분기 전부 item.status를 갱신하고 다시 그린다. */
        const item = returnsState.items.find((x) => x.id === id);
        if (item) { item.status = status; item.assignedTo = assignedTo || null; item.internalNote = internalNote || null; }

        const c = result.cancel;
        if (c) {
          if (item) item.refunded = true;
          if (c.refund === "card" && c.ok) toast(t("주문을 취소하고 카드 결제도 자동 환불했습니다"));
          else if (c.refund === "card" && !c.ok) toast(t("주문은 취소됐지만 카드 환불에 실패했습니다 — 관리자 메일을 확인해 직접 처리해 주세요"));
          else if (c.refund === "virtual_account_closed" && c.ok) toast(t("주문을 취소하고 가상계좌도 폐쇄했습니다 — 아직 입금 전이라 환불할 금액은 없습니다"));
          else if (c.refund === "virtual_account_closed" && !c.ok) toast(t("주문은 취소됐지만 가상계좌 폐쇄에 실패했습니다 — 관리자 메일을 확인해 직접 처리해 주세요"));
          else if (c.refund === "virtual_account" && c.ok) toast(t("주문을 취소하고 입금된 금액도 자동 환불했습니다"));
          else if (c.refund === "virtual_account" && !c.ok) toast(t("주문은 취소됐지만 가상계좌 환불에 실패했습니다 — 관리자 메일을 확인해 직접 처리해 주세요"));
          else if (c.refund === "bank_manual") toast(t("주문을 취소했습니다 — 무통장입금은 계좌로 직접 환불해 주세요"));
          else if (c.refund === "already_cancelled") toast(t("이미 취소된 주문이라 신청만 완료 처리했습니다"));
          else toast(t("주문을 취소했습니다"));
        } else {
          toast(t("상태를 저장했습니다"));
        }
        renderAdminReturns();
        // 주문 탭이 예전 상태를 들고 있으면 다음 저장 때 "다른 관리자가 수정" 오류가 났다 — 같이 새로 고친다(2026-10-28)
        if (typeof canView === "function" && canView("orders")) paintAdminOrders();

        /* 다시 그린 뒤 방금 저장한 카드의 뱃지에 잠깐 테두리를 줘서 "여기가 바뀌었다"를
           명확히 보여준다(1.2초 후 자동으로 사라짐). */
        const chip = el("admin-returns-list").querySelector(`[data-id="${CSS.escape(id)}"] .admin-return-status-chip`);
        if (chip) {
          chip.classList.add("status-chip--saved");
          setTimeout(() => chip.classList.remove("status-chip--saved"), 1200);
        }
      })
    );

    /* 반품 → 환불 처리 창(상품·수량·귀책·배송비 차감·재고 복원을 고르고 금액 확인 후 실행, works/js/refunds.js) */
    el("admin-returns-list").querySelectorAll(".admin-return-refund").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-id]").dataset.id;
        const item = returnsState.items.find((x) => x.id === id);
        if (!item) return;
        openRefundDialog({
          orderNo: item.orderNo, kind: "return", returnId: id,
          onDone: (result) => {
            item.refunded = true;
            item.status = "완료";
            if (result.refund && result.refund.restocked) item.restocked = true;
            renderAdminReturns();
            // 주문 탭이 예전 상태를 들고 있으면 다음 저장 때 "다른 관리자가 수정" 오류가 났다 — 같이 새로 고친다(2026-10-28)
            if (typeof canView === "function" && canView("orders")) paintAdminOrders();
          },
        });
      })
    );

    /* 교환 → 재발송(운송장 입력·고객 안내, 환불 없음) */
    el("admin-returns-list").querySelectorAll(".admin-return-reship").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-id]").dataset.id;
        const item = returnsState.items.find((x) => x.id === id);
        openReshipDialog({
          returnId: id,
          onDone: (result) => {
            if (item) Object.assign(item, { status: "재발송", reshipCourier: result.item.reshipCourier, reshipTrackingNo: result.item.reshipTrackingNo });
            renderAdminReturns();
          },
        });
      })
    );

    /* 교환으로 돌아온 상품 중 고른 것만 재고 복원 */
    el("admin-returns-list").querySelectorAll(".admin-return-restock-lines").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-id]").dataset.id;
        const item = returnsState.items.find((x) => x.id === id);
        if (!item) return;
        openRestockLinesDialog({
          orderNo: item.orderNo, returnId: id,
          onDone: () => { item.restocked = true; renderAdminReturns(); },
        });
      })
    );

    el("admin-returns-more")?.addEventListener("click", () => paintAdminReturns(true));
  }

  function returnsQueryParams() {
    const params = new URLSearchParams({ page: returnsState.page, pageSize: returnsState.pageSize });
    if (returnsState.q) params.set("q", returnsState.q);
    if (returnsState.status) params.set("status", returnsState.status);
    if (returnsState.dateFrom) params.set("dateFrom", returnsState.dateFrom);
    if (returnsState.dateTo) params.set("dateTo", returnsState.dateTo);
    if (returnsState.assignedTo) params.set("assignedTo", returnsState.assignedTo);
    return params;
  }

  async function paintAdminReturns(loadMore = false) {
    returnsState.page = loadMore ? returnsState.page + 1 : 1;
    const seq = (returnsState.seq = (returnsState.seq || 0) + 1); // 마지막 요청만 화면에 반영(검색 직후 탭 첫 로딩과 겹칠 때, 2026-11-11)
    const result = await adminFetch(`/api/admin/returns?${returnsQueryParams().toString()}`);
    if (!result || seq !== returnsState.seq) return;
    returnsState.total = result.total;
    returnsState.items = loadMore ? returnsState.items.concat(result.items) : result.items;
    renderAdminReturns();
  }

  function renderReturnStatusOptions() {
    const select = el("ret-status");
    const known = new Set([...select.options].map((o) => o.value));
    RETURN_STATUSES.forEach((s) => {
      if (known.has(s)) return;
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = t(s);
      select.appendChild(opt);
    });
  }

  renderReturnStatusOptions();
  el("ret-search").addEventListener("click", () => {
    returnsState.q = el("ret-q").value.trim();
    returnsState.status = el("ret-status").value;
    returnsState.dateFrom = el("ret-from").value;
    returnsState.dateTo = el("ret-to").value;
    returnsState.assignedTo = el("ret-mine").checked ? "me" : "";
    paintAdminReturns();
  });
  el("ret-reset").addEventListener("click", () => {
    el("ret-q").value = "";
    el("ret-status").value = "";
    el("ret-from").value = "";
    el("ret-to").value = "";
    el("ret-mine").checked = false;
    el("ret-search").click();
  });
  el("ret-q").addEventListener("keydown", (e) => { if (e.key === "Enter") el("ret-search").click(); });
