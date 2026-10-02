  /* ---------- 환불 처리(반품 환불·출고 전 부분 취소) / 교환 재발송 / 회수 상품 재고 복원 ----------
     2026-10-02 — 반품 탭에서 "완료"만 누르면 무조건 전액 환불되던 구조를 없애고, 이 창에서 ① 환불할 상품·수량
     ② 귀책(고객 단순변심 / 판매자 불량·오배송) ③ 반품 배송비 ④ 재고 복원 여부를 고른 뒤, 서버가 계산한 금액
     (상품 환불액·배송비·적립금 반환·적립 포인트 회수)을 확인하고 한 번 더 확인해야 실행된다. 금액 계산은 전부
     서버(lib/refunds.js)가 하고 이 화면은 미리보기만 보여준다. */
  function refundOverlay(innerHTML) {
    const overlay = document.createElement("div");
    overlay.className = "dlg-overlay";
    overlay.innerHTML = `<div class="dlg-card dlg-card--wide">${innerHTML}</div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function refundMethodText(method) {
    if (method === "card") return t("카드 결제 부분 취소로 자동 환불");
    if (method === "bank_manual") return t("무통장입금 — 고객 계좌로 직접 송금 필요");
    if (method === "virtual_account_manual") return t("가상계좌 — 고객 계좌로 직접 송금 필요");
    return t("환불할 금액 없음");
  }

  function previewHTML(p) {
    const rows = [
      [t("상품 환불액"), money(p.goodsRefund)],
      p.shippingRefund ? [t("배송비 환불"), money(p.shippingRefund)] : null,
      p.shippingDeduction ? [t("반품 배송비 차감"), "−" + money(p.shippingDeduction)] : null,
      [t("최종 환불 금액"), `<b>${money(p.refundCash)}</b>`],
    ].filter(Boolean);
    const earnShare = p.hasAccount && p.pointsEarned ? Math.round(p.pointsEarned * (p.isAllRemaining ? 1 : p.ratio)) : 0;
    return `
      <div class="refund-preview">
        ${rows.map(([k, v]) => `<div class="refund-row"><span>${esc(k)}</span><span class="tnum">${v}</span></div>`).join("")}
        <p class="small" style="margin:8px 0 0;color:var(--text-muted)">${esc(refundMethodText(p.refundCash > 0 ? (p.paymentMethod === "card" ? "card" : p.paymentMethod === "virtual_account" ? "virtual_account_manual" : "bank_manual") : "none"))}</p>
        ${p.pointsRestore ? `<p class="small" style="margin:6px 0 0">${esc(t("고객이 쓴 적립금 {n}P를 돌려줍니다", { n: p.pointsRestore.toLocaleString("ko-KR") }))}</p>` : ""}
        ${earnShare ? `<p class="small" style="margin:6px 0 0;color:var(--danger)">${esc(t("이 상품 몫의 적립 포인트 약 {n}P는 회수됩니다(구매확정 전이면 적립 예정액에서 빠집니다)", { n: earnShare.toLocaleString("ko-KR") }))}</p>` : ""}
        ${p.refundedSoFar ? `<p class="small" style="margin:6px 0 0;color:var(--text-muted)">${esc(t("이미 환불한 금액 {n} · 최대 {max}까지 환불 가능", { n: money(p.refundedSoFar), max: money(p.maxRefundable) }))}</p>` : ""}
      </div>`;
  }

  /* kind: "return"(반품 환불) | "partial_cancel"(출고 전 부분 취소). returnId가 있으면 그 반품 신청이 같이 완료된다. */
  async function openRefundDialog({ orderNo, kind, returnId = null, onDone }) {
    const info = await adminFetch(`/api/admin/orders/${encodeURIComponent(orderNo)}/refunds`);
    if (!info) return;
    const isReturn = kind === "return";
    const refundable = info.lines.filter((ln) => ln.remaining > 0);
    if (!refundable.length) { toast(t("환불할 수 있는 상품이 남아 있지 않습니다")); return; }

    const overlay = refundOverlay(`
      <h3>${esc(isReturn ? t("반품 환불 처리") : t("부분 취소(출고 전)"))} · <span class="tnum">${esc(orderNo)}</span></h3>
      <p class="small" style="color:var(--text-muted)">${esc(isReturn ? t("돌려받은 상품과 수량을 고르세요. 금액은 서버가 계산합니다.") : t("취소할 상품과 수량을 고르세요. 남은 상품은 그대로 출고합니다."))}</p>
      ${info.migrationMissing ? `<p class="small" style="color:var(--danger)">${esc(t("DB 마이그레이션 043이 아직 실행되지 않아 환불 이력이 저장되지 않습니다. 부분 환불을 여러 번 나눠 하기 전에 실행해 주세요."))}</p>` : ""}
      <div class="refund-lines">
        ${refundable.map((ln) => `
          <label class="refund-line">
            <span>${esc(ln.name)}${ln.options ? ` <span class="small" style="color:var(--text-muted)">(${esc(ln.options)})</span>` : ""}<br>
              <span class="small tnum" style="color:var(--text-muted)">${money(ln.unit)} · ${esc(t("남은 수량 {n}개", { n: ln.remaining }))}</span></span>
            <select data-index="${ln.index}">
              ${Array.from({ length: ln.remaining + 1 }, (_, q) => `<option value="${q}" ${q === (isReturn ? ln.remaining : 0) ? "selected" : ""}>${q}</option>`).join("")}
            </select>
          </label>`).join("")}
      </div>
      ${isReturn ? `
      <div class="refund-opts">
        <label><input type="radio" name="rf-fault" value="customer" checked> ${esc(t("고객 사유(단순변심) — 반품 배송비 차감"))}</label>
        <label><input type="radio" name="rf-fault" value="seller"> ${esc(t("판매자 사유(불량·오배송) — 차감 없음"))}</label>
        <div class="field" style="margin-top:8px">
          <label for="rf-deduction">${esc(t("반품 배송비 차감액(비우면 자동)"))}</label>
          <input id="rf-deduction" type="number" min="0" step="500" inputmode="numeric">
        </div>
      </div>` : ""}
      <label class="refund-opts"><input type="checkbox" id="rf-restock" checked> ${esc(t("고른 상품 재고 복원"))}</label>
      <div class="field">
        <label for="rf-amount">${esc(t("최종 환불 금액 직접 입력(비우면 계산값)"))}</label>
        <input id="rf-amount" type="number" min="0" step="100" inputmode="numeric">
      </div>
      <div id="rf-preview"><p class="small">${esc(t("불러오는 중…"))}</p></div>
      <p class="err" id="rf-err"></p>
      <div class="dlg-actions">
        <button type="button" class="btn btn--ghost" id="rf-cancel">${esc(t("닫기"))}</button>
        <button type="button" class="btn" id="rf-run">${esc(isReturn ? t("환불 실행") : t("부분 취소 실행"))}</button>
      </div>`);

    const close = () => overlay.remove();
    overlay.querySelector("#rf-cancel").addEventListener("click", close);
    const errEl = overlay.querySelector("#rf-err");

    function currentParams() {
      const lines = [...overlay.querySelectorAll("select[data-index]")]
        .map((sel) => ({ index: Number(sel.dataset.index), qty: Number(sel.value) }))
        .filter((ln) => ln.qty > 0);
      const fault = overlay.querySelector('input[name="rf-fault"]:checked')?.value || "seller";
      const ded = overlay.querySelector("#rf-deduction")?.value ?? "";
      return { orderNo, kind, lines, fault, shippingDeduction: ded === "" ? undefined : Number(ded) };
    }

    let lastPreview = null;
    let seq = 0;
    async function refreshPreview() {
      const params = currentParams();
      const box = overlay.querySelector("#rf-preview");
      errEl.classList.remove("on");
      if (!params.lines.length) { box.innerHTML = `<p class="small">${esc(t("환불할 상품과 수량을 골라 주세요."))}</p>`; lastPreview = null; return; }
      const my = ++seq;
      const token = await getAccessToken();
      const res = await fetch("/api/admin/refunds/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(params),
      });
      const body = await res.json().catch(() => ({}));
      if (my !== seq) return; // 더 최근 요청이 있으면 무시
      if (!res.ok) { box.innerHTML = ""; errEl.textContent = serverMsg(body, t("미리보기에 실패했습니다")); errEl.classList.add("on"); lastPreview = null; return; }
      lastPreview = body;
      box.innerHTML = previewHTML(body);
      const ded = overlay.querySelector("#rf-deduction");
      if (ded && ded.value === "") ded.placeholder = String(body.defaultDeduction);
    }
    overlay.querySelectorAll("select, input").forEach((elx) => elx.addEventListener("change", refreshPreview));
    overlay.querySelector("#rf-deduction")?.addEventListener("input", refreshPreview);
    refreshPreview();

    overlay.querySelector("#rf-run").addEventListener("click", async () => {
      if (!lastPreview) { errEl.textContent = t("환불할 상품과 수량을 골라 주세요."); errEl.classList.add("on"); return; }
      const params = currentParams();
      const amountRaw = overlay.querySelector("#rf-amount").value;
      const amount = amountRaw === "" ? lastPreview.refundCash : Number(amountRaw);
      const method = refundMethodText(amount > 0 ? (lastPreview.paymentMethod === "card" ? "card" : lastPreview.paymentMethod === "virtual_account" ? "virtual_account_manual" : "bank_manual") : "none");
      if (!confirm(t("{orderNo} — {amount}을(를) 환불합니다.\n{method}\n되돌릴 수 없습니다. 진행할까요?", { orderNo, amount: money(amount), method }))) return;
      const btn = overlay.querySelector("#rf-run");
      btn.disabled = true;
      const result = await adminFetch("/api/admin/refunds", {
        method: "POST",
        body: JSON.stringify({ ...params, returnId, amount: amountRaw === "" ? undefined : amount, restock: overlay.querySelector("#rf-restock").checked }),
      });
      btn.disabled = false;
      if (!result) return;
      const r = result.refund;
      if (r.method === "card") toast(t("카드 결제 {amount}을(를) 환불했습니다", { amount: money(r.refund_amount) }));
      else if (r.method === "bank_manual" || r.method === "virtual_account_manual") toast(t("처리했습니다 — 고객 계좌로 {amount}을(를) 직접 송금해 주세요", { amount: money(r.refund_amount) }));
      else toast(t("처리했습니다"));
      close();
      if (onDone) onDone(result);
    });
  }

  async function openReshipDialog({ returnId, onDone }) {
    const overlay = refundOverlay(`
      <h3>${esc(t("교환 상품 재발송"))}</h3>
      <p class="small" style="color:var(--text-muted)">${esc(t("새로 보내는 교환 상품의 운송장을 입력하면 고객에게 안내 메일이 갑니다. 환불은 없습니다. 교환으로 나가는 상품의 재고는 재고 탭에서 조정해 주세요."))}</p>
      <div class="field">
        <label for="rs-courier">${esc(t("택배사"))}</label>
        <select id="rs-courier">${COURIERS.map((c) => `<option value="${esc(c.key)}">${esc(c.label)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label for="rs-tracking">${esc(t("운송장번호"))}</label>
        <input id="rs-tracking" type="text" inputmode="numeric" autocomplete="off">
      </div>
      <p class="err" id="rs-err"></p>
      <div class="dlg-actions">
        <button type="button" class="btn btn--ghost" id="rs-cancel">${esc(t("닫기"))}</button>
        <button type="button" class="btn" id="rs-run">${esc(t("재발송 저장"))}</button>
      </div>`);
    overlay.querySelector("#rs-cancel").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#rs-run").addEventListener("click", async () => {
      const trackingNo = overlay.querySelector("#rs-tracking").value.trim();
      if (!trackingNo) { const e = overlay.querySelector("#rs-err"); e.textContent = t("운송장번호를 입력해 주세요."); e.classList.add("on"); return; }
      const result = await adminFetch(`/api/admin/returns/${encodeURIComponent(returnId)}/reship`, {
        method: "POST",
        body: JSON.stringify({ courier: overlay.querySelector("#rs-courier").value, trackingNo }),
      });
      if (!result) return;
      toast(t("교환 상품 재발송을 저장했습니다"));
      overlay.remove();
      if (onDone) onDone(result);
    });
  }

  /* 교환·반품으로 돌아온 상품 중 일부만 재고에 되돌릴 때 */
  async function openRestockLinesDialog({ orderNo, returnId, onDone }) {
    const info = await adminFetch(`/api/admin/orders/${encodeURIComponent(orderNo)}/refunds`);
    if (!info) return;
    const overlay = refundOverlay(`
      <h3>${esc(t("회수 상품 재고 복원"))}</h3>
      <p class="small" style="color:var(--text-muted)">${esc(t("돌아온 상품과 수량만 재고에 더합니다."))}</p>
      <div class="refund-lines">
        ${info.lines.map((ln) => `
          <label class="refund-line">
            <span>${esc(ln.name)}${ln.options ? ` <span class="small" style="color:var(--text-muted)">(${esc(ln.options)})</span>` : ""}</span>
            <select data-index="${ln.index}">${Array.from({ length: ln.qty + 1 }, (_, q) => `<option value="${q}">${q}</option>`).join("")}</select>
          </label>`).join("")}
      </div>
      <div class="dlg-actions">
        <button type="button" class="btn btn--ghost" id="rl-cancel">${esc(t("닫기"))}</button>
        <button type="button" class="btn" id="rl-run">${esc(t("재고 복원"))}</button>
      </div>`);
    overlay.querySelector("#rl-cancel").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#rl-run").addEventListener("click", async () => {
      const lines = [...overlay.querySelectorAll("select[data-index]")].map((s) => ({ index: Number(s.dataset.index), qty: Number(s.value) })).filter((l) => l.qty > 0);
      if (!lines.length) { toast(t("복원할 수량을 골라 주세요")); return; }
      const result = await adminFetch(`/api/admin/returns/${encodeURIComponent(returnId)}/restock`, { method: "POST", body: JSON.stringify({ lines }) });
      if (!result) return;
      toast(t("재고를 복원했습니다"));
      overlay.remove();
      if (onDone) onDone(result);
    });
  }

  /* 주문 상세의 환불·부분취소 이력 */
  function refundHistoryHTML(info) {
    if (!info || !info.history || !info.history.length) return "";
    const kindLabel = { return: t("반품 환불"), partial_cancel: t("부분 취소") };
    return `
      <div class="detail-field" style="margin-top:12px">
        <label>${esc(t("환불 이력"))} · ${esc(t("누적 {n}", { n: money(info.refundedAmount) }))}</label>
        ${info.history.map((h) => `
          <div class="small" style="padding:6px 0;border-bottom:1px solid var(--border)">
            <b>${esc(kindLabel[h.kind] || h.kind)}</b> · ${esc(fmtDate(h.created_at))} · <span class="tnum">${money(h.refund_amount)}</span>
            ${h.shipping_deduction ? ` · ${esc(t("배송비 차감"))} ${money(h.shipping_deduction)}` : ""}
            <br>${esc((h.lines || []).map((l) => `${l.name} × ${l.qty}`).join(", "))}
            ${h.method === "bank_manual" || h.method === "virtual_account_manual" ? `<br><span style="color:var(--danger)">${esc(t("직접 송금 필요"))}</span>` : ""}
          </div>`).join("")}
      </div>`;
  }
