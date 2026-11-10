  /* ---------- 공급처 입고·배송 (2026-11-10, 마이그레이션 048·049) ----------
     비서 에이전트(피클)가 공급처(프린트캔버스·나염·원단 도매 등) 출고 메일에서 뽑아 POST /api/bot/supplier-shipments로 기록한 송장을
     재고 탭 맨 위에 보여준다. 공급처가 늘어도 위 칸에서 공급처별로 골라 볼 수 있다.
     - "배송조회": 스마트택배 키가 있으면 지금 조회해 단계 기록을 펼쳐 보여주고 저장한다(월간 한도 1건 — 사용량은 제목 옆에 표시).
       키가 없거나 스마트택배가 모르는 택배사면 송장번호 링크(택배사 조회 화면)로 직접 본다.
     - "입고 완료": 물건을 받으면 눌러 목록에서 뺀다(PATCH, 재고 탭 "보기+수정" 권한).
     품목·공급처명·배송 단계는 외부에서 온 글이라 반드시 esc()로만 넣는다. */
  const SUPPLIER_STATUS_LABEL = { SHIPPED: "출고", IN_TRANSIT: "배송중", DELIVERED: "배송완료", RECEIVED: "입고 완료", CANCELED: "취소" };
  const SUPPLIER_STATUS_CLASS = { SHIPPED: "st-pending", IN_TRANSIT: "st-shipping", DELIVERED: "st-confirmed", RECEIVED: "st-done", CANCELED: "st-neutral" };
  const supplierState = { trackingEnabled: false, items: new Map() };

  function supplierEventsHTML(s) {
    if (!s.trackingEvents || !s.trackingEvents.length) return "";
    return `<div class="supplier-events" hidden style="margin-top:6px;padding-left:10px;border-left:2px solid var(--border)">${s.trackingEvents
      .slice()
      .reverse()
      .map((e) => `<div class="tnum">${esc(e.at)} · ${esc(e.kind)}${e.where ? ` · ${esc(e.where)}` : ""}</div>`)
      .join("")}</div>`;
  }

  function supplierShipmentRowHTML(s, editable) {
    const carrier = s.carrierName || s.carrierCode;
    const tracking = s.trackingUrl
      ? `<a href="${esc(s.trackingUrl)}" target="_blank" rel="noopener noreferrer" class="tnum">${esc(s.trackingNumber)}</a>`
      : `<span class="tnum">${esc(s.trackingNumber)}</span>`;
    const open = s.status !== "RECEIVED" && s.status !== "CANCELED";
    const lastCheck = s.trackingCheckedAt
      ? `<div style="color:var(--text-muted);margin-top:2px">${esc(t("마지막 배송조회"))} ${fmtDate(s.trackingCheckedAt)}${s.trackingStatus ? ` · ${esc(s.trackingStatus)}` : ""}${s.trackingError ? ` · <span style="color:var(--danger)">${esc(s.trackingError)}</span>` : ""}</div>`
      : "";
    return `
      <div data-id="${esc(s.id)}" style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border)">
        <div style="flex:1;min-width:220px">
          <span class="status-chip ${SUPPLIER_STATUS_CLASS[s.status] || "st-neutral"}">${esc(t(SUPPLIER_STATUS_LABEL[s.status] || s.status))}</span>
          <b style="margin-left:6px">${esc(s.supplierLabel || s.supplierName)}</b>
          ${s.supplierOrderId ? `<span style="color:var(--text-muted);margin-left:6px" class="tnum">${esc(s.supplierOrderId)}</span>` : ""}
          ${s.itemsSummary ? `<div style="margin-top:2px">${esc(s.itemsSummary)}</div>` : ""}
          <div style="color:var(--text-muted);margin-top:2px">${esc(carrier)} · ${tracking} · ${fmtDate(s.shippedAt || s.createdAt)}</div>
          ${lastCheck}
          ${supplierEventsHTML(s)}
        </div>
        <div style="display:flex;gap:6px">
          ${s.trackingEvents && s.trackingEvents.length ? `<button type="button" class="btn btn--sm btn--ghost supplier-events-toggle">${esc(t("단계 보기"))}</button>` : ""}
          ${supplierState.trackingEnabled && open && editable ? `<button type="button" class="btn btn--sm btn--ghost supplier-track">${esc(t("배송조회"))}</button>` : ""}
          ${open && editable ? `<button type="button" class="btn btn--sm supplier-receive">${esc(t("입고 완료"))}</button>` : ""}
        </div>
      </div>`;
  }

  function paintSupplierFilter(suppliers) {
    const sel = el("supplier-shipments-supplier");
    const cur = sel.value;
    sel.innerHTML =
      `<option value="">${esc(t("모든 공급처"))}</option>` +
      suppliers.map((p) => `<option value="${esc(p.name)}">${esc(p.label || p.name)}${p.open ? ` (${p.open})` : ""}</option>`).join("");
    sel.value = suppliers.some((p) => p.name === cur) ? cur : "";
  }

  async function paintSupplierShipments() {
    const list = el("supplier-shipments-list");
    if (!list) return;
    const params = new URLSearchParams({ status: el("supplier-shipments-filter").value });
    if (el("supplier-shipments-supplier").value) params.set("supplier", el("supplier-shipments-supplier").value);
    const res = await adminFetch(`/api/admin/supplier-shipments?${params}`);
    if (!res) return;
    if (res.migrationMissing) {
      list.innerHTML = `<p>${esc(t("DB 마이그레이션 048을 실행하면 공급처 출고 송장이 여기에 자동으로 쌓입니다."))}</p>`;
      return;
    }
    supplierState.trackingEnabled = !!res.trackingEnabled;
    supplierState.items = new Map(res.items.map((s) => [s.id, s]));
    paintSupplierFilter(res.suppliers || []);
    const u = res.trackingUsage;
    el("supplier-tracking-usage").textContent = u ? t("배송조회 이번 달 {a}/{b}건 사용").replace("{a}", u.calls).replace("{b}", u.limit) : "";
    const editable = !adminMe || canEdit("inventory");
    list.innerHTML = res.items.length
      ? res.items.map((s) => supplierShipmentRowHTML(s, editable)).join("")
      : `<p style="color:var(--text-muted)">${esc(t("표시할 공급처 배송이 없습니다"))}</p>`;
  }

  el("supplier-shipments-filter")?.addEventListener("change", paintSupplierShipments);
  el("supplier-shipments-supplier")?.addEventListener("change", paintSupplierShipments);
  el("supplier-shipments-list")?.addEventListener("click", async (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".supplier-events-toggle")) {
      const box = row.querySelector(".supplier-events");
      if (box) box.hidden = !box.hidden;
      return;
    }
    const trackBtn = e.target.closest(".supplier-track");
    if (trackBtn) {
      trackBtn.disabled = true;
      const res = await adminFetch(`/api/admin/supplier-shipments/${encodeURIComponent(id)}/track`, { method: "POST" });
      if (!res) { trackBtn.disabled = false; return; }
      if (res.lookupError) toast(res.lookupError);
      const editable = !adminMe || canEdit("inventory");
      row.outerHTML = supplierShipmentRowHTML(res.shipment, editable);
      const box = el("supplier-shipments-list").querySelector(`[data-id="${CSS.escape(id)}"] .supplier-events`);
      if (box) box.hidden = false;
      return;
    }
    const btn = e.target.closest(".supplier-receive");
    if (!btn) return;
    btn.disabled = true;
    const res = await adminFetch(`/api/admin/supplier-shipments/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: "RECEIVED" }) });
    if (!res) { btn.disabled = false; return; }
    toast(t("입고 완료로 표시했습니다"));
    paintSupplierShipments();
  });
