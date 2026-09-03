  /* ---------- 상품 관리 ---------- */
  let pfEditingId = null;
  let pfImages = [null, null, null, null];
  /* 사진 슬롯마다 "이 사진은 어떤 컬러냐"를 골라둘 수 있게 하는 병렬 배열(같은 인덱스로
     pfImages와 짝을 맞춘다). 비워두면(null) 컬러 무관 공통 사진으로 취급된다 — product.html이
     컬러를 클릭했을 때 이 값이 있는 사진으로만 바꿔치기하고, 없으면 지금 보던 사진을 그대로 둔다. */
  let pfImageColors = [null, null, null, null];
  let pfSelectedColors = [];
  const PF_SIZE_OPTIONS = ["XS", "S", "M", "L", "XL"];
  const CATEGORY_BASE = ["후드티", "후드집업", "크롭 후드티", "티셔츠"];
  let pfKnownCategories = [...CATEGORY_BASE];

  function renderPfCategory(selected) {
    const known = selected && !pfKnownCategories.includes(selected) ? [...pfKnownCategories, selected] : pfKnownCategories;
    el("pf-category").innerHTML =
      known.map((c) => `<option value="${esc(c)}">${esc(t(c))}</option>`).join("") +
      `<option value="__custom__">${esc(t("직접 입력 (새 카테고리)"))}</option>`;
    el("pf-category").value = selected && known.includes(selected) ? selected : known[0];
    el("pf-category-custom").hidden = true;
    el("pf-category-custom").value = "";
  }

  el("pf-category").addEventListener("change", () => {
    const isCustom = el("pf-category").value === "__custom__";
    el("pf-category-custom").hidden = !isCustom;
    if (isCustom) el("pf-category-custom").focus();
  });

  function renderPfColors() {
    el("pf-colors").innerHTML = Object.values(COLORS).map((c) => `
      <button type="button" class="chip pf-color" data-c="${c.key}" aria-pressed="${pfSelectedColors.includes(c.key)}">
        <span class="pf-color-dot" style="background:${esc(c.hex)}"></span>${esc(t(c.label))}
      </button>
    `).join("");
    el("pf-colors").querySelectorAll(".pf-color").forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.dataset.c;
        pfSelectedColors = pfSelectedColors.includes(k) ? pfSelectedColors.filter((x) => x !== k) : [...pfSelectedColors, k];
        /* 컬러를 방금 뺐는데 어떤 사진 슬롯이 그 컬러를 물고 있으면(선택지에서 사라져야 하므로)
           공통(null)으로 되돌린다. */
        pfImageColors = pfImageColors.map((c) => (c && pfSelectedColors.includes(c) ? c : null));
        renderPfColors();
        renderPfPhotos();
      })
    );
    renderColorManager();
  }

  /* ---------- 색상 팔레트 관리(추가·수정·삭제) ----------
     상품에 쓸 색상을 고르는 위 칩 목록과 별개로, 그 팔레트 자체(전역 COLORS)를
     여기서 바로 추가·수정·삭제한다. null = 목록만 보임, "new" = 새 색상 추가 폼,
     그 외에는 해당 key의 색상을 수정하는 폼이 열려 있는 상태. */
  let colorManagerMode = null;

  function openColorManager(mode) {
    colorManagerMode = mode;
    renderColorManager();
  }

  function colorSwatchRow(c) {
    const label = esc(t(c.label)) + (c.labelDe ? ` · ${esc(c.labelDe)}` : "");
    return `
      <div class="color-manage-row" style="display:flex;align-items:center;gap:8px;padding:5px 0">
        <span style="width:18px;height:18px;flex:none;border-radius:50%;border:1px solid var(--line);background:${esc(c.hex)}"></span>
        <span class="small" style="flex:1">${label}</span>
        <button type="button" class="btn btn--sm btn--ghost cm-edit" data-c="${c.key}">${esc(t("수정"))}</button>
        <button type="button" class="btn btn--sm btn--danger cm-delete" data-c="${c.key}">${esc(t("삭제"))}</button>
      </div>`;
  }

  function colorManagerFormHTML(existing) {
    const label = existing ? esc(existing.label) : "";
    const labelDe = existing && existing.labelDe ? esc(existing.labelDe) : "";
    const hex = existing ? existing.hex : "#8a8a8a";
    return `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;padding:12px;margin-top:6px;border:1px dashed var(--line);border-radius:8px">
        <div class="field" style="margin:0;width:150px">
          <label>${esc(t("색상 이름"))}</label>
          <input type="text" id="cm-label" value="${label}" maxlength="40">
        </div>
        <div class="field" style="margin:0;width:150px">
          <label>${esc(t("독일어 이름 (선택)"))}</label>
          <input type="text" id="cm-label-de" value="${labelDe}" maxlength="40">
        </div>
        <div class="field" style="margin:0">
          <label>${esc(t("색상 값"))}</label>
          <div style="display:flex;gap:6px">
            <input type="color" id="cm-hex" value="${hex}" style="width:44px;height:44px;padding:2px;border:1px solid var(--line);border-radius:6px;background:none">
            <input type="text" id="cm-hex-text" value="${hex}" maxlength="7" style="width:90px">
          </div>
        </div>
        <button type="button" class="btn btn--sm" id="cm-save">${esc(t("저장"))}</button>
        <button type="button" class="btn btn--sm btn--ghost" id="cm-cancel">${esc(t("편집 취소"))}</button>
      </div>`;
  }

  function renderColorManager() {
    const rows = Object.values(COLORS).map(colorSwatchRow).join("");
    const isNew = colorManagerMode === "new";
    const editing = colorManagerMode && !isNew ? COLORS[colorManagerMode] : null;
    const formHTML = isNew ? colorManagerFormHTML(null) : editing ? colorManagerFormHTML(editing) : "";

    el("pf-color-manage").innerHTML = `
      <div class="small" style="font-weight:600;margin-bottom:4px">${esc(t("색상 팔레트 관리"))}</div>
      ${rows}
      ${formHTML || `<button type="button" class="btn btn--sm btn--ghost" id="cm-add" style="margin-top:6px">${esc(t("+ 새 색상"))}</button>`}
    `;

    el("pf-color-manage").querySelectorAll(".cm-edit").forEach((b) =>
      b.addEventListener("click", () => openColorManager(b.dataset.c))
    );
    el("pf-color-manage").querySelectorAll(".cm-delete").forEach((b) =>
      b.addEventListener("click", () => deleteColor(b.dataset.c))
    );
    const addBtn = el("cm-add");
    if (addBtn) addBtn.addEventListener("click", () => openColorManager("new"));

    if (formHTML) {
      const hexInput = el("cm-hex");
      const hexText = el("cm-hex-text");
      hexInput.addEventListener("input", () => (hexText.value = hexInput.value));
      hexText.addEventListener("input", () => {
        if (/^#[0-9a-fA-F]{6}$/.test(hexText.value)) hexInput.value = hexText.value;
      });
      el("cm-save").addEventListener("click", () => saveColor(colorManagerMode));
      el("cm-cancel").addEventListener("click", () => openColorManager(null));
    }
  }

  async function saveColor(mode) {
    const label = el("cm-label").value.trim();
    const labelDe = el("cm-label-de").value.trim();
    const hex = el("cm-hex-text").value.trim();
    if (!label) return toast(t("색상 이름을 입력해 주세요."));
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return toast(t("색상 값은 #RRGGBB 형식으로 입력해 주세요."));

    const isNew = mode === "new";
    const result = await adminFetch(isNew ? "/api/admin/colors" : `/api/admin/colors/${mode}`, {
      method: isNew ? "POST" : "PATCH",
      body: JSON.stringify({ label, labelDe: labelDe || null, hex }),
    });
    if (!result) return; // adminFetch가 이미 실패 사유를 토스트로 띄움

    COLORS[result.key] = result;
    if (isNew) pfSelectedColors = [...pfSelectedColors, result.key];
    colorManagerMode = null;
    renderPfColors();
    toast(t(isNew ? "색상을 추가했습니다." : "색상을 수정했습니다."));
  }

  async function deleteColor(key) {
    if (!confirm(t("이 색상을 삭제하시겠습니까? 되돌릴 수 없습니다."))) return;
    const result = await adminFetch(`/api/admin/colors/${key}`, { method: "DELETE" });
    if (!result) return;
    delete COLORS[key];
    pfSelectedColors = pfSelectedColors.filter((k) => k !== key);
    renderPfColors();
    toast(t("색상을 삭제했습니다."));
  }

  const PF_UPLOAD_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l2-2h6l2 2h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/></svg>`;

  function renderPfPhotos() {
    el("pf-photos").innerHTML = pfImages.map((url, i) => {
      const photoLabel = t("상품사진 {n}", { n: i + 1 });
      const colorOptions = pfSelectedColors
        .map((c) => `<option value="${esc(c)}" ${pfImageColors[i] === c ? "selected" : ""}>${esc(t(COLORS[c]?.label || c))}</option>`)
        .join("");
      return `
      <div>
        <div class="small" style="margin-bottom:6px;font-weight:600">${esc(photoLabel)}</div>
        ${url
          ? `<img src="${esc(url)}" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:8px;border:1px solid var(--line)">`
          : `<div style="width:100%;aspect-ratio:4/5;border:1px dashed var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center" class="small">${esc(t("사진 없음"))}</div>`}
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
          <label class="upload-btn" style="cursor:pointer;justify-content:center;width:100%">
            ${PF_UPLOAD_ICON}
            <span>${esc(url ? t("사진 변경") : t("사진 선택"))}</span>
            <input type="file" accept="image/*" class="upload-input pf-photo-input" data-i="${i}">
          </label>
          ${url ? `<button type="button" class="btn btn--sm btn--ghost pf-photo-remove" data-i="${i}">${esc(t("제거"))}</button>` : ""}
          ${
            url && pfSelectedColors.length
              ? `<select class="pf-photo-color" data-i="${i}" title="${esc(t("이 사진의 컬러 (고르면 그 컬러 클릭 시 이 사진으로 바뀜)"))}">
                   <option value="">${esc(t("공통 (컬러 무관)"))}</option>
                   ${colorOptions}
                 </select>`
              : ""
          }
        </div>
      </div>`;
    }).join("");
    el("pf-photos").querySelectorAll(".pf-photo-input").forEach((inp) => inp.addEventListener("change", () => onPfPhotoChange(inp)));
    el("pf-photos").querySelectorAll(".pf-photo-remove").forEach((btn) =>
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.i);
        pfImages[i] = null;
        pfImageColors[i] = null;
        renderPfPhotos();
      })
    );
    el("pf-photos").querySelectorAll(".pf-photo-color").forEach((sel) =>
      sel.addEventListener("change", () => {
        pfImageColors[Number(sel.dataset.i)] = sel.value || null;
      })
    );
  }

  /* ---------- 사진 편집(자르기/회전/확대) ----------
     상품 사진은 세로 4:5(실제 쇼핑몰 카드·상세 페이지가 이 비율로 보여주기 때문 — 정사각으로
     자르면 관리자 미리보기에선 멀쩡해 보여도 실제 사이트에선 위아래 여백이 뜨거나 어색하게
     보인다), 룩북 사진은 그 칸에 고른 가로세로 비율로 미리 잘라서 올린다 —
     Cloudinary가 업로드 후 리사이즈는 해주지만 "어디를 잘라낼지"는 모르기 때문에, 실제로
     보일 영역을 여기서 캔버스로 직접 그려 잘라낸 이미지를 만든 뒤 그걸 업로드한다.
     자유 드래그로 잘라낼 영역을 고르는 대신, 고정된 틀(frame) 안에서 사진을 확대/이동/회전하는
     방식(인스타그램 업로드 편집과 같은 방식)을 써서 구현을 단순하게 유지한다. */
  const peState = { img: null, url: null, rotation: 0, zoom: 1, offsetX: 0, offsetY: 0, frameW: 320, frameH: 320, baseScale: 1, onDone: null };

  function peRatioToNumber(ratio) {
    const [w, h] = String(ratio || "1/1").split("/").map(Number);
    return w > 0 && h > 0 ? w / h : 1;
  }

  function peFitImageToFrame() {
    const rad = (peState.rotation * Math.PI) / 180;
    const iw = peState.img.naturalWidth, ih = peState.img.naturalHeight;
    const rw = Math.abs(iw * Math.cos(rad)) + Math.abs(ih * Math.sin(rad));
    const rh = Math.abs(iw * Math.sin(rad)) + Math.abs(ih * Math.cos(rad));
    peState.baseScale = Math.max(peState.frameW / rw, peState.frameH / rh);
  }

  function peDraw(ctx, w, h, outputScale) {
    ctx.clearRect(0, 0, w, h);
    /* 100% 미만으로 축소하면(원본 비율을 살리려고 프레임보다 작게 줄이는 경우) 사진이 프레임을
       다 못 채워 빈 자리가 생긴다 — 채워두지 않으면 JPEG로 저장할 때 투명 영역이 검은색으로
       바뀌어버리므로 흰 배경을 먼저 깔아둔다. */
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2 + peState.offsetX * outputScale, h / 2 + peState.offsetY * outputScale);
    ctx.rotate((peState.rotation * Math.PI) / 180);
    const scale = peState.baseScale * peState.zoom * outputScale;
    const iw = peState.img.naturalWidth * scale, ih = peState.img.naturalHeight * scale;
    ctx.drawImage(peState.img, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }

  function peRedraw() {
    const canvas = el("pe-canvas");
    peDraw(canvas.getContext("2d"), canvas.width, canvas.height, 1);
  }

  /* 확대·이동을 해도 프레임 밖으로 사진이 완전히 빠져나가지 않도록 이동 범위를 제한한다. */
  function peClampOffset() {
    const rad = (peState.rotation * Math.PI) / 180;
    const iw = peState.img.naturalWidth, ih = peState.img.naturalHeight;
    const scale = peState.baseScale * peState.zoom;
    const rw = (Math.abs(iw * Math.cos(rad)) + Math.abs(ih * Math.sin(rad))) * scale;
    const rh = (Math.abs(iw * Math.sin(rad)) + Math.abs(ih * Math.cos(rad))) * scale;
    const maxX = Math.max(0, (rw - peState.frameW) / 2);
    const maxY = Math.max(0, (rh - peState.frameH) / 2);
    peState.offsetX = Math.min(maxX, Math.max(-maxX, peState.offsetX));
    peState.offsetY = Math.min(maxY, Math.max(-maxY, peState.offsetY));
  }

  function openPhotoEditor(file, ratio, onDone) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      peState.img = img;
      peState.url = url;
      peState.rotation = 0;
      peState.zoom = 1;
      peState.offsetX = 0;
      peState.offsetY = 0;
      peState.onDone = onDone;

      const r = peRatioToNumber(ratio);
      let fw = 320, fh = 320 / r;
      if (fh > 420) { fh = 420; fw = fh * r; }
      peState.frameW = Math.round(fw);
      peState.frameH = Math.round(fh);

      const stage = el("pe-stage");
      stage.style.width = peState.frameW + "px";
      stage.style.height = peState.frameH + "px";
      const canvas = el("pe-canvas");
      canvas.width = peState.frameW;
      canvas.height = peState.frameH;

      peFitImageToFrame();
      el("pe-zoom").value = 100;
      peRedraw();
      el("photo-editor").hidden = false;
    };
    img.onerror = () => {
      toast(t("이미지를 불러오지 못했습니다"));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function closePhotoEditor() {
    el("photo-editor").hidden = true;
    if (peState.url) URL.revokeObjectURL(peState.url);
    peState.img = null;
    peState.url = null;
    peState.onDone = null;
  }

  el("pe-cancel").addEventListener("click", () => closePhotoEditor());

  el("pe-rotate-left").addEventListener("click", () => {
    peState.rotation = (peState.rotation + 270) % 360;
    peState.offsetX = 0; peState.offsetY = 0;
    peFitImageToFrame();
    peRedraw();
  });
  el("pe-rotate-right").addEventListener("click", () => {
    peState.rotation = (peState.rotation + 90) % 360;
    peState.offsetX = 0; peState.offsetY = 0;
    peFitImageToFrame();
    peRedraw();
  });
  el("pe-zoom").addEventListener("input", () => {
    peState.zoom = Number(el("pe-zoom").value) / 100;
    peClampOffset();
    peRedraw();
  });

  (function setupPeDrag() {
    const stage = el("pe-stage");
    let dragging = false, startX = 0, startY = 0, startOffX = 0, startOffY = 0;
    const down = (x, y) => {
      dragging = true; startX = x; startY = y;
      startOffX = peState.offsetX; startOffY = peState.offsetY;
      stage.classList.add("is-dragging");
    };
    const move = (x, y) => {
      if (!dragging) return;
      peState.offsetX = startOffX + (x - startX);
      peState.offsetY = startOffY + (y - startY);
      peClampOffset();
      peRedraw();
    };
    const up = () => { dragging = false; stage.classList.remove("is-dragging"); };
    stage.addEventListener("mousedown", (e) => down(e.clientX, e.clientY));
    window.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
    window.addEventListener("mouseup", up);
    stage.addEventListener("touchstart", (e) => { const t = e.touches[0]; down(t.clientX, t.clientY); }, { passive: true });
    stage.addEventListener("touchmove", (e) => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
    stage.addEventListener("touchend", up);
  })();

  el("pe-apply").addEventListener("click", () => {
    const outW = 1200;
    const outH = Math.round((outW * peState.frameH) / peState.frameW);
    const outputScale = outW / peState.frameW;
    const outCanvas = document.createElement("canvas");
    outCanvas.width = outW;
    outCanvas.height = outH;
    peDraw(outCanvas.getContext("2d"), outW, outH, outputScale);
    const onDone = peState.onDone;
    outCanvas.toBlob((blob) => {
      closePhotoEditor();
      if (blob) onDone(blob);
    }, "image/jpeg", 0.92);
  });

  async function uploadPfPhoto(input, i, blob) {
    const token = await getAccessToken();
    const fd = new FormData();
    fd.append("photo", blob, "photo.jpg");
    input.disabled = true;
    try {
      const res = await fetch("/api/admin/products/photo", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(body.error || t("사진 업로드에 실패했습니다"));
        return;
      }
      const { url } = await res.json();
      pfImages[i] = url;
      renderPfPhotos();
    } catch (e) {
      toast(t("사진 업로드에 실패했습니다"));
    } finally {
      input.disabled = false;
    }
  }

  function onPfPhotoChange(input) {
    const file = input.files[0];
    if (!file) return;
    const i = Number(input.dataset.i);
    input.value = "";
    openPhotoEditor(file, "4/5", (blob) => uploadPfPhoto(input, i, blob));
  }

  function resetProductForm() {
    pfEditingId = null;
    pfImages = [null, null, null, null];
    pfImageColors = [null, null, null, null];
    pfSelectedColors = [];
    el("product-form-title").textContent = t("새 상품 추가");
    el("pf-id").value = "";
    el("pf-id").disabled = false;
    el("pf-name").value = "";
    el("pf-nameko").value = "";
    el("pf-type").value = "hoodie";
    renderPfCategory();
    el("pf-price").value = "";
    el("pf-badge").value = "";
    el("pf-short").value = "";
    el("pf-desc").value = "";
    el("pf-details").value = "";
    document.querySelectorAll(".pf-size").forEach((cb) => (cb.checked = true));
    el("pf-sizetable").value = "hoodie";
    el("pf-charmready").checked = false;
    el("pf-active").checked = true;
    el("pf-cancel").hidden = true;
    el("pf-view-live").hidden = true;
    renderPfColors();
    renderPfPhotos();
  }

  function fillProductForm(p) {
    pfEditingId = p.id;
    pfImages = [0, 1, 2, 3].map((i) => p.images[i] || null);
    pfImageColors = [0, 1, 2, 3].map((i) => (p.imageColors && p.imageColors[i]) || null);
    pfSelectedColors = [...(p.colors || [])];
    el("product-form-title").textContent = t("상품 수정") + " — " + p.id;
    el("pf-id").value = p.id;
    el("pf-id").disabled = true;
    el("pf-name").value = p.name || "";
    el("pf-nameko").value = p.nameKo || "";
    el("pf-type").value = p.type || "hoodie";
    renderPfCategory(p.category || "");
    el("pf-price").value = p.price;
    el("pf-badge").value = p.badge || "";
    el("pf-short").value = p.short || "";
    el("pf-desc").value = p.desc || "";
    el("pf-details").value = (p.details || []).join("\n");
    const soldOut = p.soldOut || [];
    document.querySelectorAll(".pf-size").forEach((cb) => (cb.checked = !soldOut.includes(cb.value)));
    el("pf-sizetable").value = p.sizeTable || "hoodie";
    el("pf-charmready").checked = !!p.charmReady;
    el("pf-active").checked = p.active !== false;
    el("pf-cancel").hidden = false;
    el("pf-view-live").href = `/product.html?id=${encodeURIComponent(p.id)}`;
    el("pf-view-live").hidden = false;
    renderPfColors();
    renderPfPhotos();
    el("product-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  el("product-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = el("pf-id").value.trim();
    if (!pfEditingId && !/^[a-z0-9-]{2,60}$/.test(id)) {
      toast(t("상품 ID는 영문 소문자·숫자·하이픈만 2~60자로 입력해 주세요."));
      return;
    }
    const category = el("pf-category").value === "__custom__" ? el("pf-category-custom").value.trim() : el("pf-category").value;
    if (!category) {
      toast(t("카테고리를 입력해 주세요."));
      return;
    }

    const body = {
      name: el("pf-name").value.trim(),
      nameKo: el("pf-nameko").value.trim(),
      type: el("pf-type").value,
      category,
      price: Number(el("pf-price").value),
      badge: el("pf-badge").value.trim(),
      short: el("pf-short").value.trim(),
      desc: el("pf-desc").value.trim(),
      details: el("pf-details").value.split("\n").map((s) => s.trim()).filter(Boolean),
      colors: pfSelectedColors,
      sizes: PF_SIZE_OPTIONS,
      soldOut: [...document.querySelectorAll(".pf-size")].filter((cb) => !cb.checked).map((cb) => cb.value),
      sizeTable: el("pf-sizetable").value,
      charmReady: el("pf-charmready").checked,
      active: el("pf-active").checked,
      images: pfImages,
      imageColors: pfImageColors,
    };

    const btn = el("pf-submit");
    btn.disabled = true;
    try {
      const result = pfEditingId
        ? await adminFetch(`/api/admin/products/${encodeURIComponent(pfEditingId)}`, { method: "PATCH", body: JSON.stringify(body) })
        : await adminFetch("/api/admin/products", { method: "POST", body: JSON.stringify({ id, ...body }) });

      if (!result) return;
      toast(t("상품을 저장했습니다"));
      /* 관리자 미리보기와 실제 사이트가 다르게 보이는 걸(사진 비율 사고 같은) 저장한 그 자리에서
         바로 확인할 수 있게, 실제 상품 페이지 링크를 새 탭으로 열 수 있게 켜둔다.
         resetProductForm()이 폼을 새 상품 등록 상태로 되돌리므로, 이 링크는 그 뒤에 켜야 한다. */
      resetProductForm();
      el("pf-view-live").href = `/product.html?id=${encodeURIComponent(result.id)}`;
      el("pf-view-live").hidden = false;
      paintAdminProducts();
    } finally {
      btn.disabled = false;
    }
  });

  el("pf-cancel").addEventListener("click", () => resetProductForm());
  resetProductForm();

  const productsState = { page: 0, pageSize: 50, total: 0, items: [] };

  /* 상품이 몇 개 안 될 땐 하나씩 눌러도 되지만, 상품을 여러 개 한꺼번에 공개/비공개로 돌리거나
     (예: 카드사 심사 전 사진 없는 상품 몰아서 숨기기), 새 컬러를 여러 상품에 한 번에 추가하거나,
     여러 개를 한꺼번에 정리해서 삭제하고 싶을 때는 하나씩 누르는 게 번거롭다는 피드백을 받아
     체크박스 다중 선택 + 상단 일괄 처리 바를 추가했다. */
  const selectedProductIds = new Set();

  function productRowHTML(p) {
    const img = p.images.find(Boolean);
    return `
      <div class="grid-card" data-id="${esc(p.id)}">
        <div class="grid-card-thumb">
          <label class="grid-card-select" onclick="event.stopPropagation()">
            <input type="checkbox" class="product-select" data-id="${esc(p.id)}" ${selectedProductIds.has(p.id) ? "checked" : ""}>
          </label>
          ${img ? `<img src="${esc(img)}" alt="">` : ""}
          ${p.active ? "" : `<span class="grid-card-badge">${esc(t("비공개"))}</span>`}
        </div>
        <div class="grid-card-body">
          <b>${esc(t(p.nameKo))}</b>
          <div class="small tnum">${money(p.price)}</div>
        </div>
        <div class="grid-card-actions">
          <button type="button" class="btn btn--sm admin-product-edit">${esc(t("수정"))}</button>
          <button type="button" class="btn btn--sm btn--danger admin-product-delete">${esc(t("삭제"))}</button>
        </div>
      </div>`;
  }

  function updateProductsBulkBar() {
    const n = selectedProductIds.size;
    el("products-bulk-actions").hidden = n === 0;
    el("products-selected-count").textContent = n ? t("{n}개 선택됨", { n }) : "";
    const loadedIds = productsState.items.map((p) => p.id);
    el("products-select-all").checked = loadedIds.length > 0 && loadedIds.every((id) => selectedProductIds.has(id));
  }

  function renderAdminProducts() {
    productsState.items.forEach((p) => {
      if (p.category && !pfKnownCategories.includes(p.category)) pfKnownCategories.push(p.category);
    });
    const hasMore = productsState.items.length < productsState.total;
    el("products-list").innerHTML = productsState.items.map(productRowHTML).join("") + loadMoreHTML(hasMore, "products-list-more");

    const colorSelect = el("products-bulk-color-select");
    const prevColorValue = colorSelect.value;
    colorSelect.innerHTML = Object.values(COLORS).map((c) => `<option value="${esc(c.key)}">${esc(t(c.label))}</option>`).join("");
    if ([...colorSelect.options].some((o) => o.value === prevColorValue)) colorSelect.value = prevColorValue;

    el("products-list").querySelectorAll(".product-select").forEach((cb) =>
      cb.addEventListener("change", () => {
        if (cb.checked) selectedProductIds.add(cb.dataset.id);
        else selectedProductIds.delete(cb.dataset.id);
        updateProductsBulkBar();
      })
    );

    el("products-list").querySelectorAll(".admin-product-edit").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-id]").dataset.id;
        const p = productsState.items.find((x) => x.id === id);
        if (p) fillProductForm(p);
      })
    );
    el("products-list").querySelectorAll(".admin-product-delete").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        if (!confirm(t("정말 삭제하시겠습니까? 되돌릴 수 없습니다.") + "\n" + id)) return;
        await adminFetch(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (pfEditingId === id) resetProductForm();
        toast(t("상품을 삭제했습니다"));
        paintAdminProducts();
      })
    );

    el("products-list-more")?.addEventListener("click", () => paintAdminProducts(true));
    updateProductsBulkBar();
  }

  /* 전체 선택은 "지금까지 불러온(더 보기 포함) 상품" 기준이다 — 검색 없이 전체 상품이 목록에
     있을 때가 많아 실사용에는 무리 없지만, 페이지네이션 중 일부만 불러온 상태에서는 그만큼만
     선택된다(더 보기를 눌러 마저 불러오면 그때 다시 전체 선택하면 됨). */
  el("products-select-all").addEventListener("change", () => {
    if (el("products-select-all").checked) productsState.items.forEach((p) => selectedProductIds.add(p.id));
    else productsState.items.forEach((p) => selectedProductIds.delete(p.id));
    renderAdminProducts();
  });

  async function runProductsBulkAction(fn) {
    const ids = [...selectedProductIds];
    if (!ids.length) return;
    const result = await fn(ids);
    if (!result) return; // adminFetch가 이미 실패 사유를 토스트로 띄움
    selectedProductIds.clear();
    paintAdminProducts();
    return result;
  }

  el("products-bulk-active").addEventListener("click", () =>
    runProductsBulkAction(async (ids) => {
      const r = await adminFetch("/api/admin/products/bulk-active", { method: "PATCH", body: JSON.stringify({ ids, active: true }) });
      if (r) toast(t("{n}개 상품을 공개 처리했습니다", { n: r.count }));
      return r;
    })
  );
  el("products-bulk-inactive").addEventListener("click", () =>
    runProductsBulkAction(async (ids) => {
      const r = await adminFetch("/api/admin/products/bulk-active", { method: "PATCH", body: JSON.stringify({ ids, active: false }) });
      if (r) toast(t("{n}개 상품을 비공개 처리했습니다", { n: r.count }));
      return r;
    })
  );
  el("products-bulk-color-add").addEventListener("click", () =>
    runProductsBulkAction(async (ids) => {
      const color = el("products-bulk-color-select").value;
      if (!color) { toast(t("추가할 컬러를 선택해 주세요.")); return null; }
      const r = await adminFetch("/api/admin/products/bulk-color", { method: "PATCH", body: JSON.stringify({ ids, color }) });
      if (r) toast(t("{n}개 상품에 컬러를 추가했습니다", { n: r.count }));
      return r;
    })
  );
  /* 일괄 가격 수정(2026-09) — 세일 시즌에 여러 상품 가격을 한 번에 바꾸는 용도. mode는
     서버(routes/products.js의 bulk-price)가 그대로 검증하므로 여기선 빈 값만 막는다. */
  el("products-bulk-price-apply").addEventListener("click", () =>
    runProductsBulkAction(async (ids) => {
      const mode = el("products-bulk-price-mode").value;
      const value = Number(el("products-bulk-price-value").value);
      if (!Number.isFinite(value) || el("products-bulk-price-value").value.trim() === "") {
        toast(t("적용할 값을 입력해 주세요."));
        return null;
      }
      const modeLabel = mode === "percent" ? "%" : mode === "fixed" ? t("원 조정") : t("원으로 지정");
      if (!confirm(t("선택한 {n}개 상품 가격을 {value}{mode} 적용할까요?", { n: ids.length, value, mode: modeLabel }))) return null;
      const r = await adminFetch("/api/admin/products/bulk-price", { method: "PATCH", body: JSON.stringify({ ids, mode, value }) });
      if (r) toast(t("{n}개 상품 가격을 수정했습니다", { n: r.count }));
      return r;
    })
  );
  el("products-bulk-delete").addEventListener("click", () =>
    runProductsBulkAction(async (ids) => {
      if (!confirm(t("선택한 {n}개 상품을 정말 삭제하시겠습니까? 되돌릴 수 없습니다.", { n: ids.length }))) return null;
      const r = await adminFetch("/api/admin/products/bulk", { method: "DELETE", body: JSON.stringify({ ids }) });
      if (r && pfEditingId && ids.includes(pfEditingId)) resetProductForm();
      if (r) toast(t("{n}개 상품을 삭제했습니다", { n: r.count }));
      return r;
    })
  );

  async function paintAdminProducts(loadMore = false) {
    productsState.page = loadMore ? productsState.page + 1 : 1;
    const result = await adminFetch(`/api/admin/products?page=${productsState.page}&pageSize=${productsState.pageSize}`);
    if (!result) return;
    productsState.total = result.total;
    productsState.items = loadMore ? productsState.items.concat(result.items) : result.items;
    renderAdminProducts();
  }

