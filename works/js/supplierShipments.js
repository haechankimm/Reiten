  /* ---------- 공급처 입고·배송 (2026-11-10, 마이그레이션 048·049) ----------
     실시간 에이전트 AI가 공급처(프린트캔버스·나염·원단 도매 등) 출고 메일에서 뽑아 POST /api/bot/supplier-shipments로 기록한 송장을
     재고 탭 맨 위에 보여준다. 공급처가 늘어도 위 칸에서 공급처별로 골라 볼 수 있다.
     - "배송조회": 스마트택배 키가 있으면 지금 조회해 단계 기록을 펼쳐 보여주고 저장한다(월간 한도 1건 — 사용량은 제목 옆에 표시).
       키가 없거나 스마트택배가 모르는 택배사면 송장번호 링크(택배사 조회 화면)로 직접 본다.
     - "입고 처리"(2026-11-10): 물건을 받으면 품목(실시간 에이전트 AI가 메일에서 미리 채운 초안)을 확인·수정해 재고에 더하고 입고 완료로 바꾼다
       (POST /receive). 재고에 안 더하고 입고 완료만 할 수도 있다. 배송조회는 기본적으로 실시간 에이전트 AI가 공식 조회 화면을 보고 기록한다.
     품목·공급처명·배송 단계는 외부에서 온 글이라 반드시 esc()로만 넣는다. */
  const SUPPLIER_STATUS_LABEL = { SHIPPED: "출고", IN_TRANSIT: "배송중", DELIVERED: "배송완료", RECEIVED: "입고 완료", CANCELED: "취소" };
  const SUPPLIER_STATUS_CLASS = { SHIPPED: "st-pending", IN_TRANSIT: "st-shipping", DELIVERED: "st-confirmed", RECEIVED: "st-done", CANCELED: "st-neutral" };
  const supplierState = { trackingEnabled: false, items: new Map(), products: null };

  async function supplierProducts() {
    if (supplierState.products) return supplierState.products;
    const res = await adminFetchAll("/api/admin/products");
    supplierState.products = res ? res.items.filter((p) => (p.colors || []).length && (p.sizes || []).length) : [];
    return supplierState.products;
  }

  function receiptRowHTML(it, products) {
    const p = products.find((x) => x.id === it.productId);
    const colors = p ? p.colors : [];
    const sizes = p ? p.sizes : [];
    return `
      <div class="receipt-row" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px">
        ${it.name ? `<span style="color:var(--text-muted);min-width:120px">${esc(t("메일 품목"))}: ${esc(it.name)}</span>` : ""}
        <select class="receipt-product"><option value="">${esc(t("상품 선택"))}</option>${products.map((x) => `<option value="${esc(x.id)}" ${x.id === it.productId ? "selected" : ""}>${esc(x.nameKo || x.name || x.id)}</option>`).join("")}</select>
        <select class="receipt-color">${colors.map((c) => `<option value="${esc(c)}" ${c === it.color ? "selected" : ""}>${esc(t((COLORS[c] && COLORS[c].label) || c))}</option>`).join("")}</select>
        <select class="receipt-size">${sizes.map((z) => `<option value="${esc(z)}" ${z === it.size ? "selected" : ""}>${esc(z)}</option>`).join("")}</select>
        <input type="number" class="receipt-qty" min="1" max="100000" value="${esc(it.qty || 1)}" style="width:80px">
        <button type="button" class="btn btn--sm btn--ghost receipt-remove">${esc(t("삭제"))}</button>
      </div>`;
  }

  async function openReceiveForm(row, s) {
    if (row.querySelector(".receipt-form")) return;
    const products = await supplierProducts();
    const draft = s.receiptItems && s.receiptItems.length ? s.receiptItems : [{ qty: 1 }];
    const form = document.createElement("div");
    form.className = "receipt-form";
    form.style.cssText = "flex-basis:100%;margin-top:8px;padding:10px;border:1px dashed var(--border);border-radius:8px";
    form.innerHTML = `
      <div>${esc(t("받은 품목을 확인하세요. 재고에 더하고 입고 완료를 누르면 재고 수량이 늘어납니다."))}</div>
      <div class="receipt-rows">${draft.map((it) => receiptRowHTML(it, products)).join("")}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        <button type="button" class="btn btn--sm btn--ghost receipt-add">${esc(t("품목 추가"))}</button>
        <button type="button" class="btn btn--sm receipt-submit">${esc(t("재고에 더하고 입고 완료"))}</button>
        <button type="button" class="btn btn--sm btn--ghost receipt-only">${esc(t("재고 반영 없이 입고 완료"))}</button>
        <button type="button" class="btn btn--sm btn--ghost receipt-cancel">${esc(t("닫기"))}</button>
      </div>`;
    row.appendChild(form);
  }

  function collectReceiptItems(form) {
    const items = [];
    for (const r of form.querySelectorAll(".receipt-row")) {
      const productId = r.querySelector(".receipt-product").value;
      const color = r.querySelector(".receipt-color").value;
      const size = r.querySelector(".receipt-size").value;
      const qty = Math.floor(Number(r.querySelector(".receipt-qty").value));
      if (!productId || !color || !size || !(qty > 0)) return null;
      items.push({ productId, color, size, qty });
    }
    return items;
  }

  async function submitReceive(row, id, items) {
    const res = await adminFetch(`/api/admin/supplier-shipments/${encodeURIComponent(id)}/receive`, { method: "POST", body: JSON.stringify({ items }) });
    if (!res) return false;
    toast(res.addedToInventory ? t("재고에 반영하고 입고 완료로 표시했습니다") : t("입고 완료로 표시했습니다"));
    if (res.addedToInventory && typeof paintAdminInventory === "function") paintAdminInventory();
    else paintSupplierShipments();
    return true;
  }

  function supplierEventsHTML(s) {
    if (!s.trackingEvents || !s.trackingEvents.length) return "";
    // 최신 단계가 맨 위(보내온 순서와 상관없이 시각으로 정렬)
    return `<div class="supplier-events" id="supplier-events-${esc(s.id)}" hidden style="margin-top:6px;padding-left:10px;border-left:2px solid var(--border)">${s.trackingEvents
      .slice()
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
      .map((e) => `<div class="tnum">${esc(e.at)} · ${esc(e.kind)}${e.where ? ` · ${esc(e.where)}` : ""}</div>`)
      .join("")}</div>`;
  }

  /* 입고 품목 한 줄 — 상품 id·색상 key 대신 사람이 읽는 이름으로 */
  function receiptItemLabel(it) {
    const p = (supplierState.products || []).find((x) => x.id === it.productId);
    const color = it.color ? t((COLORS[it.color] && COLORS[it.color].label) || it.color) : "";
    return [it.name || (p && (p.nameKo || p.name)) || it.productId || "", color, it.size || ""].filter(Boolean).join(" ") + ` ×${it.qty}`;
  }

  /* 직접 등록·수정 폼(2026-11-11) — AI가 놓친 송장 등록, 잘못 적힌 값 고치기. 상태도 사람이 바꿀 수 있다(재고 반영된 입고는 "입고 취소"로). */
  function shipmentFormHTML(s) {
    const isEdit = !!s;
    const v = s || {};
    const carriers = supplierState.carriers || [];
    const knownCarrier = carriers.some((c) => c.id === v.carrierCode);
    const date = (iso) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : "");
    return `
      <div class="shipment-form mini-form">
        <label>${esc(t("공급처 이름"))}<input class="sf-supplier-label" value="${esc(v.supplierLabel || "")}" placeholder="${esc(t("예: 프린트캔버스"))}"></label>
        <label>${esc(t("공급처 식별자(영문)"))}<input class="sf-supplier-name" value="${esc(v.supplierName || "")}" placeholder="printcanvas" ${isEdit ? "" : "required"}></label>
        <label>${esc(t("택배사"))}<select class="sf-carrier">
          ${carriers.map((c) => `<option value="${esc(c.id)}" ${c.id === v.carrierCode ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
          <option value="etc" ${isEdit && !knownCarrier ? "selected" : ""}>${esc(t("기타(직접 입력)"))}</option>
        </select></label>
        <label>${esc(t("택배사 이름(기타일 때)"))}<input class="sf-carrier-name" value="${esc(!knownCarrier ? v.carrierName || "" : "")}"></label>
        <label>${esc(t("송장번호"))}<input class="sf-tracking" value="${esc(v.trackingNumber || "")}" inputmode="numeric"></label>
        <label>${esc(t("공급처 주문번호"))}<input class="sf-order" value="${esc(v.supplierOrderId || "")}"></label>
        <label class="mini-form-wide">${esc(t("품목 요약"))}<input class="sf-items" value="${esc(v.itemsSummary || "")}" placeholder="${esc(t("예: 오버핏 후드(차콜) XL 10벌"))}"></label>
        <label>${esc(t("출고일"))}<input type="date" class="sf-shipped" value="${esc(date(v.shippedAt))}"></label>
        ${isEdit ? `<label>${esc(t("상태"))}<select class="sf-status">${Object.keys(SUPPLIER_STATUS_LABEL).map((k) => `<option value="${k}" ${k === v.status ? "selected" : ""}>${esc(t(SUPPLIER_STATUS_LABEL[k]))}</option>`).join("")}</select></label>` : ""}
        <div class="mini-form-actions">
          <button type="button" class="btn btn--sm sf-save">${esc(t(isEdit ? "저장" : "등록"))}</button>
          <button type="button" class="btn btn--sm btn--ghost sf-cancel">${esc(t("닫기"))}</button>
          ${isEdit ? `<span class="small" style="color:var(--text-muted);align-self:center">${esc(t("바꾸기 전 값은 활동 로그에 남습니다."))}</span>` : ""}
        </div>
      </div>`;
  }

  function readShipmentForm(form) {
    const carrier = form.querySelector(".sf-carrier").value;
    const body = {
      supplierLabel: form.querySelector(".sf-supplier-label").value.trim(),
      supplierName: form.querySelector(".sf-supplier-name").value.trim() || undefined,
      carrierCode: carrier === "etc" ? undefined : carrier,
      carrierName: carrier === "etc" ? form.querySelector(".sf-carrier-name").value.trim() : undefined,
      trackingNumber: form.querySelector(".sf-tracking").value.trim(),
      supplierOrderId: form.querySelector(".sf-order").value.trim(),
      itemsSummary: form.querySelector(".sf-items").value.trim(),
    };
    const d = form.querySelector(".sf-shipped").value;
    if (d) body.shippedAt = `${d}T12:00:00+09:00`;
    const st = form.querySelector(".sf-status");
    if (st) body.status = st.value;
    return body;
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
          ${s.receiptItems && s.receiptItems.length ? `<div style="color:var(--text-muted);margin-top:2px">${esc(t("입고 품목"))}: ${s.receiptItems.map((it) => esc(receiptItemLabel(it))).join(", ")}</div>` : ""}
          ${supplierEventsHTML(s)}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${s.trackingEvents && s.trackingEvents.length ? `<button type="button" class="btn btn--sm btn--ghost supplier-events-toggle" aria-expanded="false" aria-controls="supplier-events-${esc(s.id)}">${esc(t("배송 단계"))} ${s.trackingEvents.length} ▾</button>` : ""}
          ${supplierState.trackingEnabled && open && editable ? `<button type="button" class="btn btn--sm btn--ghost supplier-track">${esc(t("배송조회"))}</button>` : ""}
          ${editable ? `<button type="button" class="btn btn--sm btn--ghost supplier-edit">${esc(t("수정"))}</button>` : ""}
          ${open && editable ? `<button type="button" class="btn btn--sm supplier-receive">${esc(t("입고 처리"))}</button>` : ""}
          ${s.status === "RECEIVED" && editable ? `<button type="button" class="btn btn--sm btn--ghost supplier-receive-undo" title="${esc(t("입고 처리를 되돌립니다. 재고에 더한 수량도 다시 뺍니다."))}">${esc(t("입고 취소"))}</button>` : ""}
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
    supplierState.carriers = res.carriers || [];
    // 입고 품목을 상품 이름으로 보여주려면 상품 목록이 먼저 필요하다(처음 한 번만 받아 두고 재사용)
    if (!supplierState.products && res.items.some((x) => (x.receiptItems || []).some((it) => it.productId))) await supplierProducts().catch(() => {});
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
    const toggle = e.target.closest(".supplier-events-toggle");
    if (toggle) {
      const box = row.querySelector(".supplier-events");
      if (!box) return;
      box.hidden = !box.hidden;
      toggle.setAttribute("aria-expanded", String(!box.hidden));
      const n = (supplierState.items.get(id)?.trackingEvents || []).length;
      toggle.textContent = `${t(box.hidden ? "배송 단계" : "단계 접기")} ${box.hidden ? n + " ▾" : "▴"}`;
      return;
    }
    if (e.target.closest(".supplier-edit")) {
      if (!row.querySelector(".shipment-form")) row.insertAdjacentHTML("beforeend", shipmentFormHTML(supplierState.items.get(id)));
      return;
    }
    if (e.target.closest(".supplier-receive-undo")) {
      const s = supplierState.items.get(id) || {};
      const msg = s.inventoryApplied && s.inventoryApplied.length
        ? t("입고를 취소하고 재고에서 {n}개를 다시 뺄까요?").replace("{n}", s.inventoryApplied.reduce((a, it) => a + it.qty, 0))
        : t("입고를 취소하고 배송완료 상태로 되돌릴까요?");
      if (!confirm(msg)) return;
      const r = s.inventoryApplied && s.inventoryApplied.length
        ? await adminFetch(`/api/admin/supplier-shipments/${encodeURIComponent(id)}/receive/undo`, { method: "POST" })
        : await adminFetch(`/api/admin/supplier-shipments/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: "DELIVERED" }) });
      if (!r) return;
      toast(t("입고를 취소했습니다"));
      if (typeof paintAdminInventory === "function" && r.removedFromInventory) paintAdminInventory();
      else paintSupplierShipments();
      return;
    }
    const sform = row.querySelector(".shipment-form");
    if (sform && e.target.closest(".sf-cancel")) { sform.remove(); return; }
    if (sform && e.target.closest(".sf-save")) {
      const btn = e.target.closest(".sf-save");
      btn.disabled = true;
      const r = await adminFetch(`/api/admin/supplier-shipments/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(readShipmentForm(sform)) });
      btn.disabled = false;
      if (!r) return;
      toast(r.unchanged ? t("바뀐 내용이 없습니다") : t("저장했습니다"));
      paintSupplierShipments();
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
    if (e.target.closest(".supplier-receive")) {
      openReceiveForm(row, supplierState.items.get(id) || {});
      return;
    }
    const form = row.querySelector(".receipt-form");
    if (!form) return;
    if (e.target.closest(".receipt-cancel")) { form.remove(); return; }
    if (e.target.closest(".receipt-remove")) { e.target.closest(".receipt-row").remove(); return; }
    if (e.target.closest(".receipt-add")) {
      form.querySelector(".receipt-rows").insertAdjacentHTML("beforeend", receiptRowHTML({ qty: 1 }, await supplierProducts()));
      return;
    }
    const submit = e.target.closest(".receipt-submit");
    const only = e.target.closest(".receipt-only");
    if (!submit && !only) return;
    const items = only ? [] : collectReceiptItems(form);
    if (!items || (submit && !items.length)) { toast(t("모든 품목의 상품·색상·사이즈·수량을 골라 주세요")); return; }
    (submit || only).disabled = true;
    if (!(await submitReceive(row, id, items))) (submit || only).disabled = false;
  });

  /* 상품을 바꾸면 그 상품의 색상·사이즈로 선택지를 바꾼다 */
  el("supplier-shipments-list")?.addEventListener("change", async (e) => {
    const sel = e.target.closest(".receipt-product");
    if (!sel) return;
    const p = (await supplierProducts()).find((x) => x.id === sel.value);
    const r = sel.closest(".receipt-row");
    r.querySelector(".receipt-color").innerHTML = (p ? p.colors : []).map((c) => `<option value="${esc(c)}">${esc(t((COLORS[c] && COLORS[c].label) || c))}</option>`).join("");
    r.querySelector(".receipt-size").innerHTML = (p ? p.sizes : []).map((z) => `<option value="${esc(z)}">${esc(z)}</option>`).join("");
  });

  /* "+ 직접 등록" — 목록 위에 빈 폼을 연다 */
  el("supplier-shipments-new")?.addEventListener("click", () => {
    const box = el("supplier-shipments-newform");
    if (box.innerHTML.trim()) { box.innerHTML = ""; return; }
    box.innerHTML = shipmentFormHTML(null);
  });
  el("supplier-shipments-newform")?.addEventListener("click", async (e) => {
    const box = el("supplier-shipments-newform");
    const form = box.querySelector(".shipment-form");
    if (!form) return;
    if (e.target.closest(".sf-cancel")) { box.innerHTML = ""; return; }
    const btn = e.target.closest(".sf-save");
    if (!btn) return;
    const body = readShipmentForm(form);
    if (!body.supplierName && body.supplierLabel) body.supplierName = body.supplierLabel;
    btn.disabled = true;
    const r = await adminFetch("/api/admin/supplier-shipments", { method: "POST", body: JSON.stringify(body) });
    btn.disabled = false;
    if (!r) return;
    box.innerHTML = "";
    toast(t("등록했습니다"));
    paintSupplierShipments();
  });
