  /* ---------- 고객 공지 띠배너 (2026-11-21, 마이그레이션 056) ----------
     휴무·배송 지연 같은 안내를 고객 사이트 맨 위 띠로 띄운다. 기간(시작·끝)을 정해 두면 그 시간에만 보이고,
     고객이 ×로 닫으면 그 기기에서는 문구가 바뀔 때까지 다시 안 뜬다(소스 코드/assets/js/app.js renderSiteBanners).
     서버: server/routes/banners.js(권한 영역 "banners"). */
  let bnEditingId = null;
  let bannersCache = [];
  const BANNER_STATE = {
    live: ["노출 중", "st-done"],
    scheduled: ["예약", "st-pending"],
    ended: ["기간 끝", "st-neutral"],
    off: ["꺼짐", "st-neutral"],
  };

  function resetBannerForm() {
    bnEditingId = null;
    el("banner-form-title").textContent = t("새 배너");
    el("bn-submit").textContent = t("등록");
    ["bn-message", "bn-message-en", "bn-message-ja", "bn-link", "bn-starts", "bn-ends"].forEach((id) => (el(id).value = ""));
    el("bn-tone").value = "info";
    el("bn-order").value = "0";
    el("bn-active").checked = true;
    el("bn-cancel").hidden = true;
  }

  function bannerPeriodText(b) {
    if (!b.startsAt && !b.endsAt) return t("기간 없음(켜 두는 동안 계속)");
    return `${b.startsAt ? fmtDate(b.startsAt) : t("지금")} ~ ${b.endsAt ? fmtDate(b.endsAt) : t("계속")}`;
  }

  function bannerRowHTML(b) {
    const [label, cls] = BANNER_STATE[b.state] || BANNER_STATE.off;
    const edit = canEdit("banners");
    return `
      <div class="panel" data-id="${esc(b.id)}" style="padding:12px 14px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span class="status-chip ${cls}">${esc(t(label))}</span>
          ${b.tone === "warning" ? `<span class="status-chip st-overdue">${esc(t("주의"))}</span>` : ""}
          <b style="flex:1;min-width:200px">${esc(b.message)}</b>
          ${edit ? `<div style="display:flex;gap:6px">
            <button type="button" class="btn btn--sm banner-toggle">${esc(b.active ? t("끄기") : t("켜기"))}</button>
            <button type="button" class="btn btn--sm banner-edit">${esc(t("수정"))}</button>
            <button type="button" class="btn btn--sm btn--danger banner-delete">${esc(t("삭제"))}</button>
          </div>` : ""}
        </div>
        <p class="small" style="margin-top:6px;color:var(--text-muted)">
          <span class="m-label">${esc(t("기간"))}</span> ${esc(bannerPeriodText(b))}
          ${b.linkUrl ? ` · <span class="m-label">${esc(t("링크"))}</span> ${esc(b.linkUrl)}` : ""}
          ${b.messageEn || b.messageJa ? ` · ${esc([b.messageEn && "EN", b.messageJa && "JA"].filter(Boolean).join("·"))}` : ""}
        </p>
      </div>`;
  }

  async function paintAdminBanners() {
    const result = await adminFetch("/api/admin/banners");
    if (!result) return;
    bannersCache = result.items || [];
    const list = el("admin-banners-list");
    if (result.migrationMissing) {
      list.innerHTML = `<p class="small">${esc(t("DB 마이그레이션 056을 먼저 실행해 주세요."))}</p>`;
      return;
    }
    list.innerHTML = bannersCache.length
      ? bannersCache.map(bannerRowHTML).join("")
      : `<p class="small">${esc(t("등록된 배너가 없습니다"))}</p>`;
  }

  el("admin-banners-list").addEventListener("click", async (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    const b = bannersCache.find((x) => x.id === row.dataset.id);
    if (!b) return;
    if (e.target.closest(".banner-edit")) {
      bnEditingId = b.id;
      el("banner-form-title").textContent = t("배너 수정");
      el("bn-submit").textContent = t("저장");
      el("bn-message").value = b.message;
      el("bn-message-en").value = b.messageEn;
      el("bn-message-ja").value = b.messageJa;
      el("bn-link").value = b.linkUrl;
      el("bn-tone").value = b.tone;
      el("bn-starts").value = isoToLocalInput(b.startsAt);
      el("bn-ends").value = isoToLocalInput(b.endsAt);
      el("bn-order").value = String(b.sortOrder || 0);
      el("bn-active").checked = b.active;
      el("bn-cancel").hidden = false;
      if (b.linkUrl || b.messageEn || b.messageJa) el("banner-form").querySelector("details").open = true;
      el("banner-form").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (e.target.closest(".banner-toggle")) {
      const r = await adminFetch(`/api/admin/banners/${encodeURIComponent(b.id)}`, { method: "PATCH", body: JSON.stringify({ active: !b.active }) });
      if (!r) return;
      toast(r.active ? t("배너를 켰습니다") : t("배너를 껐습니다"));
      paintAdminBanners();
      return;
    }
    if (e.target.closest(".banner-delete")) {
      if (!confirm(t("이 배너를 삭제하시겠습니까? 되돌릴 수 없습니다."))) return;
      const r = await adminFetch(`/api/admin/banners/${encodeURIComponent(b.id)}`, { method: "DELETE" });
      if (!r) return;
      if (bnEditingId === b.id) resetBannerForm();
      toast(t("삭제했습니다"));
      paintAdminBanners();
    }
  });

  el("banner-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = el("bn-message").value.trim();
    if (!message) { toast(t("배너 문구를 입력해 주세요.")); return; }
    const body = {
      message,
      messageEn: el("bn-message-en").value.trim(),
      messageJa: el("bn-message-ja").value.trim(),
      linkUrl: el("bn-link").value.trim(),
      tone: el("bn-tone").value,
      startsAt: localInputToIso(el("bn-starts").value),
      endsAt: localInputToIso(el("bn-ends").value),
      sortOrder: Number(el("bn-order").value) || 0,
      active: el("bn-active").checked,
    };
    const btn = el("bn-submit");
    btn.disabled = true;
    try {
      const r = bnEditingId
        ? await adminFetch(`/api/admin/banners/${encodeURIComponent(bnEditingId)}`, { method: "PATCH", body: JSON.stringify(body) })
        : await adminFetch("/api/admin/banners", { method: "POST", body: JSON.stringify(body) });
      if (!r) return;
      toast(t("저장했습니다"));
      resetBannerForm();
      paintAdminBanners();
    } finally {
      btn.disabled = false;
    }
  });
  el("bn-cancel").addEventListener("click", () => resetBannerForm());
  resetBannerForm();
