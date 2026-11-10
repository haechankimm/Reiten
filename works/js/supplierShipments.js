  /* ---------- 공급처 입고·배송 (2026-11-10, 마이그레이션 048) ----------
     비서 에이전트(피클)가 공급처(프린트캔버스·나염·원단 도매 등) 출고 메일에서 뽑아 POST /api/bot/supplier-shipments로 기록한 송장을
     재고 탭 맨 위에 보여준다. 물건을 받으면 "입고 완료"를 눌러 목록에서 뺀다(PATCH, 재고 탭 "보기+수정" 권한).
     품목·공급처명은 외부 메일에서 온 글이라 반드시 esc()로만 넣는다. */
  const SUPPLIER_STATUS_LABEL = { SHIPPED: "출고", IN_TRANSIT: "배송중", DELIVERED: "배송완료", RECEIVED: "입고 완료", CANCELED: "취소" };
  const SUPPLIER_STATUS_CLASS = { SHIPPED: "st-pending", IN_TRANSIT: "st-shipping", DELIVERED: "st-confirmed", RECEIVED: "st-done", CANCELED: "st-neutral" };

  function supplierShipmentRowHTML(s, editable) {
    const carrier = s.carrierName || s.carrierCode;
    const tracking = s.trackingUrl
      ? `<a href="${esc(s.trackingUrl)}" target="_blank" rel="noopener noreferrer" class="tnum">${esc(s.trackingNumber)}</a>`
      : `<span class="tnum">${esc(s.trackingNumber)}</span>`;
    const canReceive = editable && s.status !== "RECEIVED" && s.status !== "CANCELED";
    return `
      <div data-id="${esc(s.id)}" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border)">
        <div style="flex:1;min-width:220px">
          <span class="status-chip ${SUPPLIER_STATUS_CLASS[s.status] || "st-neutral"}">${esc(t(SUPPLIER_STATUS_LABEL[s.status] || s.status))}</span>
          <b style="margin-left:6px">${esc(s.supplierName)}</b>
          ${s.supplierOrderId ? `<span style="color:var(--text-muted);margin-left:6px" class="tnum">${esc(s.supplierOrderId)}</span>` : ""}
          ${s.itemsSummary ? `<div style="margin-top:2px">${esc(s.itemsSummary)}</div>` : ""}
          <div style="color:var(--text-muted);margin-top:2px">${esc(carrier)} · ${tracking} · ${fmtDate(s.shippedAt || s.createdAt)}</div>
        </div>
        ${canReceive ? `<button type="button" class="btn btn--sm supplier-receive">${esc(t("입고 완료"))}</button>` : ""}
      </div>`;
  }

  async function paintSupplierShipments() {
    const list = el("supplier-shipments-list");
    if (!list) return;
    const filter = el("supplier-shipments-filter").value;
    const res = await adminFetch(`/api/admin/supplier-shipments?status=${encodeURIComponent(filter)}`);
    if (!res) return;
    if (res.migrationMissing) {
      list.innerHTML = `<p>${esc(t("DB 마이그레이션 048을 실행하면 공급처 출고 송장이 여기에 자동으로 쌓입니다."))}</p>`;
      return;
    }
    const editable = !adminMe || canEdit("inventory");
    list.innerHTML = res.items.length
      ? res.items.map((s) => supplierShipmentRowHTML(s, editable)).join("")
      : `<p style="color:var(--text-muted)">${esc(t("표시할 공급처 배송이 없습니다"))}</p>`;
  }

  el("supplier-shipments-filter")?.addEventListener("change", paintSupplierShipments);
  el("supplier-shipments-list")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".supplier-receive");
    if (!btn) return;
    const id = btn.closest("[data-id]").dataset.id;
    btn.disabled = true;
    const res = await adminFetch(`/api/admin/supplier-shipments/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: "RECEIVED" }) });
    if (!res) { btn.disabled = false; return; }
    toast(t("입고 완료로 표시했습니다"));
    paintSupplierShipments();
  });
