  /* ---------- 알림 발송 실패 아웃박스 ----------
     lib/mailer.js·lib/push.js가 발송 실패 시 남기는 system_error_log(type=
     "notification_failed")를 조회 전용으로 보여준다(2026-09 요청). "해결됨 처리"는 기존
     시스템 오류 팝업이 쓰는 것과 같은 엔드포인트(POST /api/admin/system-errors/:id/resolve)를
     그대로 재사용한다 — 같은 데이터를 다른 화면에서 보여줄 뿐이라 처리 방법도 같아야 한다. */
  const outboxState = { page: 0, pageSize: 30, total: 0, items: [], resolved: false };

  /* kind·channel은 서버 코드값(lib/mailer.js의 sendTracked 첫 인자, lib/push.js는 payload.tab)이라
     "customer_shipped"·"email"처럼 그대로 찍혀 무슨 알림인지 알기 어려웠다(2026-10-28 정기 감사) — 한국어 이름을
     붙여 t()로 번역한다. 새 종류를 추가하고 여기 깜빡해도 코드값은 그대로 보여서 정보가 사라지진 않는다. */
  const OUTBOX_CHANNEL_LABEL = { email: "이메일", push: "폰 푸시" };
  const OUTBOX_KIND_LABEL = {
    order_notification: "새 주문 알림(관리자)",
    customer_order_received: "주문 접수 안내",
    customer_payment_confirmed: "입금 확인 안내",
    customer_shipped: "출고 안내",
    admin_low_stock: "품절 알림(관리자)",
    admin_restock_alert: "재입고 발주 알림(관리자)",
    admin_card_paid: "카드결제 알림(관리자)",
    customer_card_paid: "카드결제 완료 안내",
    customer_virtual_account_issued: "가상계좌 발급 안내",
    customer_auto_cancelled: "자동 취소 안내",
    customer_order_cancelled: "주문 취소 안내",
    admin_card_cancel_failed: "카드 취소 실패 알림(관리자)",
    admin_order_finalize_failed: "주문 확정 실패 알림(관리자)",
    admin_refund_failed: "환불 실패 알림(관리자)",
    admin_login_locked: "로그인 잠김 알림(관리자)",
    admin_settlement_report: "정산 리포트 메일",
    customer_first_purchase_thanks: "첫 구매 감사 쿠폰 안내",
    customer_repeat_purchase_thanks: "재구매 감사 쿠폰 안내",
    customer_restock_notice: "재입고 알림",
    customer_abandoned_cart: "장바구니 리마인드",
    customer_review_request: "리뷰 요청",
    customer_refund_issued: "환불 안내",
    customer_exchange_shipped: "교환 상품 발송 안내",
    customer_qna_answered: "문의 답변 안내",
    admin_backup: "백업 메일",
    // 폰 푸시는 kind 자리에 이동할 탭 이름이 들어간다(lib/push.js)
    orders: "주문 알림",
    returns: "반품·교환 알림",
    inventory: "재고 알림",
    qna: "문의 알림",
    home: "운영 알림",
    systemErrors: "시스템 오류 알림",
    admin_push: "관리자 알림",
  };

  function outboxRowHTML(r) {
    const kindLabel = OUTBOX_KIND_LABEL[r.kind] ? t(OUTBOX_KIND_LABEL[r.kind]) : r.kind || "-";
    const channelLabel = OUTBOX_CHANNEL_LABEL[r.channel] ? t(OUTBOX_CHANNEL_LABEL[r.channel]) : r.channel;
    return `
      <div class="panel" data-id="${esc(r.id)}" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <b title="${esc(r.kind)}">${esc(kindLabel)}</b>
          <span class="small" style="color:var(--text-muted);margin-left:6px">${esc(channelLabel)}</span>
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
