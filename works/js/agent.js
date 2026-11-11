  /* ---------- AI 승인함 (2026-11-11, 마이그레이션 054) ----------
     실시간 에이전트 AI가 "제안"한 작업(운송장 입력·입금 확인·입고·답변 등록·지출 확인·판매 중지/재개·재고 조정·리뷰 승인)을
     종류별로 묶어 보여준다. 체크해서 한 번에 승인·거절, 카드마다 바뀌기 전 → 후. 승인하면 서버가 승인한 사람의 권한으로 그 작업만 실행.
     처리 기록에서 되돌릴 수 있는 작업은 "되돌리기". 메인 관리자는 "AI 권한 설정"에서 전체·작업별 허용과 조건부 자동 승인(기본 꺼짐)을 바꾼다.
     AI가 적은 근거·고객 문의 글은 외부 글이라 esc()로만 넣는다. */
  const AGENT_STATUS = { PENDING: ["대기 중", "st-pending"], EXECUTED: ["실행됨", "st-done"], FAILED: ["실패", "st-neutral"], REJECTED: ["거절", "st-neutral"], EXPIRED: ["만료", "st-neutral"], CANCELED: ["취소", "st-neutral"], UNDONE: ["되돌림", "st-neutral"] };
  const agentState = { view: "pending", data: null };

  function agentPreviewHTML(pv) {
    const lines = (pv && pv.lines) || [];
    return `${lines.map((l) => `<div class="agent-line"><span class="agent-line-label">${esc(t(l.label))}</span>
      ${l.before ? `<span class="agent-before">${esc(l.before)}</span>` : ""}${l.before && l.after ? ` <span aria-hidden="true">→</span> ` : ""}${l.after ? `<b class="agent-after">${esc(l.after)}</b>` : ""}</div>`).join("")}
      ${pv && pv.note ? `<div class="small" style="color:var(--status-pending-ink);margin-top:2px">⚠ ${esc(t(pv.note))}</div>` : ""}`;
  }

  function agentItemHTML(a, canDecide) {
    const left = Math.max(0, Math.round((new Date(a.expiresAt).getTime() - Date.now()) / 3600e3));
    return `<label class="agent-item" data-id="${esc(a.id)}">
      <input type="checkbox" class="agent-check" value="${esc(a.id)}" ${canDecide ? "" : "disabled"}>
      <div style="flex:1;min-width:0">
        <div><b>${esc(a.target || "")}</b> <span class="small" style="color:var(--text-muted)">#${esc(a.id)} · ${fmtDate(a.createdAt)} · ${esc(t("{h}시간 뒤 만료", { h: left }))}</span></div>
        ${a.reason ? `<div class="small" style="margin-top:2px">🤖 ${esc(a.reason)}</div>` : ""}
        <div style="margin-top:4px">${agentPreviewHTML(a.preview)}</div>
      </div>
    </label>`;
  }

  function agentPendingHTML(d) {
    const groups = new Map();
    d.items.forEach((a) => { if (!groups.has(a.type)) groups.set(a.type, []); groups.get(a.type).push(a); });
    if (!groups.size) return `<p class="panel" style="color:var(--text-muted)">${esc(t("승인을 기다리는 AI 제안이 없습니다"))}</p>`;
    return [...groups.entries()].map(([type, items]) => {
      const can = !!(d.canDecide && d.canDecide[type]);
      return `<div class="panel agent-group" data-type="${esc(type)}" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="agent-all" ${can ? "" : "disabled"}><b>${esc(t(items[0].label))}</b> <span class="small" style="color:var(--text-muted)">${esc(t("{n}건", { n: items.length }))}</span></label>
          ${can ? `<div style="display:flex;gap:6px"><button type="button" class="btn btn--sm agent-approve" disabled>${esc(t("선택 승인"))}</button><button type="button" class="btn btn--sm btn--ghost agent-reject" disabled>${esc(t("선택 거절"))}</button></div>` : ""}
        </div>
        <div class="agent-items" data-compact="10" data-compact-search="15">${items.map((a) => agentItemHTML(a, can)).join("")}</div>
      </div>`;
    }).join("");
  }

  function agentHistoryHTML(d) {
    if (!d.items.length) return `<p class="panel" style="color:var(--text-muted)">${esc(t("아직 처리 기록이 없습니다"))}</p>`;
    return `<div class="panel"><div data-compact="20" data-compact-search="20">${d.items.map((a) => {
      const [label, cls] = AGENT_STATUS[a.status] || [a.status, "st-neutral"];
      const canUndo = a.status === "EXECUTED" && a.undoable && d.canDecide && d.canDecide[a.type];
      return `<div class="list-row" data-id="${esc(a.id)}">
        <div class="list-row-main">
          <span class="status-chip ${cls}">${esc(t(label))}</span> <b>${esc(t(a.label))}</b> · ${esc(a.target || "")}
          ${a.autoApproved ? `<span class="status-chip st-confirmed">${esc(t("자동 승인"))}</span>` : ""}
          <div class="small" style="color:var(--text-muted);margin-top:2px">#${esc(a.id)} · ${a.decidedBy ? `${esc(emailName(a.decidedBy))} · ${fmtDate(a.decidedAt)}` : fmtDate(a.createdAt)}${a.decisionNote ? ` · 📝 ${esc(a.decisionNote)}` : ""}</div>
          ${a.error ? `<div class="small" style="color:var(--danger)">${esc(a.error)}</div>` : ""}
          <div class="small" style="margin-top:2px">${agentPreviewHTML(a.preview)}</div>
        </div>
        ${canUndo ? `<button type="button" class="btn btn--sm btn--ghost agent-undo">${esc(t("되돌리기"))}</button>` : ""}
      </div>`;
    }).join("")}</div></div>`;
  }

  async function paintAgent() {
    const res = await adminFetch(`/api/admin/agent-actions?view=${agentState.view}`);
    if (!res) return;
    agentState.data = res;
    el("agent-migration-note").hidden = !res.migrationMissing;
    el("agent-policy-toggle").hidden = !res.isMaster || res.migrationMissing;
    const off = res.policy && !res.policy.enabled;
    el("agent-off-note").hidden = !off;
    el("agent-off-note").textContent = off ? t("AI 작업 제안이 지금 전체 꺼져 있습니다(AI 권한 설정). 새 제안이 들어오지 않습니다.") : "";
    if (res.migrationMissing) { el("agent-list").innerHTML = ""; return; }
    el("agent-list").innerHTML = agentState.view === "pending" ? agentPendingHTML(res) : agentHistoryHTML(res);
    initCompactLists(el("agent-list"));
  }

  el("agent-view")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    agentState.view = b.dataset.view;
    el("agent-view").querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    paintAgent();
  });

  function groupSelection(group) {
    return [...group.querySelectorAll(".agent-check:checked")].map((c) => c.value);
  }
  el("agent-list")?.addEventListener("change", (e) => {
    const group = e.target.closest(".agent-group");
    if (!group) return;
    if (e.target.classList.contains("agent-all")) group.querySelectorAll(".agent-check:not(:disabled)").forEach((c) => { if (!c.closest("[hidden]")) c.checked = e.target.checked; });
    const n = groupSelection(group).length;
    group.querySelectorAll(".agent-approve, .agent-reject").forEach((b) => { b.disabled = !n; });
    const ap = group.querySelector(".agent-approve");
    if (ap) ap.textContent = n ? t("{n}건 승인", { n }) : t("선택 승인");
  });
  el("agent-list")?.addEventListener("click", async (e) => {
    const group = e.target.closest(".agent-group");
    const approve = e.target.closest(".agent-approve");
    const reject = e.target.closest(".agent-reject");
    if (group && (approve || reject)) {
      const ids = groupSelection(group);
      if (!ids.length) return;
      let note = "";
      if (approve && !confirm(t("선택한 {n}건을 승인할까요? 승인하면 바로 실행됩니다.", { n: ids.length }))) return;
      if (reject) { note = prompt(t("거절 사유(선택) — AI가 참고합니다")) || ""; }
      (approve || reject).disabled = true;
      const r = await adminFetch("/api/admin/agent-actions/decide", { method: "POST", body: JSON.stringify({ ids, decision: approve ? "approve" : "reject", note }) });
      if (!r) { (approve || reject).disabled = false; return; }
      const done = r.results.filter((x) => x.ok).length;
      const failed = r.results.filter((x) => !x.ok);
      toast(approve ? t("{ok}건 실행, {fail}건 실패", { ok: done, fail: failed.length }) : t("{n}건 거절했습니다", { n: done }));
      if (failed.length) setTimeout(() => toast(failed.map((x) => `#${x.id}: ${x.error || x.status}`).join("\n")), 2700);
      paintAgent();
      paintNotifications();
      return;
    }
    const undo = e.target.closest(".agent-undo");
    if (undo) {
      const id = undo.closest("[data-id]").dataset.id;
      if (!confirm(t("이 작업을 되돌릴까요?"))) return;
      if (await adminFetch(`/api/admin/agent-actions/${encodeURIComponent(id)}/undo`, { method: "POST" })) { toast(t("되돌렸습니다")); paintAgent(); }
    }
  });

  /* ---------- AI 권한 설정(메인 관리자) ---------- */
  function policyHTML(p, cat) {
    return `<div style="position:relative"><button type="button" class="form-x agent-policy-close" aria-label="${esc(t("닫기"))}" title="${esc(t("닫기"))}">✕</button></div>
      <b>${esc(t("AI 권한 설정"))}</b>
      <p class="small" style="color:var(--text-muted);margin:4px 0 10px">${esc(t("AI가 제안할 수 있는 작업을 정합니다. 끄면 그 작업은 제안 자체가 거절됩니다. 조건부 자동 승인은 켠 작업만, 하루 건수·금액 안에서 사람 승인 없이 실행됩니다(기본 꺼짐). 바꾼 내용은 활동 로그에 남습니다."))}</p>
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><input type="checkbox" id="ap-enabled" ${p.enabled ? "checked" : ""}><b>${esc(t("AI 작업 제안 전체 허용"))}</b> <span class="small" style="color:var(--text-muted)">${esc(t("— 끄면 모든 작업 제안이 즉시 막힙니다(비상 정지)"))}</span></label>
      <div class="exp-grid small" style="grid-template-columns:minmax(0,1.4fr) .6fr .8fr .8fr 1fr">
        <b>${esc(t("작업"))}</b><b>${esc(t("허용"))}</b><b>${esc(t("자동 승인"))}</b><b>${esc(t("하루 자동 한도"))}</b><b>${esc(t("자동 금액 상한(원)"))}</b>
        ${Object.entries(cat).map(([k, c]) => {
          const a = p.actions[k] || {};
          return `<span>${esc(t(c.label))}${c.undoable ? "" : ` <span style="color:var(--text-muted)">${esc(t("(되돌리기 없음)"))}</span>`}</span>
            <input type="checkbox" data-ap="${k}" data-f="enabled" ${a.enabled ? "checked" : ""}>
            <input type="checkbox" data-ap="${k}" data-f="autoApprove" ${a.autoApprove ? "checked" : ""} ${c.autoAllowed ? "" : `disabled title="${esc(t("고객에게 글이 나가거나 되돌리기 어려운 작업은 자동 승인할 수 없습니다"))}"`}>
            <input type="number" min="0" max="500" data-ap="${k}" data-f="autoDailyLimit" value="${esc(a.autoDailyLimit)}" ${c.autoAllowed ? "" : "disabled"}>
            ${c.amountBased ? `<input type="number" min="0" data-ap="${k}" data-f="autoMaxAmount" value="${esc(a.autoMaxAmount ?? "")}">` : "<span>—</span>"}`;
        }).join("")}
      </div>
      <div style="display:flex;gap:6px;margin-top:10px"><button type="button" class="btn btn--sm" id="ap-save">${esc(t("저장"))}</button><button type="button" class="btn btn--sm btn--ghost agent-policy-close">${esc(t("닫기"))}</button></div>`;
  }
  el("agent-policy-toggle")?.addEventListener("click", async () => {
    const box = el("agent-policy");
    if (!box.hidden) { box.hidden = true; setDisclosure(el("agent-policy-toggle"), false); return; }
    const r = await adminFetch("/api/admin/agent-policy");
    if (!r || r.migrationMissing) return;
    box.innerHTML = policyHTML(r.policy, r.catalog);
    box.hidden = false;
    setDisclosure(el("agent-policy-toggle"), true);
  });
  el("agent-policy")?.addEventListener("click", async (e) => {
    if (e.target.closest(".agent-policy-close")) { el("agent-policy").hidden = true; setDisclosure(el("agent-policy-toggle"), false); return; }
    if (e.target.id !== "ap-save") return;
    const policy = { enabled: el("ap-enabled").checked, actions: {} };
    el("agent-policy").querySelectorAll("[data-ap]").forEach((i) => {
      const a = (policy.actions[i.dataset.ap] = policy.actions[i.dataset.ap] || {});
      a[i.dataset.f] = i.type === "checkbox" ? i.checked : i.value === "" ? null : Number(i.value);
    });
    const anyAuto = Object.values(policy.actions).some((a) => a.autoApprove);
    if (anyAuto && !confirm(t("조건부 자동 승인을 켠 작업은 사람 확인 없이 실행됩니다. 저장할까요?"))) return;
    if (await adminFetch("/api/admin/agent-policy", { method: "PUT", body: JSON.stringify({ policy }) })) {
      toast(t("AI 권한 설정을 저장했습니다"));
      el("agent-policy").hidden = true;
      setDisclosure(el("agent-policy-toggle"), false);
      paintAgent();
    }
  });

  // 이미 열린 Works에서 폰 푸시를 누르면 서비스 워커가 보내는 메시지로 그 탭을 연다
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "open-tab" && e.data.tab && e.data.tab !== "systemErrors") goToTab(e.data.tab);
    });
  }
