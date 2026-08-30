  /* ---------- 룩북 관리 ---------- */
  let lfEditingId = null;
  let lfSrc = null;
  const lookbookState = { page: 0, pageSize: 50, total: 0, items: [] };
  const LF_RATIO_PRESETS = ["1/1", "4/5", "3/4", "2/3", "16/10", "16/9"];

  function renderLfRatio(value) {
    const v = value || "16/10";
    if (LF_RATIO_PRESETS.includes(v)) {
      el("lf-ratio-select").value = v;
      el("lf-ratio").hidden = true;
      el("lf-ratio").value = "";
    } else {
      el("lf-ratio-select").value = "__custom__";
      el("lf-ratio").hidden = false;
      el("lf-ratio").value = v;
    }
  }
  function getLfRatio() {
    return el("lf-ratio-select").value === "__custom__" ? el("lf-ratio").value.trim() : el("lf-ratio-select").value;
  }
  el("lf-ratio-select").addEventListener("change", () => {
    const isCustom = el("lf-ratio-select").value === "__custom__";
    el("lf-ratio").hidden = !isCustom;
    if (isCustom) el("lf-ratio").focus();
    renderLfPreview();
  });
  el("lf-ratio").addEventListener("input", renderLfPreview);

  function renderLfPreview() {
    const ratio = getLfRatio() || "16/10";
    el("lf-preview-figure").className = el("lf-span").value;
    el("lf-preview-media").outerHTML = lfSrc
      ? `<div class="shot" id="lf-preview-media" style="aspect-ratio:${esc(ratio)}"><img src="${esc(lfSrc)}" alt=""></div>`
      : `<div class="ph" id="lf-preview-media" style="aspect-ratio:${esc(ratio)}"><span class="ph__label">${esc(ratio.replace("/", " : "))} · ${t("사진 준비중")}</span></div>`;
    el("lf-preview-label").textContent = el("lf-label").value.trim() || t("라벨");
    el("lf-preview-note").textContent = el("lf-note").value.trim();
  }
  ["lf-label", "lf-note", "lf-span"].forEach((id) => el(id).addEventListener("input", renderLfPreview));

  function renderLfPhoto() {
    el("lf-photo").innerHTML = `
      ${lfSrc
        ? `<img src="${esc(lfSrc)}" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:8px;border:1px solid var(--line)">`
        : `<div style="width:100%;aspect-ratio:4/5;border:1px dashed var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center" class="small">${esc(t("사진 없음"))}</div>`}
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
        <label class="upload-btn" style="cursor:pointer;justify-content:center;width:100%">
          ${PF_UPLOAD_ICON}
          <span>${esc(lfSrc ? t("사진 변경") : t("사진 선택"))}</span>
          <input type="file" accept="image/*" class="upload-input" id="lf-photo-input">
        </label>
        ${lfSrc ? `<button type="button" class="btn btn--sm btn--ghost" id="lf-photo-remove">${esc(t("제거"))}</button>` : ""}
      </div>
    `;
    el("lf-photo-input").addEventListener("change", onLfPhotoChange);
    el("lf-photo-remove")?.addEventListener("click", () => { lfSrc = null; renderLfPhoto(); renderLfPreview(); });
    renderLfPreview();
  }

  async function uploadLfPhoto(input, blob) {
    const token = await getAccessToken();
    const fd = new FormData();
    fd.append("photo", blob, "photo.jpg");
    input.disabled = true;
    try {
      const res = await fetch("/api/admin/lookbook/photo", {
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
      lfSrc = url;
      renderLfPhoto();
    } catch (err) {
      toast(t("사진 업로드에 실패했습니다"));
    } finally {
      input.disabled = false;
    }
  }

  function onLfPhotoChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const input = e.target;
    input.value = "";
    openPhotoEditor(file, getLfRatio() || "16/10", (blob) => uploadLfPhoto(input, blob));
  }

  function resetLookbookForm() {
    lfEditingId = null;
    lfSrc = null;
    el("lookbook-form-title").textContent = t("새 룩북 칸 추가");
    el("lf-label").value = "";
    el("lf-note").value = "";
    el("lf-span").value = "w6";
    renderLfRatio("16/10");
    el("lf-active").checked = true;
    el("lf-cancel").hidden = true;
    el("lf-delete").hidden = true;
    renderLfPhoto();
    renderLookbookVisual();
  }

  function fillLookbookForm(item) {
    lfEditingId = item.id;
    lfSrc = item.src || null;
    el("lookbook-form-title").textContent = t("룩북 칸 수정");
    el("lf-label").value = item.label || "";
    el("lf-note").value = item.note || "";
    el("lf-span").value = item.span || "w6";
    renderLfRatio(item.ratio || "16/10");
    el("lf-active").checked = item.active !== false;
    el("lf-cancel").hidden = false;
    el("lf-delete").hidden = false;
    renderLfPhoto();
    renderLookbookVisual();
    el("lookbook-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  el("lookbook-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      label: el("lf-label").value.trim(),
      note: el("lf-note").value.trim(),
      span: el("lf-span").value,
      ratio: getLfRatio(),
      active: el("lf-active").checked,
      src: lfSrc,
    };

    const btn = el("lf-submit");
    btn.disabled = true;
    try {
      const result = lfEditingId
        ? await adminFetch(`/api/admin/lookbook/${encodeURIComponent(lfEditingId)}`, { method: "PATCH", body: JSON.stringify(body) })
        : await adminFetch("/api/admin/lookbook", { method: "POST", body: JSON.stringify(body) });

      if (!result) return;
      toast(t("저장했습니다"));
      resetLookbookForm();
      paintAdminLookbook();
    } finally {
      btn.disabled = false;
    }
  });

  el("lf-cancel").addEventListener("click", () => resetLookbookForm());
  el("lf-delete").addEventListener("click", async () => {
    if (!lfEditingId) return;
    if (!confirm(t("이 룩북 칸을 삭제하시겠습니까? 되돌릴 수 없습니다."))) return;
    await adminFetch(`/api/admin/lookbook/${encodeURIComponent(lfEditingId)}`, { method: "DELETE" });
    toast(t("삭제했습니다"));
    resetLookbookForm();
    paintAdminLookbook();
  });
  resetLookbookForm();

  /* 실제 lookbook.html의 12칸 그리드(.look figure.w4/w6/w8/w12)와 동일한 배치를 그대로 재현해서,
     "몇 번째 칸을 고칠지"를 글로 고르지 않고 화면에서 직접 클릭해 고르게 한다. */
  function renderLookbookVisual() {
    const tiles = lookbookState.items
      .map(
        (item) => `
      <button type="button" class="look-tile ${esc(item.span)} ${item.id === lfEditingId ? "is-editing" : ""}" data-id="${esc(item.id)}">
        ${item.src ? `<img src="${esc(item.src)}" alt="">` : `<span class="look-tile-empty">${esc(item.ratio)}</span>`}
        <span class="look-tile-label">${esc(item.label)}</span>
        ${item.active === false ? `<span class="look-tile-hidden">${esc(t("비공개"))}</span>` : ""}
      </button>`
      )
      .join("");

    el("lookbook-visual").innerHTML =
      tiles + `<button type="button" class="look-tile look-tile-add w4" id="lf-add-tile">+ ${esc(t("새 칸 추가"))}</button>`;

    el("lookbook-visual").querySelectorAll(".look-tile:not(.look-tile-add)").forEach((btn) =>
      btn.addEventListener("click", () => {
        const item = lookbookState.items.find((x) => x.id === btn.dataset.id);
        if (item) fillLookbookForm(item);
      })
    );
    el("lf-add-tile").addEventListener("click", () => {
      resetLookbookForm();
      el("lookbook-form").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function paintAdminLookbook(loadMore = false) {
    lookbookState.page = loadMore ? lookbookState.page + 1 : 1;
    const result = await adminFetch(`/api/admin/lookbook?page=${lookbookState.page}&pageSize=${lookbookState.pageSize}`);
    if (!result) return;
    lookbookState.total = result.total;
    lookbookState.items = loadMore ? lookbookState.items.concat(result.items) : result.items;
    renderLookbookVisual();
  }

