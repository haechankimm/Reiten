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
    if (!(await adminFetch(`/api/admin/settings/${encodeURIComponent(sfEditingId)}`, { method: "DELETE" }))) return;
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
  let currentAdminEmail = null; // notices.js가 "본인 글인지" 판단할 때 씀
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
          <span style="margin-left:6px">${roleBadgeHTML(isMasterAdmin && a.isMaster ? "main" : "operator")}</span>
          <div class="small tnum" style="color:var(--text-muted)">${esc(a.email)}</div>
        </div>
        ${!isSelf && isMasterAdmin ? `<button type="button" class="btn btn--sm btn--danger admin-revoke">${esc(t("권한 해제"))}</button>` : ""}
      </div>`;
  }

  /* 담당자 지정(주문·반품·QnA 상세)이 관리자 목록을 각자 또 불러오지 않고 이걸 재사용한다 —
     "정보" 탭보다 먼저 로그인 시점에 한 번 채워지므로(tryShowAdminPanel) 다른 탭이 먼저
     그려져도 대개 값이 있고, 혹시 비어 있으면 그 탭이 직접 한 번 더 불러오면 된다. */
  let adminListCache = [];
  function adminAssigneeOptionsHTML(selectedId) {
    const options = adminListCache
      .map((a) => `<option value="${esc(a.id)}" ${a.id === selectedId ? "selected" : ""}>${esc(a.name || a.email)}</option>`)
      .join("");
    return `<option value="">${esc(t("담당자 없음"))}</option>${options}`;
  }

  async function paintAdminAccounts() {
    el("admin-invite-form").hidden = !isMasterAdmin;
    const result = await adminFetch("/api/admin/admins");
    if (!result) return;
    adminListCache = result.items;
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
      if (!confirm(serverMsg(body, t("이미 가입된 이메일입니다. 관리자로 승격할까요?")))) return;
      const promoted = await adminFetch(`/api/admin/members/${encodeURIComponent(body.existingId)}/promote`, { method: "PATCH" });
      if (!promoted) return;
      toast(t("관리자로 승격했습니다"));
      el("admin-invite-form").reset();
      paintAdminAccounts();
      return;
    }

    btn.disabled = false;
    if (!res.ok) {
      toast(serverMsg(body, t("요청이 실패했습니다") + ` (${res.status})`));
      return;
    }
    toast(t("초대 메일을 보냈습니다"));
    el("admin-invite-form").reset();
    paintAdminAccounts();
  });

  /* 서버(routes/settings.js의 PROTECTED_SETTING_LABELS)가 메인 관리자만 고칠 수 있게 막는 항목 — 운영자에게도 "수정"
     버튼이 보여 눌러 고친 뒤 저장하면 403만 떴다(2026-10-28 정기 감사). 라벨이 바뀌면 서버 쪽 상수와 같이 고친다. */
  const MASTER_ONLY_SETTING_LABELS = [
    "첫 구매 감사 쿠폰 할인율(%)", "재구매 감사 쿠폰 발급 기준(누적 구매 횟수)", "재구매 감사 쿠폰 할인율(%)",
    "적립금 적립률(%)", "긴급 알림 웹훅 URL", "사진 리뷰 적립금(원)",
  ];
  // 서버가 운영자에게 웹훅 주소 대신 내려주는 자리표시 문구 — 이 값만 번역한다(다른 값은 관리자가 쓴 원문).
  const REDACTED_SETTING_VALUE = "(메인 관리자만 볼 수 있음)";

  function settingRowHTML(item) {
    const canEditThis = !MASTER_ONLY_SETTING_LABELS.includes(item.label) || (adminMe && adminMe.isMaster);
    const value = item.value === REDACTED_SETTING_VALUE ? t(item.value) : item.value;
    return `
      <div class="panel" data-id="${esc(item.id)}" style="display:flex;gap:12px;align-items:center">
        <div style="flex:1;min-width:0">
          <b>${esc(item.label)}</b>
          ${value ? `<div class="small tnum" style="word-break:break-all">${isUrl(value) ? `<a href="${esc(value)}" target="_blank" rel="noopener">${esc(value)}</a>` : esc(value)}</div>` : ""}
          ${item.note ? `<div class="small" style="color:var(--muted);margin-top:2px">${esc(item.note)}</div>` : ""}
        </div>
        ${canEditThis ? `<button type="button" class="btn btn--sm admin-setting-edit">${esc(t("수정"))}</button>` : ""}
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
  /* 템플릿 한 줄 — 예전엔 3칸짜리 .best-row에 4칸을 넣어 "삭제" 버튼이 28px 칸으로 밀려 "삭/제"로 깨졌다(2026-11-11). 답변 앞부분도 한 줄 미리보기. */
  function qnaTemplateRowHTML(tpl) {
    return `<div class="list-row" data-id="${esc(tpl.id)}">
      <div class="list-row-main">
        <b>${esc(tpl.label)}</b>
        ${tpl.keywords && tpl.keywords.length ? `<div class="small" style="color:var(--text-muted)">🔑 ${esc(tpl.keywords.join(", "))}</div>` : ""}
        ${tpl.body ? `<div class="small list-row-preview qt-preview" title="${esc(t("눌러서 전체 보기"))}">${esc(tpl.body)}</div>` : ""}
      </div>
      ${hasAreaEdit("qna") ? `<button type="button" class="btn btn--sm btn--danger qt-delete">${esc(t("삭제"))}</button>` : ""}
    </div>`;
  }

  async function paintQnaTemplates() {
    // 템플릿 추가·삭제는 서버에서 "qna"(문의·CS 템플릿) 영역 수정 권한을 따른다 — 정보 탭 권한이 아니라 그 권한으로 보이고 숨긴다(2026-10-28 정기 감사).
    el("qna-template-form").hidden = !hasAreaEdit("qna");
    const result = await adminFetch("/api/admin/qna-templates");
    qnaTemplates = (result && result.items) || [];
    el("qna-template-list").innerHTML = qnaTemplates.length
      ? qnaTemplates.map(qnaTemplateRowHTML).join("")
      : `<p class="small" style="color:var(--text-muted)">${esc(t("등록된 템플릿이 없습니다"))}</p>`;
    // 답변은 두 줄까지만 보이고, 누르면 줄바꿈 그대로 전체가 펼쳐진다(2026-11-11 — 한 줄로 길게 잘려 보였음)
    el("qna-template-list").querySelectorAll(".qt-preview").forEach((node) =>
      node.addEventListener("click", () => node.classList.toggle("is-open"))
    );
    el("qna-template-list").querySelectorAll(".qt-delete").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm(t("이 빠른 답변 템플릿을 삭제할까요?"))) return; // 실수로 지우지 않게(2026-11-11 점검)
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
    // 실시간 에이전트 AI·공급처(2026-11-10~11)
    "bot.diagnostics_read": "AI 서버 진단 조회",
    "bot.briefing_read": "AI 아침 브리핑 조회",
    "bot.qna_pending_read": "AI 답변 대기 문의 조회",
    "bot.qna_draft": "AI 문의 답변 초안 작성",
    "bot.supplier_shipment_create": "AI 공급처 송장 등록",
    "bot.supplier_shipment_update": "AI 공급처 송장 갱신",
    "bot.supplier_invoice_create": "AI 매입 기록",
    "bot.supplier_invoice_update": "AI 매입 기록 갱신",
    "supplier_shipment.create": "공급처 송장 직접 등록",
    "supplier_shipment.update": "공급처 송장 수정",
    "supplier_shipment.status": "공급처 송장 상태 변경",
    "supplier_shipment.receive": "공급처 입고 처리",
    "supplier_shipment.receive_undo": "공급처 입고 취소",
    "supplier_invoice.create": "매입 직접 입력",
    "supplier_invoice.update": "매입 기록 수정",
    "supplier_invoice.status": "매입 확인·제외",
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
    // 2026-10-28 정기 감사: 로그에는 남는데 이름이 없어 키 그대로 보이던 동작들
    "order.return_refund": "반품 환불",
    "order.partial_cancel": "부분 취소",
    "order.cancel_from_request": "주문취소 신청 승인",
    "return.reship": "교환 재발송",
    "qna.update": "문의 담당·메모 수정",
    "qna_template.create": "CS 템플릿 저장",
    "qna_template.delete": "CS 템플릿 삭제",
    "product.bulk_price": "상품 일괄 가격 수정",
    "color.create": "색상 추가",
    "color.update": "색상 수정",
    "color.delete": "색상 삭제",
    "member.delete": "회원 삭제",
    "member.export": "회원 목록 내보내기",
    "member.promote": "운영자로 승격",
    "member.ban": "회원 차단",
    "member.unban": "회원 차단 해제",
    "member.resendConfirmation": "인증 메일 재발송",
    "member.verifyEmail": "이메일 수동 인증",
    "notice.create": "공지 등록",
    "notice.update": "공지 수정",
    "notice.delete": "공지 삭제",
    "handoff_note.create": "인수인계 노트 작성",
    "handoff_note.delete": "인수인계 노트 삭제",
    "calendar_event.create": "일정 추가",
    "calendar_event.update": "일정 수정",
    "calendar_event.delete": "일정 삭제",
    "staff.password": "직원 비밀번호 변경",
    "staff.permissions": "직원 권한 변경",
    "staff.pin_reset": "직원 PIN 초기화",
    "staff.pin_set": "직원 PIN 지정",
    "admin.invite": "관리자 초대",
    "admin.revoke": "관리자 권한 해제",
    "admin.pin_setup": "PIN 설정함", // PIN 설정 창 제목 "PIN 설정"(PIN festlegen)과 번역이 겹치지 않게 별도 키(2026-10-28 정기 감사)
    "admin.pin_change": "PIN 변경함", // 상단 "PIN 변경"(PIN ändern) 버튼과 번역이 겹치지 않게 별도 키(2026-10-28 정기 감사)
    "admin.pin_locked": "PIN 잠김",
    "backup.full_download": "전체 백업 다운로드(주문·회원 포함)",
    "report.settlement_download": "정산 리포트 받기",
    "report.settlement_send": "정산 리포트 메일 재발송",
    // 2026-11-11: 로그에는 남는데 이름이 없어 키 그대로 보이던 것
    "agent.policy": "AI 자동 실행 규칙 변경",
    "agent.undo": "AI 실행 되돌리기",
    "bot.expense_summary_read": "AI 지출 요약 조회",
    "expense.budgets": "지출 예산 변경",
    "expense.cost_items": "상품 원가 구성 수정",
    "expense.export": "지출 내보내기",
    "expense.import": "지출 가져오기",
    "expense.partners": "동업자 지분 변경",
    "expense.recurring_create": "정기 지출 추가",
    "expense.recurring_update": "정기 지출 수정",
    "expense.settle": "동업자 정산 확정",
    "expense.settle_cancel": "동업자 정산 취소",
    "expense.unit_costs": "상품 원가 일괄 수정",
  };
  function fmtDateTime(iso) {
    return new Date(iso).toLocaleString(getLang() === "de" ? "de-DE" : "ko-KR");
  }

  const auditLogState = { page: 0, pageSize: 30, total: 0, items: [], adminEmail: "", action: "", dateFrom: "", dateTo: "" };

  /* 로그에는 실제 이메일 전체를 저장해두지만(감사 목적상 정확한 기록이 필요), 화면에는
     "@" 앞부분만 이름처럼 잘라서 보여준다 — 저장된 값 자체는 안 바뀐다. */
  function emailName(email) {
    // 실시간 에이전트 AI(서버 기록은 "bot:pickle")는 다른 관리자도 알아보게 이름으로 보여준다(2026-11-11)
    if (/^bot:/i.test(String(email || ""))) return t("실시간 에이전트 AI");
    return String(email || "").split("@")[0];
  }

  /* 활동 로그를 읽기 쉽게(2026-11-11 사용자 요청) — 날짜별 묶음 + 시간만, 대상은 "상품 tshirt"처럼 한국어로,
     내용은 원본 JSON 대신 주요 값 몇 개만 칩으로 보이고 "자세히"를 누르면 전체가 펼쳐진다. */
  const AUDIT_TARGET_LABELS = {
    product: "상품", products: "상품", order: "주문", notice: "공지", calendar_event: "일정", qna: "문의", qna_template: "CS 템플릿",
    coupon: "쿠폰", member: "회원", review: "리뷰", lookbook: "룩북", setting: "정보", inventory: "재고", return: "반품",
    agent_action: "AI 제안", supplier_shipment: "공급처 송장", supplier_invoice: "매입", color: "색상", handoff_note: "인수인계 노트",
    expense: "지출", staff: "직원", admin: "관리자", backup: "백업", report: "리포트",
    expense_settlement: "동업자 정산", expense_partners: "동업자", expense_budgets: "예산", expense_recurring: "정기 지출",
    supplier_invoices: "매입", agent_policy: "AI 자동 실행 규칙",
  };
  const AUDIT_DETAIL_LABELS = {
    title: "제목", name: "영문 이름", name_ko: "이름", nameKo: "이름", label: "이름", price: "가격", active: "공개", status: "상태",
    qty: "수량", count: "건수", date: "날짜", endDate: "종료일", amount: "금액", reason: "사유", size: "사이즈", color: "컬러",
    memo: "메모", email: "이메일", unitCost: "원가", sold_out: "품절", viaAgentAction: "AI 제안 번호", month: "월",
    colors: "컬러", after: "변경 후", before: "변경 전", total: "합계", tracking: "송장번호", type: "종류", note: "메모",
  };
  // 칩에는 안 보이는(자세히에만) 값 — 접속 IP·시각·긴 본문·사진 목록 등
  const AUDIT_DETAIL_SKIP = new Set(["ip", "updated_at", "created_at", "images", "media", "translations", "description", "details", "body", "short", "model_info", "size_table", "image_colors"]);

  function auditTargetText(r) {
    if (r.targetType === "system") return t("시스템");
    const label = AUDIT_TARGET_LABELS[r.targetType] ? t(AUDIT_TARGET_LABELS[r.targetType]) : r.targetType;
    const id = String(r.targetId || "");
    // 긴 내부 ID(uuid)는 앞 8자리만
    const shortId = /^[0-9a-f-]{30,}$/i.test(id) ? id.slice(0, 8) : id;
    return shortId && shortId !== "undefined" ? `${label} · ${shortId}` : label;
  }

  function auditChipValue(v) {
    if (typeof v === "boolean") return t(v ? "예" : "아니오");
    if (typeof v === "number") return v.toLocaleString();
    if (Array.isArray(v)) return v.every((x) => x === null || typeof x !== "object") ? v.filter((x) => x !== null).join(", ") : t("{n}개", { n: v.length });
    if (v && typeof v === "object") return null;
    const s = String(v ?? "");
    return s.length > 40 ? s.slice(0, 39) + "…" : s;
  }

  function auditDetailChips(detail) {
    if (!detail || typeof detail !== "object") return "";
    const chips = [];
    for (const [k, v] of Object.entries(detail)) {
      if (AUDIT_DETAIL_SKIP.has(k) || v === null || v === undefined || v === "") continue;
      const val = auditChipValue(v);
      if (val === null || val === "") continue;
      chips.push(`<span class="logchip"><span class="logchip-k">${esc(AUDIT_DETAIL_LABELS[k] ? t(AUDIT_DETAIL_LABELS[k]) : k)}</span>${esc(val)}</span>`);
      if (chips.length >= 5) break;
    }
    return chips.join("");
  }

  function auditDayKey(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  function auditDayLabel(iso) {
    const d = new Date(iso);
    const today = new Date();
    const yest = new Date(Date.now() - 86400000);
    if (auditDayKey(iso) === auditDayKey(today.toISOString())) return t("오늘");
    if (auditDayKey(iso) === auditDayKey(yest.toISOString())) return t("어제");
    return d.toLocaleDateString(getLang() === "de" ? "de-DE" : "ko-KR", { month: "long", day: "numeric", weekday: "short" });
  }

  function auditRowHTML(r) {
    const label = t(AUDIT_ACTION_LABELS[r.action] || r.action);
    const hasDetail = r.detail && Object.keys(r.detail).length;
    const isBot = /^bot:/i.test(String(r.adminEmail || ""));
    const time = new Date(r.at).toLocaleTimeString(getLang() === "de" ? "de-DE" : "ko-KR", { hour: "2-digit", minute: "2-digit" });
    return `
      <div class="logrow${isBot ? " is-bot" : ""}">
        <span class="tnum small" title="${esc(fmtDateTime(r.at))}">${esc(time)}</span>
        <span class="small" title="${esc(r.adminEmail)}">${esc(emailName(r.adminEmail))}</span>
        <span class="logrow-action">${esc(label)}</span>
        <span class="logrow-target">
          <span>${esc(auditTargetText(r))}</span>
          ${hasDetail ? `<span class="logrow-chips">${auditDetailChips(r.detail)}</span>
          <details class="logrow-more"><summary>${esc(t("자세히"))}</summary><pre>${esc(JSON.stringify(r.detail, null, 2))}</pre></details>` : ""}
        </span>
      </div>`;
  }

  function renderAuditLog() {
    let lastDay = "";
    const rows = auditLogState.items.map((r) => {
      const day = auditDayKey(r.at);
      const head = day !== lastDay ? `<div class="logrow-day">${esc(auditDayLabel(r.at))}</div>` : "";
      lastDay = day;
      return head + auditRowHTML(r);
    });
    el("auditlog-rows").innerHTML =
      rows.join("") ||
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
    // 특정 작업 종류를 골랐으면 그대로 보여 주고, 아니면 "AI 조회 기록 보기"를 켰을 때만 AI 조회 기록을 포함
    if (!auditLogState.action && !el("al-show-bot").checked) params.set("hideBotReads", "1");
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
    el("al-show-bot").checked = false;
    el("al-search").click();
  });
  el("al-admin").addEventListener("keydown", (e) => { if (e.key === "Enter") el("al-search").click(); });
  el("al-show-bot").addEventListener("change", () => el("al-search").click());

