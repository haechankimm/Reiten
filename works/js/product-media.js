  /* 상품 — 사진·영상·상세 콘텐츠 목록과 업로드 (2026-11-11 큰 파일 나누기 — 내용·순서는 그대로). products.js보다 먼저 불러온다(products.js가 불러오자마자 resetProductForm()→renderPfPhotos()를 부름) */

  const PF_UPLOAD_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l2-2h6l2 2h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/></svg>`;

  const MEDIA_KIND_LABEL = { gallery: "상품 사진", detail: "상세 사진", video: "상세 영상", text: "상세 문구" };
  const colorLabel = (c) => (c ? t(COLORS[c]?.label || c) : t("공통"));

  function mediaVisible(m) {
    return pfMediaFilter === "all" || (pfMediaFilter === "" ? !m.color : m.color === pfMediaFilter);
  }

  function mediaItemHTML(m, i) {
    const colorOptions = [`<option value="">${esc(t("공통 (모든 컬러)"))}</option>`]
      .concat([...new Set([...pfSelectedColors, ...(m.color ? [m.color] : [])])].map((c) => `<option value="${esc(c)}" ${m.color === c ? "selected" : ""}>${esc(colorLabel(c))}</option>`))
      .join("");
    const preview =
      m.kind === "text"
        ? `<textarea class="pf-media-text" data-i="${i}" rows="3" placeholder="${esc(t("예: 480g 헤비 기모 원단, 목 립은 2중 봉제"))}">${esc(m.text || "")}</textarea>`
        : m.kind === "video"
          ? `<video src="${esc(m.src)}" muted playsinline preload="metadata" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:8px;background:#000"></video>`
          : `<img src="${esc(m.src)}" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:8px;border:1px solid var(--line)" alt="">`;
    return `
      <div class="pf-media-item" data-i="${i}" style="display:flex;flex-direction:column;gap:6px">
        <div class="small" style="font-weight:600">${esc(t(MEDIA_KIND_LABEL[m.kind]))} <span style="color:var(--text-muted);font-weight:400">· ${esc(colorLabel(m.color))}</span></div>
        ${preview}
        <select class="pf-media-color" data-i="${i}">${colorOptions}</select>
        ${m.kind === "detail" || m.kind === "video" ? `<input class="pf-media-caption" data-i="${i}" maxlength="300" placeholder="${esc(t("설명 (선택)"))}" value="${esc(m.caption || "")}">` : ""}
        <div style="display:flex;gap:4px">
          <button type="button" class="btn btn--sm btn--ghost pf-media-up" data-i="${i}" aria-label="${esc(t("앞으로"))}">↑</button>
          <button type="button" class="btn btn--sm btn--ghost pf-media-down" data-i="${i}" aria-label="${esc(t("뒤로"))}">↓</button>
          <button type="button" class="btn btn--sm btn--ghost pf-media-remove" data-i="${i}" style="margin-left:auto">${esc(t("제거"))}</button>
        </div>
      </div>`;
  }

  function renderPfPhotos() {
    const filters = [["all", t("전체")], ["", t("공통")], ...pfSelectedColors.map((c) => [c, colorLabel(c)])];
    const groups = [
      { title: t("상단 상품 사진 (4:5)"), kinds: ["gallery"] },
      { title: t("상세 페이지 (디테일 사진 · 영상 · 문구)"), kinds: ["detail", "video", "text"] },
    ];
    el("pf-photos").innerHTML = `
      <p class="small" style="color:var(--text-muted);margin:0 0 10px">${esc(t("고객이 컬러를 고르면 그 컬러 항목과 공통 항목만 보입니다. 컬러를 먼저 고른 뒤 추가하면 그 컬러로 등록됩니다."))}</p>
      <div class="chips" style="margin-bottom:12px">${filters.map(([k, label]) => `<button type="button" class="chip pf-media-filter" data-k="${esc(k)}" aria-pressed="${pfMediaFilter === k}">${esc(label)}</button>`).join("")}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <label class="upload-btn" style="cursor:pointer">${PF_UPLOAD_ICON}<span>${esc(t("+ 상품 사진"))}</span><input type="file" accept="image/*" class="upload-input" id="pf-add-gallery"></label>
        <label class="upload-btn" style="cursor:pointer">${PF_UPLOAD_ICON}<span>${esc(t("+ 상세 사진"))}</span><input type="file" accept="image/*" multiple class="upload-input" id="pf-add-detail"></label>
        <label class="upload-btn" style="cursor:pointer">${PF_UPLOAD_ICON}<span>${esc(t("+ 상세 영상"))}</span><input type="file" accept="video/*" class="upload-input" id="pf-add-video"></label>
        <button type="button" class="btn btn--sm btn--ghost" id="pf-add-text">${esc(t("+ 상세 문구"))}</button>
      </div>
      ${groups.map((g) => {
        const items = pfMedia.map((m, i) => [m, i]).filter(([m]) => g.kinds.includes(m.kind) && mediaVisible(m));
        return `<div style="margin-bottom:16px">
          <div class="small" style="font-weight:700;margin-bottom:8px">${esc(g.title)} <span style="color:var(--text-muted);font-weight:400">${items.length}</span></div>
          ${items.length
            ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px">${items.map(([m, i]) => mediaItemHTML(m, i)).join("")}</div>`
            : `<p class="small" style="color:var(--text-muted)">${esc(t("아직 없습니다"))}</p>`}
        </div>`;
      }).join("")}`;

    const box = el("pf-photos");
    box.querySelectorAll(".pf-media-filter").forEach((b) => b.addEventListener("click", () => { pfMediaFilter = b.dataset.k; renderPfPhotos(); }));
    box.querySelectorAll(".pf-media-color").forEach((sel) => sel.addEventListener("change", () => { pfMedia[+sel.dataset.i].color = sel.value || null; renderPfPhotos(); }));
    box.querySelectorAll(".pf-media-caption").forEach((inp) => inp.addEventListener("input", () => { pfMedia[+inp.dataset.i].caption = inp.value; }));
    box.querySelectorAll(".pf-media-text").forEach((ta) => ta.addEventListener("input", () => { pfMedia[+ta.dataset.i].text = ta.value; }));
    box.querySelectorAll(".pf-media-remove").forEach((b) => b.addEventListener("click", () => { pfMedia.splice(+b.dataset.i, 1); renderPfPhotos(); }));
    const move = (i, dir) => {
      // 같은 묶음(상단 사진 / 상세)끼리만 순서를 바꾼다
      const isGallery = pfMedia[i].kind === "gallery";
      let j = i + dir;
      while (j >= 0 && j < pfMedia.length && (pfMedia[j].kind === "gallery") !== isGallery) j += dir;
      if (j < 0 || j >= pfMedia.length) return;
      [pfMedia[i], pfMedia[j]] = [pfMedia[j], pfMedia[i]];
      renderPfPhotos();
    };
    box.querySelectorAll(".pf-media-up").forEach((b) => b.addEventListener("click", () => move(+b.dataset.i, -1)));
    box.querySelectorAll(".pf-media-down").forEach((b) => b.addEventListener("click", () => move(+b.dataset.i, 1)));

    const newColor = () => (pfMediaFilter && pfMediaFilter !== "all" ? pfMediaFilter : null);
    el("pf-add-gallery").addEventListener("change", (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const color = newColor();
      openPhotoEditor(file, "4/5", (blob) => uploadMedia(blob, "photo", (url) => pfMedia.push({ kind: "gallery", src: url, color })));
    });
    el("pf-add-detail").addEventListener("change", async (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      const color = newColor();
      for (const f of files) await uploadMedia(f, "photo", (url) => pfMedia.push({ kind: "detail", src: url, color }));
    });
    el("pf-add-video").addEventListener("change", (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      if (file.size > 60 * 1024 * 1024) { toast(t("영상은 60MB 이하만 올릴 수 있습니다")); return; }
      uploadMedia(file, "video", (url) => pfMedia.push({ kind: "video", src: url, color: newColor() }));
    });
    el("pf-add-text").addEventListener("click", () => { pfMedia.push({ kind: "text", text: "", color: newColor() }); renderPfPhotos(); });
  }

  /* field: "photo"(사진, 15MB) 또는 "video"(영상, 60MB). 성공하면 onUrl(url)로 목록에 넣고 다시 그린다. */
  async function uploadMedia(fileOrBlob, field, onUrl) {
    const token = await getAccessToken();
    const fd = new FormData();
    fd.append(field, fileOrBlob, fileOrBlob.name || (field === "video" ? "video.mp4" : "photo.jpg"));
    toast(field === "video" ? t("영상 업로드 중… (용량에 따라 1분 이상 걸릴 수 있어요)") : t("사진 업로드 중…"));
    try {
      const res = await fetch(field === "video" ? "/api/admin/products/video" : "/api/admin/products/photo", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(serverMsg(body, t("업로드에 실패했습니다")));
        return;
      }
      const { url } = await res.json();
      onUrl(url);
      renderPfPhotos();
      toast(t("올렸습니다 — 상품 저장을 눌러야 반영됩니다"));
    } catch (e) {
      toast(t("업로드에 실패했습니다"));
    }
  }
