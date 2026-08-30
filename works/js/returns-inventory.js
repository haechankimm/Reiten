  function returnCardHTML(r) {
    return `
      <div class="panel" data-id="${esc(r.id)}">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline">
          <b class="tnum">${esc(r.orderNo)}</b>
          <span class="small tnum">${fmtDate(r.at)}</span>
        </div>
        <p class="small" style="margin-top:6px">${esc(r.contactName)} · ${esc(r.contactTel)}</p>
        <p style="margin-top:8px">${esc(r.reason)}${r.detail ? " — " + esc(r.detail) : ""}</p>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span class="status-chip admin-return-status-chip ${RETURN_STATUS_CLASS[r.status] || "st-neutral"}">${esc(t(r.status))}</span>
          <select class="admin-return-status">${RETURN_STATUSES.map((s) => `<option value="${s}" ${s === r.status ? "selected" : ""}>${esc(t(s))}</option>`).join("")}</select>
          <button type="button" class="btn btn--sm admin-return-save">${esc(t("저장"))}</button>
          ${
            r.restocked
              ? `<span class="small" style="color:var(--text-muted)">${esc(t("재고 복원 완료"))}</span>`
              : `<button type="button" class="btn btn--sm btn--ghost admin-return-restock">${esc(t("재고 복원"))}</button>`
          }
          ${r.refunded ? `<span class="small" style="color:var(--text-muted)">${esc(t("환불 완료"))}</span>` : ""}
        </div>
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
        btn.disabled = true;
        const result = await adminFetch(`/api/admin/returns/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
        btn.disabled = false;
        if (!result) return;

        /* 저장 버튼을 눌러도 화면이 그대로라 "정말 반영됐는지 알기 어렵다"는 피드백 — 토스트
           문구만 다르고 정작 카드의 상태 뱃지(item.status)는 갱신 안 하던 버그였다. 환불 결과와
           무관하게 상태는 항상 저장된 것이므로, 네 분기 전부 item.status를 갱신하고 다시 그린다. */
        const item = returnsState.items.find((x) => x.id === id);
        if (item) item.status = status;

        if (result.refund?.method === "card" && result.refund.ok) {
          if (item) item.refunded = true;
          toast(t("상태를 저장하고 환불까지 완료했습니다"));
        } else if (result.refund?.method === "card" && !result.refund.ok) {
          toast(t("상태는 저장했지만 환불에 실패했습니다. 포트원에서 직접 확인해 주세요."));
        } else if (result.refund?.method === "bank_manual") {
          toast(t("상태를 저장했습니다. 무통장입금 건이라 계좌로 직접 환불해 주세요."));
        } else {
          toast(t("상태를 저장했습니다"));
        }
        renderAdminReturns();

        /* 다시 그린 뒤 방금 저장한 카드의 뱃지에 잠깐 테두리를 줘서 "여기가 바뀌었다"를
           명확히 보여준다(1.2초 후 자동으로 사라짐). */
        const chip = el("admin-returns-list").querySelector(`[data-id="${CSS.escape(id)}"] .admin-return-status-chip`);
        if (chip) {
          chip.classList.add("status-chip--saved");
          setTimeout(() => chip.classList.remove("status-chip--saved"), 1200);
        }
      })
    );

    el("admin-returns-list").querySelectorAll(".admin-return-restock").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        btn.disabled = true;
        const result = await adminFetch(`/api/admin/returns/${encodeURIComponent(id)}/restock`, { method: "POST" });
        if (!result) { btn.disabled = false; return; }
        const item = returnsState.items.find((x) => x.id === id);
        if (item) item.restocked = true;
        toast(t("재고를 복원했습니다"));
        renderAdminReturns();
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
    return params;
  }

  async function paintAdminReturns(loadMore = false) {
    returnsState.page = loadMore ? returnsState.page + 1 : 1;
    const result = await adminFetch(`/api/admin/returns?${returnsQueryParams().toString()}`);
    if (!result) return;
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
    paintAdminReturns();
  });
  el("ret-reset").addEventListener("click", () => {
    el("ret-q").value = "";
    el("ret-status").value = "";
    el("ret-from").value = "";
    el("ret-to").value = "";
    el("ret-search").click();
  });
  el("ret-q").addEventListener("keydown", (e) => { if (e.key === "Enter") el("ret-search").click(); });

  function invSizeClass(qty) {
    if (qty <= 0) return " inv-size--out";
    if (qty <= 2) return " inv-size--low";
    return "";
  }

  /* 재고는 원래 "상품코드 · 사이즈" 문자열만 한 줄씩 나열해서 8개 상품 x 5사이즈 = 40줄이
     전부 똑같이 생겨 알아보기 힘들었다 — 상품 썸네일·이름으로 카드를 묶고, 그 안에 사이즈별
     수량을 색으로 구분해서(품절=빨강, 2개 이하=주황) 한눈에 훑을 수 있게 바꿨다.
     이미 "상품" 탭에서 불러온 목록(productsState)이 있어도 재고 탭이 상품 탭보다 먼저
     그려질 수 있어(둘 다 로그인 직후 동시에 fetch됨) 여기서 상품 목록을 다시 받아 매칭한다. */
  /* 재고는 이제 상품 × 컬러 × 사이즈 단위다(014_inventory_by_color.sql). 아직 값을 한 번도
     입력하지 않은 조합은 inventory 테이블에 행 자체가 없으므로, 기존 행에서 사이즈를 뽑는 대신
     "상품 등록 폼"에 저장된 컬러·사이즈 목록을 기준으로 입력칸을 전부 만들고, 값이 있으면 채워
     넣는 방식으로 바꿨다 — 그래야 아직 입력 전인 조합도 빈 칸(0)으로 보여 입력할 수 있다. */
  /* 컬러 하나의 사이즈 입력 한 줄(HTML 문자열) — 컬러 칩을 바꿀 때마다 이 한 줄만 다시
     그려 넣는다(카드 전체를 다시 그리지 않음, 그래서 다른 컬러의 입력값도 그대로 유지됨). */
  function invSizeRowHTML(sizes, qtyByColorSize, color) {
    return sizes
      .map((size) => {
        const qty = qtyByColorSize.get(`${color}:${size}`) ?? 0;
        return `
        <div class="inv-size${invSizeClass(qty)}">
          <span class="inv-size-label">${esc(size)}</span>
          <input type="number" min="0" class="admin-inv-qty" data-color="${esc(color)}" data-size="${esc(size)}" value="${qty}">
        </div>`;
      })
      .join("");
  }

  /* 컬러별로 하나라도 품절/재고부족 사이즈가 있으면 칩에 작은 점을 얹어준다 — 카드가 한 번에
     한 컬러 줄만 보여줘도 "이 상품 어디 문제 있나"는 칩만 보고 훑을 수 있게 하기 위함. */
  function invColorStatusClass(sizes, qtyByColorSize, color) {
    let worst = "";
    sizes.forEach((size) => {
      const qty = qtyByColorSize.get(`${color}:${size}`) ?? 0;
      if (qty <= 0) worst = "--out";
      else if (qty <= 2 && worst !== "--out") worst = "--low";
    });
    return worst;
  }

  /* meta.qtyByColorSize가 바뀔 때마다(재고 저장 성공 직후) 그 상품 카드의 컬러 칩 점을
     다시 계산해서 실제 DOM에 반영한다 — 재고를 채웠는데도 빨간 점이 안 사라지던 버그 수정. */
  function refreshColorChipStatuses(card, meta) {
    card.querySelectorAll(".inv-color-chip").forEach((chip) => {
      const color = chip.dataset.color;
      const statusEl = chip.querySelector(".inv-color-chip-status");
      if (!statusEl) return;
      const cls = invColorStatusClass(meta.sizes, meta.qtyByColorSize, color);
      statusEl.className = "inv-color-chip-status" + (cls ? ` inv-color-chip-status${cls}` : "");
      statusEl.hidden = !cls;
    });
  }

  /* 재고는 원래 "상품코드 · 사이즈" 문자열만 한 줄씩 나열해서 8개 상품 x 5사이즈 = 40줄이
     전부 똑같이 생겨 알아보기 힘들었다 — 상품 썸네일·이름으로 카드를 묶고, 그 안에 사이즈별
     수량을 색으로 구분해서(품절=빨강, 2개 이하=주황) 한눈에 훑을 수 있게 바꿨다. 그런데
     컬러 수가 상품마다 달라(1~4개) 전 컬러를 펼쳐 보여주면 카드 높이가 제각각이라 그리드가
     지저분해 보인다는 피드백을 받아, 컬러는 칩으로 고르고 그 컬러의 사이즈 한 줄만 보이도록
     다시 바꿨다(카드 높이가 상품마다 비슷해짐). 컬러 칩에 품절/재고부족 표시 점을 얹어서
     칩을 눌러보지 않고도 문제 있는 컬러를 훑어볼 수 있게 했다.
     이미 "상품" 탭에서 불러온 목록(productsState)이 있어도 재고 탭이 상품 탭보다 먼저
     그려질 수 있어(둘 다 로그인 직후 동시에 fetch됨) 여기서 상품 목록을 다시 받아 매칭한다. */
  /* 재고는 이제 상품 × 컬러 × 사이즈 단위다(014_inventory_by_color.sql). 아직 값을 한 번도
     입력하지 않은 조합은 inventory 테이블에 행 자체가 없으므로, 기존 행에서 사이즈를 뽑는 대신
     "상품 등록 폼"에 저장된 컬러·사이즈 목록을 기준으로 입력칸을 전부 만들고, 값이 있으면 채워
     넣는 방식으로 바꿨다 — 그래야 아직 입력 전인 조합도 빈 칸(0)으로 보여 입력할 수 있다. */
  async function paintAdminInventory() {
    const [rows, productsRes] = await Promise.all([
      adminFetch("/api/admin/inventory"),
      adminFetch("/api/admin/products?pageSize=100"),
    ]);
    if (!rows || !productsRes) return;

    const qtyByProduct = new Map();
    rows.forEach((r) => {
      if (!qtyByProduct.has(r.productId)) qtyByProduct.set(r.productId, new Map());
      qtyByProduct.get(r.productId).set(`${r.color}:${r.size}`, r.qty);
    });

    /* 클릭 핸들러(컬러 칩)가 상품별 sizes/qtyByColorSize를 다시 찾을 수 있도록 보관해둔다. */
    const productMeta = new Map();

    const legend = `
      <div class="inv-legend">
        <span class="inv-legend-item"><i class="inv-legend-dot" style="background:var(--danger)"></i>${esc(t("품절"))}</span>
        <span class="inv-legend-item"><i class="inv-legend-dot" style="background:var(--status-pending-ink)"></i>${esc(t("재고 2개 이하"))}</span>
      </div>`;

    const cards = productsRes.items
      .map((p) => {
        const colors = (p.colors || []).filter((c) => COLORS[c]);
        const sizes = p.sizes || [];
        if (!colors.length || !sizes.length) return "";
        const qtyByColorSize = qtyByProduct.get(p.id) || new Map();
        const img = (p.images || []).find(Boolean);
        productMeta.set(p.id, { sizes, qtyByColorSize });

        const activeColor = colors[0];
        /* 컬러 칩의 품절/부족 표시 점은 처음 그릴 때만 계산하면, 이후 재고를 채워도(전체 적용·
           개별 저장) 칩은 다시 그려지지 않는 사이즈 입력칸과 달리 갱신할 방법이 없어 점이 계속
           남아있는 버그가 있었다. 항상 점(span) 자체는 만들어두고 hidden/클래스만 나중에 JS로
           갱신하는 방식으로 바꿔(아래 refreshColorChipStatuses), 재고를 채우면 점도 같이 사라지게 한다. */
        const colorChips = colors
          .map((c) => `
          <button type="button" class="inv-color-chip" data-color="${esc(c)}" aria-pressed="${c === activeColor}">
            <span class="inv-color-chip-dot" style="background:${esc(COLORS[c].hex)}"></span>
            <span>${esc(t(COLORS[c].label))}</span>
            <span class="inv-color-chip-status" hidden></span>
          </button>`)
          .join("");

        return `
      <div class="inv-card" data-product="${esc(p.id)}">
        <div class="inv-card-head">
          <div class="inv-card-thumb">${img ? `<img src="${esc(img)}" alt="">` : ""}</div>
          <div class="inv-card-name">
            <b>${esc(t(p.nameKo))}</b>
            <span class="small">${esc(p.id)}</span>
          </div>
          <button type="button" class="btn btn--sm btn--ghost inv-log-toggle">${esc(t("이력 보기"))}</button>
        </div>
        <div class="inv-color-chips">${colorChips}</div>
        <div class="inv-card-sizes" data-active-color="${esc(activeColor)}">${invSizeRowHTML(sizes, qtyByColorSize, activeColor)}</div>
        <div class="inv-bulk-qty">
          <input type="number" min="0" class="inv-bulk-qty-input" placeholder="0" title="${esc(t("지금 고른 컬러의 모든 사이즈에 이 수량을 한 번에 적용"))}">
          <button type="button" class="btn btn--sm btn--ghost inv-bulk-qty-apply">${esc(t("전체 적용"))}</button>
        </div>
        <div class="inv-card-log" hidden></div>
      </div>`;
      })
      .join("");

    el("admin-inventory-body").innerHTML =
      legend + `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:12px;align-items:start">${cards}</div>`;

    productMeta.forEach((meta, productId) => {
      const card = el("admin-inventory-body").querySelector(`[data-product="${productId}"]`);
      if (card) refreshColorChipStatuses(card, meta);
    });

    /* 사이즈 입력칸은 컬러 칩을 바꿀 때마다 통째로 새로 그려지므로, 카드 하나당 한 번씩
       리스너를 다시 붙이는 대신 목록 컨테이너에서 이벤트 위임으로 처리한다. */
    el("admin-inventory-body").addEventListener("click", async (e) => {
      const chip = e.target.closest(".inv-color-chip");
      if (chip) {
        const card = chip.closest("[data-product]");
        const meta = productMeta.get(card.dataset.product);
        const color = chip.dataset.color;
        card.querySelectorAll(".inv-color-chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
        const sizesBox = card.querySelector(".inv-card-sizes");
        sizesBox.dataset.activeColor = color;
        sizesBox.innerHTML = invSizeRowHTML(meta.sizes, meta.qtyByColorSize, color);
        return;
      }

      /* 재입고·완전 품절 처리처럼 지금 고른 컬러의 모든 사이즈를 같은 수량으로 한 번에
         맞추는 버튼 — 예전엔 각 입력칸에 값만 넣고 pendingChanges에 쌓아뒀다가 상단 "변경사항
         저장"을 따로 눌러야 했는데, 그 사이 컬러 칩을 바꾸면 sizesBox가 meta.qtyByColorSize
         (아직 저장 전이라 갱신 안 된 값) 기준으로 통째로 다시 그려지면서 방금 적용한 값이
         화면에서 사라지는 버그가 있었다(실제로는 pendingChanges엔 남아있어 저장은 되지만
         컬러를 오가면 눈에는 원래 값으로 돌아온 것처럼 보임). 그래서 이 버튼만은 클릭 즉시
         서버에 저장하고 meta도 바로 갱신해, 컬러를 바꿔도 값이 유지되게 한다. */
      const bulkBtn = e.target.closest(".inv-bulk-qty-apply");
      if (bulkBtn) {
        const card = bulkBtn.closest("[data-product]");
        const input = card.querySelector(".inv-bulk-qty-input");
        const qty = Number(input.value);
        if (!Number.isFinite(qty) || qty < 0) {
          toast(t("0 이상의 숫자를 입력해 주세요."));
          return;
        }
        const productId = card.dataset.product;
        const meta = productMeta.get(productId);
        const sizesBox = card.querySelector(".inv-card-sizes");
        const color = sizesBox.dataset.activeColor;
        const items = meta.sizes.map((size) => ({ productId, color, size, qty }));

        bulkBtn.disabled = true;
        const result = await adminFetch("/api/admin/inventory/bulk", {
          method: "PATCH",
          body: JSON.stringify({ items }),
        });
        bulkBtn.disabled = false;
        if (!result) return;

        items.forEach((it) => {
          meta.qtyByColorSize.set(`${it.color}:${it.size}`, it.qty);
          pendingChanges.delete(`${it.productId}:${it.color}:${it.size}`);
        });
        sizesBox.innerHTML = invSizeRowHTML(meta.sizes, meta.qtyByColorSize, color);
        refreshColorChipStatuses(card, meta);
        updateSaveBtn();
        input.value = "";
        toast(t("{color} 전체 사이즈를 {n}개로 저장했습니다", { color: t(COLORS[color]?.label || color), n: qty }));
      }
    });

    /* 칸을 고칠 때마다 바로 서버에 저장하면(이전 방식) 몇 칸만 고쳐도 토스트가 계속 뜨고
       활동 로그도 항목 수만큼 따로따로 쌓여 지저분했다 — 이제는 입력은 전부 메모리에만
       모아두고(pendingChanges), 상단 "변경사항 저장" 버튼을 눌러야 한 번에 저장하며,
       활동 로그에도 이 저장 한 번이 한 줄로만 남는다(`inventory.bulk_update`). */
    const pendingChanges = new Map();
    const saveBtn = el("inv-save-btn");

    function updateSaveBtn() {
      const n = pendingChanges.size;
      saveBtn.disabled = n === 0;
      saveBtn.textContent = n ? t("변경사항 저장 ({n}건)", { n }) : t("변경사항 저장");
    }
    updateSaveBtn();

    el("admin-inventory-body").addEventListener("change", (e) => {
      const input = e.target.closest(".admin-inv-qty");
      if (!input) return;
      const card = input.closest("[data-product]");
      const box = input.closest(".inv-size");
      const qty = Number(input.value);
      const productId = card.dataset.product;
      const color = input.dataset.color;
      const size = input.dataset.size;
      pendingChanges.set(`${productId}:${color}:${size}`, { productId, color, size, qty });
      box.className = "inv-size" + invSizeClass(qty);
      updateSaveBtn();
    });

    saveBtn.onclick = async () => {
      if (!pendingChanges.size) return;
      const items = [...pendingChanges.values()];
      saveBtn.disabled = true;
      const result = await adminFetch("/api/admin/inventory/bulk", {
        method: "PATCH",
        body: JSON.stringify({ items }),
      });
      if (!result) {
        updateSaveBtn(); // 실패 시(세션 만료 등) 변경사항을 지우지 않고 다시 시도할 수 있게 둔다
        return;
      }
      const touchedProducts = new Set();
      items.forEach((it) => {
        const meta = productMeta.get(it.productId);
        if (meta) meta.qtyByColorSize.set(`${it.color}:${it.size}`, it.qty);
        touchedProducts.add(it.productId);
      });
      touchedProducts.forEach((productId) => {
        const card = el("admin-inventory-body").querySelector(`[data-product="${productId}"]`);
        const meta = productMeta.get(productId);
        if (card && meta) refreshColorChipStatuses(card, meta);
      });
      pendingChanges.clear();
      updateSaveBtn();
      toast(t("재고 {n}건을 저장했습니다", { n: items.length }));
    };

    el("admin-inventory-body").querySelectorAll(".inv-log-toggle").forEach((btn) =>
      btn.addEventListener("click", () => toggleInventoryLog(btn))
    );
  }

  const INVENTORY_LOG_REASON_LABELS = {
    order: "주문 차감",
    auto_cancel: "미입금 자동취소 복원",
    admin_cancel: "관리자 취소 복원",
    return_restock: "반품 복원",
    admin_adjust: "관리자 수정",
  };

  async function toggleInventoryLog(btn) {
    const card = btn.closest("[data-product]");
    const panel = card.querySelector(".inv-card-log");
    const opening = panel.hidden;
    panel.hidden = !opening;
    btn.textContent = t(opening ? "이력 닫기" : "이력 보기");
    if (!opening || panel.dataset.loaded) return;

    panel.innerHTML = `<p class="small">${esc(t("불러오는 중…"))}</p>`;
    const rows = await adminFetch(`/api/admin/inventory/log?productId=${encodeURIComponent(card.dataset.product)}`);
    if (!rows) { panel.hidden = true; btn.textContent = t("이력 보기"); return; }
    panel.dataset.loaded = "1";
    panel.innerHTML = rows.length
      ? `<div class="inv-log-list">${rows
          .map(
            (r) => `
        <div class="inv-log-row small" title="${esc(
          [fmtDate(r.at), t(INVENTORY_LOG_REASON_LABELS[r.reason] || r.reason), r.ref, r.adminEmail].filter(Boolean).join(" · ")
        )}">
          <span class="tnum">${fmtDate(r.at)}</span>
          <span>${r.color ? esc(t(COLORS[r.color]?.label || r.color)) : ""}</span>
          <span>${esc(r.size)}</span>
          <span class="tnum" style="color:${r.delta < 0 ? "var(--danger)" : "var(--ok)"}">${r.delta > 0 ? "+" : ""}${r.delta}</span>
          <span>${esc(t(INVENTORY_LOG_REASON_LABELS[r.reason] || r.reason))}${r.ref ? ` · ${esc(r.ref)}` : ""}${r.adminEmail ? ` · ${esc(emailName(r.adminEmail))}` : ""}</span>
        </div>`
          )
          .join("")}</div>`
      : `<p class="small">${esc(t("아직 변동 이력이 없습니다"))}</p>`;
  }

  function downloadInventoryExport(format) {
    return downloadExportFile(`/api/admin/inventory/export?format=${format}`, "reiten-inventory", format);
  }
  wireExportMenu("inv-export", "inv-export-menu", downloadInventoryExport);

