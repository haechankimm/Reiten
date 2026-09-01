  /* ---------- 정보(설정) — 사업자 정보 요약, Supabase·Render 같은 운영 링크를 관리자가 직접 적어두는 곳 ---------- */
  let sfEditingId = null;
  const settingsState = { items: [] };

  function resetSettingsForm() {
    sfEditingId = null;
    el("settings-form-title").textContent = t("새 정보 추가");
    el("sf-label").value = "";
    el("sf-value").value = "";
    el("sf-note").value = "";
    el("sf-cancel").hidden = true;
    el("sf-delete").hidden = true;
  }

  function fillSettingsForm(item) {
    sfEditingId = item.id;
    el("settings-form-title").textContent = t("정보 수정");
    el("sf-label").value = item.label || "";
    el("sf-value").value = item.value || "";
    el("sf-note").value = item.note || "";
    el("sf-cancel").hidden = false;
    el("sf-delete").hidden = false;
    el("settings-form").scrollIntoView({ behavior: "smooth", block: "start" });
    /* 목록 맨 아래쪽 항목에서 "수정"을 눌러도 이 폼이 이미 화면 안에 있으면 스크롤이 아예
       안 움직여서(scrollIntoView가 할 일이 없음), "새 정보 추가"가 갑자기 "정보 수정"으로
       바뀌는 게 어디서 왜 일어난 건지 바로 눈에 안 띈다는 피드백(2026-09-01) — 짧게 테두리를
       반짝여서 스크롤 여부와 상관없이 시선이 가게 한다(returns-inventory.js의 저장 완료
       표시와 같은 원리: 클래스 잠깐 추가 후 제거). */
    const panel = el("settings-form").closest(".panel");
    panel.classList.add("panel--highlight");
    setTimeout(() => panel.classList.remove("panel--highlight"), 1200);
  }

  el("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      label: el("sf-label").value.trim(),
      value: el("sf-value").value.trim(),
      note: el("sf-note").value.trim(),
    };
    if (!body.label) { toast(t("이름을 입력해 주세요.")); return; }

    const btn = el("sf-submit");
    btn.disabled = true;
    try {
      const result = sfEditingId
        ? await adminFetch(`/api/admin/settings/${encodeURIComponent(sfEditingId)}`, { method: "PATCH", body: JSON.stringify(body) })
        : await adminFetch("/api/admin/settings", { method: "POST", body: JSON.stringify(body) });
      if (!result) return;
      toast(t("저장했습니다"));
      resetSettingsForm();
      paintAdminSettings();
    } finally {
      btn.disabled = false;
    }
  });

  el("sf-cancel").addEventListener("click", () => resetSettingsForm());
  el("sf-delete").addEventListener("click", async () => {
    if (!sfEditingId) return;
    if (!confirm(t("이 정보를 삭제하시겠습니까?"))) return;
    await adminFetch(`/api/admin/settings/${encodeURIComponent(sfEditingId)}`, { method: "DELETE" });
    toast(t("삭제했습니다"));
    resetSettingsForm();
    paintAdminSettings();
  });
  resetSettingsForm();

  function isUrl(v) {
    return /^https?:\/\//i.test(v);
  }

  /* ---------- 관리자 계정 관리 ----------
     예전엔 "고객 페이지에서 회원가입 → Supabase SQL로 role 수동 승격"을 거쳐야 했다. 이제
     이메일만 넣으면 서버가 Supabase Admin API로 초대 메일을 보내고, 그 메일의 링크를 타고
     들어간 account.html에서 본인이 직접 비밀번호를 정하면 끝난다(관리자가 임시 비밀번호를
     만들어 전달할 필요 없음). */
  let currentAdminId = null;
  /* 마스터 관리자(lib/auth.js의 MASTER_ADMIN_EMAIL)인지 — 서버는 이미 requireMasterAdmin으로
     막고 있으니 이 프런트 쪽 숨김은 실제 방어선이 아니라, 권한 없는 관리자에게 눌러도 되는
     것처럼 보이는 버튼을 안 보여줘 헷갈리지 않게 하는 용도일 뿐이다. */
  let isMasterAdmin = false;
  let notifPollTimer = null;

  function adminRowHTML(a) {
    const isSelf = a.id === currentAdminId;
    return `
      <div class="panel" data-id="${esc(a.id)}" style="display:flex;gap:12px;align-items:center">
        <div style="flex:1;min-width:0">
          <b>${esc(a.name || a.email)}</b>${isSelf ? ` <span class="small" style="color:var(--text-muted)">(${esc(t("나"))})</span>` : ""}
          <div class="small tnum" style="color:var(--text-muted)">${esc(a.email)}</div>
        </div>
        ${!isSelf && isMasterAdmin ? `<button type="button" class="btn btn--sm btn--danger admin-revoke">${esc(t("권한 해제"))}</button>` : ""}
      </div>`;
  }

  async function paintAdminAccounts() {
    el("admin-invite-form").hidden = !isMasterAdmin;
    const result = await adminFetch("/api/admin/admins");
    if (!result) return;
    el("admin-list").innerHTML = result.items.map(adminRowHTML).join("");
    el("admin-list").querySelectorAll(".admin-revoke").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        if (!confirm(t("이 계정의 관리자 권한을 해제할까요? (계정 자체는 남고, 일반 고객으로 전환됩니다)"))) return;
        const result = await adminFetch(`/api/admin/admins/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!result) return;
        toast(t("관리자 권한을 해제했습니다"));
        paintAdminAccounts();
      })
    );
  }

  /* downloadExportFile은 orders.js가 선언한 공용 헬퍼(인증 헤더가 필요해 <a href>로 바로
     못 걸고 fetch → blob → 임시 링크 클릭 방식을 씀 — 주문·재고·대시보드 내보내기와 동일 패턴). */
  el("backup-export").addEventListener("click", () => downloadExportFile("/api/admin/backup/export", "reiten-backup", "json"));

  el("admin-invite-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = el("ai-submit");
    btn.disabled = true;
    const email = el("ai-email").value.trim();
    const name = el("ai-name").value.trim();

    /* 이미 가입된 이메일(고객으로 먼저 가입한 사람 등)이면 서버가 409 + code:"already_registered"
       + existingId를 준다(routes/admins.js 참고) — "관리자로 승격할까요?"로 물어보고 확인되면
       members.js의 승격 엔드포인트를 그대로 재사용해야 해서, adminFetch(실패 시 토스트만 띄우고
       본문을 버림)로는 이 분기를 못 잡는다. 이 호출만 fetch를 직접 써서 응답 본문을 그대로 본다. */
    const token = await getAccessToken();
    if (!token) { toast(t("로그인이 만료되었습니다. 다시 로그인해 주세요.")); btn.disabled = false; return; }

    let res, body;
    try {
      res = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ email, name }),
      });
      body = await res.json().catch(() => ({}));
    } catch (err) {
      toast(t("요청이 실패했습니다"));
      btn.disabled = false;
      return;
    }

    if (res.status === 409 && body.code === "already_registered" && body.existingId) {
      btn.disabled = false;
      if (!confirm(body.error)) return;
      const promoted = await adminFetch(`/api/admin/members/${encodeURIComponent(body.existingId)}/promote`, { method: "PATCH" });
      if (!promoted) return;
      toast(t("관리자로 승격했습니다"));
      el("admin-invite-form").reset();
      paintAdminAccounts();
      return;
    }

    btn.disabled = false;
    if (!res.ok) {
      toast(body.error || t("요청이 실패했습니다") + ` (${res.status})`);
      return;
    }
    toast(t("초대 메일을 보냈습니다"));
    el("admin-invite-form").reset();
    paintAdminAccounts();
  });

  function settingRowHTML(item) {
    return `
      <div class="panel" data-id="${esc(item.id)}" style="display:flex;gap:12px;align-items:center">
        <div style="flex:1;min-width:0">
          <b>${esc(item.label)}</b>
          ${item.value ? `<div class="small tnum" style="word-break:break-all">${isUrl(item.value) ? `<a href="${esc(item.value)}" target="_blank" rel="noopener">${esc(item.value)}</a>` : esc(item.value)}</div>` : ""}
          ${item.note ? `<div class="small" style="color:var(--muted);margin-top:2px">${esc(item.note)}</div>` : ""}
        </div>
        <button type="button" class="btn btn--sm admin-setting-edit">${esc(t("수정"))}</button>
      </div>`;
  }

  function renderAdminSettings() {
    el("settings-list").innerHTML = settingsState.items.map(settingRowHTML).join("");
    el("settings-list").querySelectorAll(".admin-setting-edit").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-id]").dataset.id;
        const item = settingsState.items.find((x) => x.id === id);
        if (item) fillSettingsForm(item);
      })
    );
  }

  async function paintAdminSettings() {
    const result = await adminFetch("/api/admin/settings");
    if (!result) return;
    settingsState.items = result;
    renderAdminSettings();
  }

  /* ---------- CS 빠른 답변 템플릿 ----------
     완전 자동응답이 아니라 QnA 답변창에서 버튼 한 번으로 채워 넣는 문구 모음(023_qna_templates.sql).
     목록은 로그인 시 한 번 불러와 두고(qnaTemplates), QnA 카드를 다시 그릴 때마다 그 값을 그대로 쓴다 —
     템플릿을 추가·삭제하면 QnA 목록도 다시 그려서 드롭다운이 최신 상태를 반영하게 한다. */
  function qnaTemplateRowHTML(tpl) {
    return `<div class="best-row" data-id="${esc(tpl.id)}">
      <span></span>
      <span>${esc(tpl.label)}${tpl.keywords && tpl.keywords.length ? `<div class="small" style="color:var(--text-muted)">${esc(tpl.keywords.join(", "))}</div>` : ""}</span>
      <span></span>
      <button type="button" class="btn btn--sm btn--danger qt-delete">${esc(t("삭제"))}</button>
    </div>`;
  }

  async function paintQnaTemplates() {
    const result = await adminFetch("/api/admin/qna-templates");
    qnaTemplates = (result && result.items) || [];
    el("qna-template-list").innerHTML = qnaTemplates.length
      ? qnaTemplates.map(qnaTemplateRowHTML).join("")
      : `<p class="small" style="color:var(--text-muted)">${esc(t("등록된 템플릿이 없습니다"))}</p>`;
    el("qna-template-list").querySelectorAll(".qt-delete").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        btn.disabled = true;
        const ok = await adminFetch(`/api/admin/qna-templates/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!ok) { btn.disabled = false; return; }
        await paintQnaTemplates();
        renderAdminQna();
      })
    );
  }

  el("qna-template-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = el("qt-label").value.trim();
    const body = el("qt-body").value.trim();
    const keywords = el("qt-keywords").value.split(",").map((k) => k.trim()).filter(Boolean);
    if (!label || !body) { toast(t("템플릿 이름과 답변 내용을 입력해 주세요.")); return; }
    const btn = el("qt-submit");
    btn.disabled = true;
    const result = await adminFetch("/api/admin/qna-templates", { method: "POST", body: JSON.stringify({ label, body, keywords }) });
    btn.disabled = false;
    if (!result) return;
    el("qt-label").value = "";
    el("qt-body").value = "";
    el("qt-keywords").value = "";
    toast(t("템플릿을 추가했습니다"));
    await paintQnaTemplates();
    renderAdminQna();
  });

  /* ---------- 감사 로그 (관리자가 2명 이상일 때 "누가 언제 무엇을 바꿨는지" 추적용) ----------
     008_admin_audit_log.sql을 실행하지 않았으면 서버가 저장을 조용히 건너뛰므로 여기도 빈 목록만 보임. */
  const AUDIT_ACTION_LABELS = {
    "order.update": "주문 정보 변경",
    "order.export": "주문 목록 내보내기",
    "order.bulk_update": "주문 일괄 처리",
    "return.update": "반품 상태 변경",
    "return.restock": "반품 재고 복원",
    "return.refund": "반품 환불",
    "inventory.update": "재고 수정",
    "inventory.bulk_update": "재고 일괄 저장",
    "inventory.export": "재고 목록 내보내기",
    "dashboard.export": "대시보드 내보내기",
    "backup.export": "전체 데이터 백업 내보내기",
    "coupon.create": "쿠폰 생성",
    "coupon.update": "쿠폰 수정",
    "coupon.delete": "쿠폰 삭제",
    "product.create": "상품 등록",
    "product.update": "상품 수정",
    "product.delete": "상품 삭제",
    "product.bulk_active": "상품 일괄 공개/비공개",
    "product.bulk_color": "상품 일괄 컬러 추가",
    "product.bulk_delete": "상품 일괄 삭제",
    "lookbook.create": "룩북 칸 추가",
    "lookbook.update": "룩북 칸 수정",
    "lookbook.delete": "룩북 칸 삭제",
    "setting.create": "정보 추가",
    "setting.update": "정보 수정",
    "setting.delete": "정보 삭제",
    "review.update": "리뷰 승인/숨김",
    "review.bulk_approve": "리뷰 일괄 승인/숨김",
    "review.delete": "리뷰 삭제",
    "qna.answer": "문의 답변 등록",
  };
  function fmtDateTime(iso) {
    return new Date(iso).toLocaleString(getLang() === "de" ? "de-DE" : "ko-KR");
  }

  const auditLogState = { page: 0, pageSize: 30, total: 0, items: [], adminEmail: "", action: "", dateFrom: "", dateTo: "" };

  /* 로그에는 실제 이메일 전체를 저장해두지만(감사 목적상 정확한 기록이 필요), 화면에는
     "@" 앞부분만 이름처럼 잘라서 보여준다 — 저장된 값 자체는 안 바뀐다. */
  function emailName(email) {
    return String(email || "").split("@")[0];
  }

  function auditRowHTML(r) {
    const label = t(AUDIT_ACTION_LABELS[r.action] || r.action);
    const detailStr = r.detail && Object.keys(r.detail).length ? JSON.stringify(r.detail) : "";
    return `
      <div class="logrow">
        <span class="tnum small">${esc(fmtDateTime(r.at))}</span>
        <span class="small" title="${esc(r.adminEmail)}">${esc(emailName(r.adminEmail))}</span>
        <span class="logrow-action">${esc(label)}</span>
        <span>
          <span class="tnum">${esc(r.targetType)}:${esc(r.targetId)}</span>
          ${detailStr ? `<div class="logrow-detail">${esc(detailStr)}</div>` : ""}
        </span>
      </div>`;
  }

  function renderAuditLog() {
    el("auditlog-rows").innerHTML =
      auditLogState.items.map(auditRowHTML).join("") ||
      `<div class="logrow small" style="color:var(--text-muted)">${esc(t("아직 기록된 활동이 없습니다"))}</div>`;
    const hasMore = auditLogState.items.length < auditLogState.total;
    el("auditlog-more-wrap").innerHTML = loadMoreHTML(hasMore, "auditlog-more");
    el("auditlog-more")?.addEventListener("click", () => paintAdminAuditLog(true));
  }

  function renderAuditLogActionOptions() {
    const select = el("al-action");
    const known = new Set([...select.options].map((o) => o.value));
    Object.keys(AUDIT_ACTION_LABELS).forEach((action) => {
      if (known.has(action)) return;
      const opt = document.createElement("option");
      opt.value = action;
      opt.textContent = t(AUDIT_ACTION_LABELS[action]);
      select.appendChild(opt);
    });
  }

  async function paintAdminAuditLog(loadMore = false) {
    auditLogState.page = loadMore ? auditLogState.page + 1 : 1;
    const params = new URLSearchParams({ page: auditLogState.page, pageSize: auditLogState.pageSize });
    if (auditLogState.adminEmail) params.set("adminEmail", auditLogState.adminEmail);
    if (auditLogState.action) params.set("action", auditLogState.action);
    if (auditLogState.dateFrom) params.set("dateFrom", auditLogState.dateFrom);
    if (auditLogState.dateTo) params.set("dateTo", auditLogState.dateTo);
    const result = await adminFetch(`/api/admin/audit-log?${params.toString()}`);
    if (!result) return;
    auditLogState.total = result.total;
    auditLogState.items = loadMore ? auditLogState.items.concat(result.items) : result.items;
    renderAuditLog();
  }

  renderAuditLogActionOptions();
  el("al-search").addEventListener("click", () => {
    auditLogState.adminEmail = el("al-admin").value.trim();
    auditLogState.action = el("al-action").value;
    auditLogState.dateFrom = el("al-from").value;
    auditLogState.dateTo = el("al-to").value;
    paintAdminAuditLog();
  });
  el("al-reset").addEventListener("click", () => {
    el("al-admin").value = "";
    el("al-action").value = "";
    el("al-from").value = "";
    el("al-to").value = "";
    el("al-search").click();
  });
  el("al-admin").addEventListener("keydown", (e) => { if (e.key === "Enter") el("al-search").click(); });

