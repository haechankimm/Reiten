  /* 상품 — 색상 팔레트 관리 (2026-11-11 큰 파일 나누기 — 내용·순서는 그대로). products.js보다 먼저 불러온다 */

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
    const label = esc(t(c.label)) + [c.labelDe, c.labelEn, c.labelJa].filter(Boolean).map((v) => ` · ${esc(v)}`).join("");
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
    const labelEn = existing && existing.labelEn ? esc(existing.labelEn) : "";
    const labelJa = existing && existing.labelJa ? esc(existing.labelJa) : "";
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
        <!-- 고객 화면(영어·일본어)에 보일 색상 이름 — 비워 두면 한국어 이름 그대로(2026-10-29, 마이그레이션 044) -->
        <div class="field" style="margin:0;width:150px">
          <label>${esc(t("영어 이름 (선택)"))}</label>
          <input type="text" id="cm-label-en" value="${labelEn}" maxlength="40">
        </div>
        <div class="field" style="margin:0;width:150px">
          <label>${esc(t("일본어 이름 (선택)"))}</label>
          <input type="text" id="cm-label-ja" value="${labelJa}" maxlength="40">
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
    const labelEn = el("cm-label-en").value.trim();
    const labelJa = el("cm-label-ja").value.trim();
    const hex = el("cm-hex-text").value.trim();
    if (!label) return toast(t("색상 이름을 입력해 주세요."));
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return toast(t("색상 값은 #RRGGBB 형식으로 입력해 주세요."));

    const isNew = mode === "new";
    const result = await adminFetch(isNew ? "/api/admin/colors" : `/api/admin/colors/${mode}`, {
      method: isNew ? "POST" : "PATCH",
      body: JSON.stringify({ label, labelDe: labelDe || null, labelEn: labelEn || null, labelJa: labelJa || null, hex }),
    });
    if (!result) return; // adminFetch가 이미 실패 사유를 토스트로 띄움

    COLORS[result.key] = result;
    if (isNew) pfSelectedColors = [...pfSelectedColors, result.key];
    colorManagerMode = null;
    renderPfColors();
    toast(result.translationsSkipped
      ? t("저장했지만 DB 마이그레이션 044 전이라 영어·일본어 이름은 빠졌습니다")
      : t(isNew ? "색상을 추가했습니다." : "색상을 수정했습니다."));
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
