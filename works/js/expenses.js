  /* ---------- 지출·정산 (2026-11-11, 마이그레이션 052) ----------
     예전 대시보드 "매입 장부"를 사업의 모든 지출을 담는 탭으로 넓혔다(서버: routes/supplierInvoices.js·routes/expenses.js).
     - 지출 입력·수정·확인/제외(되돌리기 토스트), 분류·결제수단·낸 사람·공동/개인 부담·증빙
     - 동업자 정산(개인 돈으로 낸 공동 지출을 비율대로, 정산 기록·취소)
     - 분류별 합계·예산, 6개월 추이, 정기 지출, 상품별 마진(원가), 동업자 설정
     - 카드사·은행 CSV 가져오기(열 고르기·미리보기·중복 방지), 장부 CSV/엑셀, AI 피드백용 요약 복사
     거래처·적요·메모는 외부(메일·카드 내역)에서 온 글일 수 있어 esc()로만 넣는다. */
  const EXP_STATUS_LABEL = { RECORDED: "확인 대기", CONFIRMED: "확인", REJECTED: "제외" };
  const EXP_STATUS_CLASS = { RECORDED: "st-pending", CONFIRMED: "st-done", REJECTED: "st-neutral" };
  const EXP_VAT_LABEL = { yes: "공제 후보", check: "공제 확인 필요", no: "불공제" };
  const expState = { meta: null, items: new Map(), csv: null };
  const expWon = (n) => `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}${t("원")}`;

  function expMonth() {
    const m = el("exp-month");
    if (!m.value) {
      const d = new Date();
      m.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    return m.value;
  }
  function expEditable() { return !adminMe || canEdit("expenses"); }
  function catLabel(k) { const c = expState.meta && expState.meta.categories[k]; return t((c && c.label) || k || "기타"); }
  function methodLabel(k) { return k ? t((expState.meta && expState.meta.paymentMethods[k]) || k) : ""; }
  function partnerName(id) {
    if (!id || id === "business") return t("사업자");
    const p = ((expState.meta && expState.meta.partners) || []).find((x) => x.id === id);
    return p ? p.name : id;
  }
  function options(map, selected, { empty } = {}) {
    return (empty ? `<option value="">${esc(t(empty))}</option>` : "") +
      Object.entries(map).map(([k, v]) => `<option value="${esc(k)}" ${k === selected ? "selected" : ""}>${esc(t(typeof v === "string" ? v : v.label))}</option>`).join("");
  }
  function fundedOptions(selected) {
    const partners = (expState.meta && expState.meta.partners) || [];
    return `<option value="business" ${selected === "business" ? "selected" : ""}>${esc(t("사업자(사업자 카드·계좌)"))}</option>` +
      partners.filter((p) => p.active !== false).map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? "selected" : ""}>${esc(p.name)} ${esc(t("(개인 돈)"))}</option>`).join("");
  }

  /* ---------- 지출 입력·수정 폼 ---------- */
  function expenseFormHTML(v) {
    const isEdit = !!v;
    v = v || {};
    const meta = expState.meta;
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const defaultFunded = v.fundedBy || (meta && meta.myPartnerId) || "business";
    return `
      <div class="exp-form mini-form">
        <label>${esc(t("거래처"))}<input class="ef-supplier" value="${esc(v.supplierLabel || v.supplierName || "")}" placeholder="${esc(t("예: 프린트캔버스, 쿠팡, Meta 광고"))}"></label>
        <label>${esc(t("날짜"))}<input type="date" class="ef-date" value="${esc(v.issuedOn || today)}"></label>
        <label>${esc(t("합계(원)"))}<input type="number" min="0" class="ef-total" value="${esc(v.totalAmount ?? "")}"></label>
        <label>${esc(t("분류"))}<select class="ef-category">${options(meta.categories, v.category || "purchase")}</select></label>
        <label>${esc(t("결제수단"))}<select class="ef-method">${options(meta.paymentMethods, v.paymentMethod || "", { empty: "선택" })}</select></label>
        <label>${esc(t("카드 뒤 4자리"))}<input class="ef-card" inputmode="numeric" maxlength="4" value="${esc(v.cardLast4 || "")}"></label>
        <label>${esc(t("낸 사람(누구 돈)"))}<select class="ef-funded">${fundedOptions(defaultFunded)}</select></label>
        <label>${esc(t("부담"))}<select class="ef-shared"><option value="true" ${v.shared !== false ? "selected" : ""}>${esc(t("공동(비율대로 나눔)"))}</option><option value="false" ${v.shared === false ? "selected" : ""}>${esc(t("낸 사람 혼자 부담"))}</option></select></label>
        <label>${esc(t("증빙"))}<select class="ef-evidence">${options(meta.evidenceTypes, v.evidenceType || "", { empty: "선택" })}</select></label>
        <label>${esc(t("증빙번호(선택)"))}<input class="ef-docno" value="${esc(v.docNumber || "")}"></label>
        <label>${esc(t("공급가액(선택)"))}<input type="number" min="0" class="ef-supply" value="${esc(v.supplyAmount ?? "")}"></label>
        <label>${esc(t("부가세(선택)"))}<input type="number" min="0" class="ef-vat" value="${esc(v.vatAmount ?? "")}"></label>
        <label class="mini-form-wide">${esc(t("적요(품목)"))}<input class="ef-items" value="${esc(v.itemsSummary || "")}"></label>
        <label class="mini-form-wide">${esc(t("메모"))}<input class="ef-memo" value="${esc(v.memo || "")}"></label>
        <div class="mini-form-actions">
          <button type="button" class="btn btn--sm ef-save">${esc(t(isEdit ? "저장" : "등록"))}</button>
          <button type="button" class="btn btn--sm btn--ghost ef-cancel">${esc(t("닫기"))}</button>
          <span class="small" style="color:var(--text-muted)">${esc(t(isEdit ? (v.settlementId ? "정산에 포함된 지출 — 금액·낸 사람은 정산 취소 후 수정할 수 있습니다." : "바꾸기 전 값은 활동 로그에 남습니다.") : "직접 입력한 지출은 바로 확인 상태로 저장됩니다."))}</span>
        </div>
      </div>`;
  }

  function readExpenseForm(form) {
    const val = (c) => form.querySelector(c).value.trim();
    const num = (c) => (val(c) === "" ? "" : Number(val(c)));
    const supplier = val(".ef-supplier");
    const evidence = val(".ef-evidence");
    return {
      supplierLabel: supplier,
      supplierName: supplier,
      issuedOn: val(".ef-date"),
      totalAmount: num(".ef-total"),
      category: val(".ef-category"),
      paymentMethod: val(".ef-method"),
      cardLast4: val(".ef-card"),
      fundedBy: val(".ef-funded"),
      shared: val(".ef-shared") === "true",
      evidenceType: evidence,
      docType: evidence === "tax_invoice" ? "tax_invoice" : evidence === "card" || evidence === "cash_receipt" || evidence === "simple_receipt" ? "receipt" : "other",
      docNumber: val(".ef-docno"),
      supplyAmount: num(".ef-supply"),
      vatAmount: num(".ef-vat"),
      itemsSummary: val(".ef-items"),
      memo: val(".ef-memo"),
    };
  }

  // 결제수단을 고르면 낸 사람을 맞춰 준다(사업자 카드·자동이체 → 사업자, 개인 카드 → 나)
  document.addEventListener("change", (e) => {
    const sel = e.target.closest(".ef-method");
    if (!sel) return;
    const form = sel.closest(".exp-form");
    const funded = form.querySelector(".ef-funded");
    if (/^biz_/.test(sel.value)) funded.value = "business";
    else if (sel.value === "personal_card" && expState.meta && expState.meta.myPartnerId) funded.value = expState.meta.myPartnerId;
    const ev = form.querySelector(".ef-evidence");
    if (/card$|^biz_/.test(sel.value) && !ev.value) ev.value = "card";
  });

  /* ---------- 목록 ---------- */
  function expenseRowHTML(v) {
    const editable = expEditable();
    const pending = v.status === "RECORDED";
    return `
      <div data-id="${esc(v.id)}" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border)">
        <div style="flex:1;min-width:240px">
          <span class="status-chip ${EXP_STATUS_CLASS[v.status] || "st-neutral"}">${esc(t(EXP_STATUS_LABEL[v.status] || v.status))}</span>
          <b style="margin-left:6px">${esc(v.supplierLabel || v.supplierName)}</b>
          <span style="color:var(--text-muted);margin-left:6px" class="tnum">${esc(v.issuedOn)}</span>
          <span class="status-chip st-neutral" style="margin-left:6px">${esc(catLabel(v.category))}</span>
          ${v.settlementId ? `<span class="status-chip st-done" style="margin-left:4px">${esc(t("정산 완료"))}</span>` : ""}
          ${v.source === "pickle" ? `<span class="small" style="color:var(--text-muted);margin-left:4px">🤖</span>` : ""}
          ${v.itemsSummary ? `<div style="margin-top:2px">${esc(v.itemsSummary)}</div>` : ""}
          <div class="tnum" style="margin-top:2px"><b>${esc(expWon(v.totalAmount))}</b>
            <span style="color:var(--text-muted)"> · ${esc(methodLabel(v.paymentMethod) || t("결제수단 미지정"))}${v.cardLast4 ? ` ****${esc(v.cardLast4)}` : ""} · ${esc(partnerName(v.fundedBy))}${v.fundedBy !== "business" ? ` · ${esc(t(v.shared ? "공동" : "혼자 부담"))}` : ""} · ${esc(t(EXP_VAT_LABEL[v.vatDeductible] || ""))}</span>
            ${v.amountMismatch ? ` <span style="color:var(--danger)">${esc(t("공급가액+부가세가 합계와 다릅니다"))}</span>` : ""}</div>
          ${v.memo ? `<div style="color:var(--text-muted);margin-top:2px">📝 ${esc(v.memo)}</div>` : ""}
        </div>
        ${editable ? `<button type="button" class="btn btn--sm btn--ghost exp-edit">${esc(t("수정"))}</button>` : ""}
        ${editable && pending ? `
          <input type="number" class="exp-total" value="${esc(v.totalAmount)}" min="0" style="width:110px" title="${esc(t("합계(원)"))}">
          <button type="button" class="btn btn--sm exp-confirm">${esc(t("확인"))}</button>
          <button type="button" class="btn btn--sm btn--ghost exp-reject">${esc(t("제외"))}</button>` : ""}
        ${editable && !pending && !v.settlementId ? `<button type="button" class="btn btn--sm btn--ghost exp-reopen">${esc(t("확인 대기로 되돌리기"))}</button>` : ""}
      </div>`;
  }

  async function paintExpenseList() {
    const params = new URLSearchParams({ month: expMonth() });
    ["status", "category", "funded"].forEach((k) => {
      const v = el(`exp-f-${k}`).value;
      if (v) params.set(k === "funded" ? "fundedBy" : k, v);
    });
    const res = await adminFetch(`/api/admin/expenses?${params}`);
    if (!res) return;
    expState.items = new Map(res.items.map((v) => [v.id, v]));
    el("exp-list").innerHTML = res.items.length ? res.items.map(expenseRowHTML).join("") : `<p style="color:var(--text-muted)">${esc(t("이 조건의 지출이 없습니다"))}</p>`;
  }

  async function patchExpense(id, body, okMsg, before) {
    const r = await adminFetch(`/api/admin/supplier-invoices/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
    if (!r) return null;
    paintExpenses({ keepForms: true });
    if (r.unchanged) { toast(t("바뀐 내용이 없습니다")); return r; }
    if (before) {
      toast(t(okMsg), {
        undo: async () => {
          const back = {};
          Object.keys(body).forEach((k) => { back[k] = before[k] ?? ""; });
          if (body.supplierLabel !== undefined) back.supplierName = before.supplierName;
          const x = await adminFetch(`/api/admin/supplier-invoices/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(back) });
          paintExpenses({ keepForms: true });
          return !!x;
        },
      });
    } else toast(t(okMsg));
    return r;
  }

  el("exp-list")?.addEventListener("click", async (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    const before = expState.items.get(id) || {};
    if (e.target.closest(".exp-edit")) {
      if (!row.querySelector(".exp-form")) row.insertAdjacentHTML("beforeend", expenseFormHTML(before));
      return;
    }
    const form = row.querySelector(".exp-form");
    if (form && e.target.closest(".ef-cancel")) { form.remove(); return; }
    if (form && e.target.closest(".ef-save")) {
      const body = readExpenseForm(form);
      if (before.settlementId) { delete body.totalAmount; delete body.fundedBy; delete body.shared; }
      await patchExpense(id, body, "저장했습니다", before);
      return;
    }
    if (e.target.closest(".exp-confirm")) {
      const total = Math.floor(Number(row.querySelector(".exp-total").value));
      if (!(total >= 0)) { toast(t("합계 금액을 확인해 주세요")); return; }
      await patchExpense(id, { status: "CONFIRMED", totalAmount: total }, "지출을 확인했습니다", before);
    } else if (e.target.closest(".exp-reject")) await patchExpense(id, { status: "REJECTED" }, "지출을 제외했습니다", before);
    else if (e.target.closest(".exp-reopen")) await patchExpense(id, { status: "RECORDED" }, "확인 대기로 되돌렸습니다", before);
  });

  /* 새 지출 */
  el("exp-new")?.addEventListener("click", () => {
    const box = el("exp-newform");
    if (!expState.meta) return;
    box.innerHTML = box.innerHTML.trim() ? "" : expenseFormHTML(null);
  });
  el("exp-newform")?.addEventListener("click", async (e) => {
    const box = el("exp-newform");
    const form = box.querySelector(".exp-form");
    if (!form) return;
    if (e.target.closest(".ef-cancel")) { box.innerHTML = ""; return; }
    if (!e.target.closest(".ef-save")) return;
    const body = readExpenseForm(form);
    if (!body.supplierName || body.totalAmount === "" || !body.issuedOn) { toast(t("거래처·날짜·합계는 꼭 입력해 주세요")); return; }
    const r = await adminFetch("/api/admin/supplier-invoices", { method: "POST", body: JSON.stringify(body) });
    if (!r) return;
    box.innerHTML = "";
    paintExpenses();
    toast(t("등록했습니다"), {
      undo: async () => {
        const x = await adminFetch(`/api/admin/supplier-invoices/${encodeURIComponent(r.invoice.id)}`, { method: "PATCH", body: JSON.stringify({ status: "REJECTED" }) });
        paintExpenses();
        return !!x;
      },
    });
  });

  /* ---------- 요약 타일·분류·예산·추이 ---------- */
  function paintStats(s) {
    const diff = s.previousTotal ? Math.round(((s.confirmedTotal - s.previousTotal) / s.previousTotal) * 100) : null;
    const tile = (label, value, sub) => `<div class="stat-tile"><div class="stat-tile-label">${esc(label)}</div><div class="stat-tile-value tnum">${esc(value)}</div>${sub ? `<div class="stat-tile-sub">${esc(sub)}</div>` : ""}</div>`;
    el("exp-tiles").innerHTML = [
      tile(t("이번 달 지출(확인)"), expWon(s.confirmedTotal), diff == null ? "" : t("지난달 대비 {n}%", { n: (diff > 0 ? "+" : "") + diff })),
      tile(t("이번 달 매출"), expWon(s.revenue), t("취소·환불 제외")),
      tile(t("남은 돈(매출-지출)"), expWon(s.profit), ""),
      tile(t("확인 대기"), t("{n}건", { n: s.pendingCount }), expWon(s.pendingTotal)),
      tile(t("부가세 공제 후보"), expWon(s.vat.deductibleCandidate), s.vat.needsCheck ? t("확인 필요 {v}", { v: expWon(s.vat.needsCheck) }) : t("안내용 — 신고 때 확정")),
    ].join("");
    const max = Math.max(1, ...s.byCategory.map((c) => c.total));
    const budgetBy = new Map((s.budgets || []).map((b) => [b.category, b]));
    const cats = [...s.byCategory];
    (s.budgets || []).forEach((b) => { if (!cats.some((c) => c.key === b.category)) cats.push({ key: b.category, total: 0 }); });
    el("exp-categories").innerHTML = cats.length
      ? cats.map((c) => {
          const b = budgetBy.get(c.key);
          const ratio = b ? b.ratio : null;
          const color = ratio == null ? "var(--accent)" : ratio >= 1 ? "var(--danger)" : ratio >= 0.8 ? "var(--status-pending-ink)" : "var(--ok)";
          const width = Math.round((ratio == null ? c.total / max : Math.min(1, ratio)) * 100);
          return `<div style="margin:6px 0">
            <div style="display:flex;justify-content:space-between"><span>${esc(catLabel(c.key))}</span><span class="tnum">${esc(expWon(c.total))}${b ? ` / ${esc(expWon(b.budget))} (${Math.round(ratio * 100)}%)` : ""}</span></div>
            <div style="height:6px;background:var(--border);border-radius:3px;margin-top:3px"><div style="height:6px;width:${width}%;background:${color};border-radius:3px"></div></div>
          </div>`;
        }).join("")
      : `<p style="color:var(--text-muted)">${esc(t("이 달 확인된 지출이 없습니다"))}</p>`;
    const tmax = Math.max(1, ...s.trend.map((x) => x.total));
    el("exp-trend").innerHTML = `<div style="color:var(--text-muted);margin-bottom:4px">${esc(t("6개월 지출 추이"))}</div><div style="display:flex;gap:6px;align-items:flex-end;height:70px">${s.trend
      .map((x) => `<div style="flex:1;text-align:center" title="${esc(x.month)} ${esc(expWon(x.total))}"><div style="height:${Math.max(2, Math.round((x.total / tmax) * 52))}px;background:var(--accent);opacity:.75;border-radius:3px 3px 0 0"></div><div style="font-size:10px;color:var(--text-muted)">${esc(x.month.slice(5))}</div></div>`)
      .join("")}</div>`;
  }

  el("exp-budget-edit")?.addEventListener("click", async () => {
    const meta = expState.meta;
    if (!meta) return;
    const current = Object.fromEntries((meta.budgets || []).map((b) => [b.category, b.monthly_amount]));
    const box = el("exp-categories");
    if (box.querySelector(".exp-budget-form")) { paintExpenses(); return; }
    box.innerHTML = `<div class="exp-budget-form mini-form">${Object.keys(meta.categories).map((k) => `<label>${esc(catLabel(k))}<input type="number" min="0" data-cat="${esc(k)}" value="${esc(current[k] ?? "")}" placeholder="${esc(t("예산 없음"))}"></label>`).join("")}
      <div class="mini-form-actions"><button type="button" class="btn btn--sm exp-budget-save">${esc(t("예산 저장"))}</button><span class="small" style="color:var(--text-muted)">${esc(t("80%를 넘으면 표시와 AI 아침 브리핑에 알립니다. 0 또는 빈칸은 예산 없음."))}</span></div></div>`;
    box.querySelector(".exp-budget-save").addEventListener("click", async () => {
      const budgets = {};
      box.querySelectorAll("[data-cat]").forEach((i) => { budgets[i.dataset.cat] = i.value === "" ? 0 : Number(i.value); });
      if (await adminFetch("/api/admin/expenses/budgets", { method: "PUT", body: JSON.stringify({ budgets }) })) { toast(t("예산을 저장했습니다")); paintExpenses(); }
    });
  });

  /* ---------- 동업자 정산 ---------- */
  function paintSettlement(pv) {
    const box = el("exp-settlement");
    if (!pv || pv.migrationMissing) { box.innerHTML = ""; return; }
    const editable = expEditable();
    if (!pv.count) { box.innerHTML = `<p style="color:var(--text-muted)">${esc(t("정산할 지출이 없습니다(개인 돈으로 낸 확인된 공동 지출이 없음)."))}</p>`; return; }
    box.innerHTML = `
      <div class="tnum" style="margin-bottom:6px">${esc(t("정산 대상 {n}건 · 합계 {v}", { n: pv.count, v: expWon(pv.total) }))}</div>
      ${pv.balances.map((b) => `<div class="tnum" style="color:var(--text-muted)">${esc(b.name)}: ${esc(t("낸 돈"))} ${esc(expWon(b.paid))} · ${esc(t("부담"))} ${esc(expWon(b.share))} → <b style="color:${b.balance >= 0 ? "var(--ok)" : "var(--danger)"}">${esc(b.balance >= 0 ? t("받을 돈 {v}", { v: expWon(b.balance) }) : t("줄 돈 {v}", { v: expWon(-b.balance) }))}</b></div>`).join("")}
      <div style="margin-top:8px;padding:10px;border-radius:8px;background:var(--accent-soft, rgba(90,110,220,.1))">
        ${pv.transfers.length ? pv.transfers.map((x) => `<div><b>${esc(x.fromName)}</b> → <b>${esc(x.toName)}</b> <span class="tnum">${esc(expWon(x.amount))}</span> ${esc(t("보내기"))}</div>`).join("") : esc(t("서로 보낼 돈이 없습니다(이미 비율대로 냄)."))}
      </div>
      ${editable ? `<button type="button" class="btn btn--sm exp-settle" data-total="${esc(pv.total)}" style="margin-top:10px">${esc(t("송금 후 정산 완료로 기록"))}</button>` : ""}`;
  }

  function paintSettlementHistory(list) {
    const editable = expEditable();
    el("exp-settlement-history").innerHTML = (list || []).length
      ? list.map((st) => `<div data-sid="${esc(st.id)}" style="padding:6px 0;border-top:1px solid var(--border)${st.canceled_at ? ";opacity:.55" : ""}">
          <span class="tnum">${fmtDate(st.created_at)}</span> · ${esc(expWon(st.total_amount))} · ${(st.transfers || []).map((x) => `${esc(x.fromName)}→${esc(x.toName)} ${esc(expWon(x.amount))}`).join(", ") || esc(t("송금 없음"))}
          ${st.canceled_at ? ` · <i>${esc(t("취소됨"))}</i>` : editable ? ` <button type="button" class="btn btn--sm btn--ghost exp-settle-cancel">${esc(t("정산 취소"))}</button>` : ""}
        </div>`).join("")
      : `<p style="color:var(--text-muted)">${esc(t("아직 정산 기록이 없습니다"))}</p>`;
  }

  el("exp-settlement")?.addEventListener("click", async (e) => {
    const b = e.target.closest(".exp-settle");
    if (!b) return;
    if (!confirm(t("표시된 금액을 실제로 송금했나요? 정산 완료로 기록하면 이 지출들은 다음 정산에서 빠집니다."))) return;
    b.disabled = true;
    const r = await adminFetch("/api/admin/expenses/settlements", { method: "POST", body: JSON.stringify({ expectedTotal: Number(b.dataset.total) }) });
    b.disabled = false;
    if (!r) { paintExpenses(); return; }
    paintExpenses();
    toast(t("정산을 기록했습니다"), {
      undo: async () => {
        const x = await adminFetch(`/api/admin/expenses/settlements/${encodeURIComponent(r.settlement.id)}/cancel`, { method: "POST" });
        paintExpenses();
        return !!x;
      },
    });
  });
  el("exp-settlement-history")?.addEventListener("click", async (e) => {
    const b = e.target.closest(".exp-settle-cancel");
    if (!b) return;
    if (!confirm(t("이 정산을 취소할까요? 포함된 지출이 다시 정산 대상으로 돌아옵니다."))) return;
    if (await adminFetch(`/api/admin/expenses/settlements/${encodeURIComponent(b.closest("[data-sid]").dataset.sid)}/cancel`, { method: "POST" })) {
      toast(t("정산을 취소했습니다"));
      paintExpenses();
    }
  });

  /* ---------- 정기 지출 ---------- */
  function recurringFormHTML() {
    const meta = expState.meta;
    return `<div class="exp-rec-form mini-form">
      <label>${esc(t("이름"))}<input class="rf-name" placeholder="${esc(t("예: Render 서버"))}"></label>
      <label>${esc(t("금액(원)"))}<input type="number" min="1" class="rf-amount"></label>
      <label>${esc(t("매달 결제일"))}<input type="number" min="1" max="28" class="rf-day" value="1"></label>
      <label>${esc(t("분류"))}<select class="rf-category">${options(meta.categories, "software")}</select></label>
      <label>${esc(t("결제수단"))}<select class="rf-method">${options(meta.paymentMethods, "biz_check", { empty: "선택" })}</select></label>
      <label>${esc(t("낸 사람(누구 돈)"))}<select class="rf-funded">${fundedOptions("business")}</select></label>
      <div class="mini-form-actions"><button type="button" class="btn btn--sm rf-save">${esc(t("등록"))}</button><button type="button" class="btn btn--sm btn--ghost rf-cancel">${esc(t("닫기"))}</button></div>
    </div>`;
  }
  function paintRecurring(list) {
    const editable = expEditable();
    el("exp-recurring").innerHTML = (list || []).length
      ? list.map((r) => `<div data-rid="${esc(r.id)}" style="display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--border)${r.active ? "" : ";opacity:.55"}">
          <div style="flex:1"><b>${esc(r.name)}</b> <span class="tnum">${esc(expWon(r.amount))}</span> · ${esc(t("매달 {d}일", { d: r.day_of_month }))} · ${esc(catLabel(r.category))} · ${esc(methodLabel(r.payment_method))} · ${esc(partnerName(r.funded_by))}</div>
          ${editable ? `<button type="button" class="btn btn--sm btn--ghost exp-rec-toggle">${esc(t(r.active ? "멈추기" : "다시 켜기"))}</button>` : ""}
        </div>`).join("")
      : `<p style="color:var(--text-muted)">${esc(t("등록된 정기 지출이 없습니다"))}</p>`;
  }
  el("exp-rec-new")?.addEventListener("click", () => {
    const box = el("exp-recurring");
    if (box.querySelector(".exp-rec-form") || !expState.meta) return;
    box.insertAdjacentHTML("afterbegin", recurringFormHTML());
  });
  el("exp-recurring")?.addEventListener("click", async (e) => {
    const form = el("exp-recurring").querySelector(".exp-rec-form");
    if (form && e.target.closest(".rf-cancel")) { form.remove(); return; }
    if (form && e.target.closest(".rf-save")) {
      const body = {
        name: form.querySelector(".rf-name").value.trim(), supplierName: form.querySelector(".rf-name").value.trim(),
        amount: Number(form.querySelector(".rf-amount").value), dayOfMonth: Number(form.querySelector(".rf-day").value),
        category: form.querySelector(".rf-category").value, paymentMethod: form.querySelector(".rf-method").value, fundedBy: form.querySelector(".rf-funded").value,
        evidenceType: /card$|^biz_/.test(form.querySelector(".rf-method").value) ? "card" : "",
      };
      if (await adminFetch("/api/admin/expenses/recurring", { method: "POST", body: JSON.stringify(body) })) { toast(t("등록했습니다")); paintExpenses(); }
      return;
    }
    const tog = e.target.closest(".exp-rec-toggle");
    if (tog) {
      const id = tog.closest("[data-rid]").dataset.rid;
      const active = tog.textContent.trim() !== t("멈추기");
      if (await adminFetch(`/api/admin/expenses/recurring/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ active }) })) paintExpenses();
    }
  });

  /* ---------- 상품별 마진·원가 ---------- */
  function paintMargin(costs, margin) {
    const byId = new Map((margin.items || []).map((m) => [m.productId, m]));
    const rows = (costs.items || []).filter((p) => p.active !== false || byId.has(p.id));
    el("exp-margin").innerHTML = rows.length
      ? `<div class="exp-grid" style="grid-template-columns:minmax(0,1.5fr) minmax(0,.5fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.1fr)">
          <b>${esc(t("상품"))}</b><b>${esc(t("판매"))}</b><b>${esc(t("판매액"))}</b><b>${esc(t("1벌 원가"))}</b><b>${esc(t("마진"))}</b>
          ${rows.map((p) => {
            const m = byId.get(p.id) || { qty: 0, revenue: 0 };
            const margin = p.unitCost == null ? null : m.revenue - p.unitCost * m.qty;
            return `<span>${esc(p.name || p.id)}</span><span class="tnum">${m.qty}</span><span class="tnum">${esc(expWon(m.revenue))}</span>
              <input type="number" min="0" class="exp-cost-input" data-pid="${esc(p.id)}" value="${esc(p.unitCost ?? "")}">
              <span class="tnum">${margin == null ? "—" : `${esc(expWon(margin))}${m.revenue ? ` (${Math.round((margin / m.revenue) * 100)}%)` : ""}`}</span>`;
          }).join("")}
        </div>`
      : `<p style="color:var(--text-muted)">${esc(t("상품이 없습니다"))}</p>`;
  }
  el("exp-cost-save")?.addEventListener("click", async () => {
    const costs = {};
    el("exp-margin").querySelectorAll(".exp-cost-input").forEach((i) => { costs[i.dataset.pid] = i.value === "" ? null : Number(i.value); });
    if (await adminFetch("/api/admin/expenses/unit-costs", { method: "PUT", body: JSON.stringify({ costs }) })) { toast(t("원가를 저장했습니다")); paintExpenses(); }
  });

  /* ---------- 동업자 설정 ---------- */
  function paintPartners(partners) {
    el("exp-partners").innerHTML = `<div class="exp-grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.5fr) minmax(0,.6fr)">
      <b>${esc(t("이름"))}</b><b>${esc(t("Works 이메일"))}</b><b>${esc(t("비율 %"))}</b>
      ${partners.map((p) => `<input class="exp-partner-input" data-pid="${esc(p.id)}" data-f="name" value="${esc(p.name)}">
        <input class="exp-partner-input" data-pid="${esc(p.id)}" data-f="email" value="${esc(p.email || "")}" placeholder="name@example.com">
        <input class="exp-partner-input" type="number" min="0" max="100" data-pid="${esc(p.id)}" data-f="share" value="${esc(p.share_percent)}">`).join("")}
    </div>`;
  }
  el("exp-partners-save")?.addEventListener("click", async () => {
    const map = new Map();
    el("exp-partners").querySelectorAll(".exp-partner-input").forEach((i) => {
      const p = map.get(i.dataset.pid) || { id: i.dataset.pid };
      if (i.dataset.f === "name") p.name = i.value.trim();
      if (i.dataset.f === "email") p.email = i.value.trim();
      if (i.dataset.f === "share") p.sharePercent = Number(i.value);
      map.set(i.dataset.pid, p);
    });
    if (await adminFetch("/api/admin/expenses/partners", { method: "PUT", body: JSON.stringify({ partners: [...map.values()] }) })) { toast(t("동업자 설정을 저장했습니다")); paintExpenses(); }
  });

  /* ---------- CSV 가져오기 ---------- */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === "," || ch === "\t") { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim()));
  }
  function normDate(s) {
    const m = String(s || "").trim().match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/) || String(s || "").trim().match(/^(\d{4})(\d{2})(\d{2})/);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
  }
  function normAmount(s) {
    const str = String(s || "").replace(/[,\s원₩]/g, "");
    const n = Number(str.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : NaN;
  }
  async function readCsvFile(file, encoding) {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder(encoding).decode(buf);
    // UTF-8로 읽었는데 깨진 글자가 많으면 국내 카드사 기본 인코딩(EUC-KR)으로 다시
    if (encoding === "utf-8" && (text.match(/�/g) || []).length > 3) text = new TextDecoder("euc-kr").decode(buf);
    return text.replace(/^﻿/, "");
  }
  function importPanelHTML() {
    const meta = expState.meta;
    return `<b>${esc(t("카드사·은행 거래내역 CSV 가져오기"))}</b>
      <p class="small" style="color:var(--text-muted);margin:4px 0 8px">${esc(t("카드사·은행 사이트에서 기간 이용내역을 CSV로 받아 올리세요(엑셀 파일은 엑셀에서 CSV로 저장). 같은 거래는 다시 들어가지 않고, 분류를 확인하도록 확인 대기로 들어옵니다. 취소(마이너스) 줄은 건너뜁니다."))}</p>
      <div class="mini-form">
        <label>${esc(t("파일"))}<input type="file" id="exp-csv-file" accept=".csv,.txt,text/csv"></label>
        <label>${esc(t("글자 인코딩"))}<select id="exp-csv-enc"><option value="utf-8">UTF-8 (${esc(t("자동으로 EUC-KR 재시도"))})</option><option value="euc-kr">EUC-KR</option></select></label>
        <label>${esc(t("기본 분류"))}<select id="exp-csv-cat">${options(meta.categories, "other")}</select></label>
        <label>${esc(t("결제수단"))}<select id="exp-csv-method">${options(meta.paymentMethods, "personal_card")}</select></label>
        <label>${esc(t("카드 뒤 4자리"))}<input id="exp-csv-card" maxlength="4" inputmode="numeric"></label>
        <label>${esc(t("낸 사람(누구 돈)"))}<select id="exp-csv-funded">${fundedOptions(meta.myPartnerId || "business")}</select></label>
      </div>
      <div id="exp-csv-map" class="small" style="margin-top:8px"></div>`;
  }
  el("exp-import-toggle")?.addEventListener("click", () => {
    const box = el("exp-import");
    if (!expState.meta) return;
    box.hidden = !box.hidden;
    if (!box.hidden && !box.innerHTML.trim()) box.innerHTML = importPanelHTML();
  });
  el("exp-import")?.addEventListener("change", async (e) => {
    if (e.target.id === "exp-csv-file" || e.target.id === "exp-csv-enc") {
      const f = el("exp-csv-file").files[0];
      if (!f) return;
      const rows = parseCsv(await readCsvFile(f, el("exp-csv-enc").value));
      if (rows.length < 2) { el("exp-csv-map").textContent = t("읽을 수 있는 줄이 없습니다"); return; }
      // 머리줄 찾기: "일자/날짜"가 들어간 첫 줄
      const hi = Math.max(0, rows.findIndex((r) => r.some((c) => /일자|날짜|거래일|이용일|date/i.test(c))));
      const header = rows[hi];
      expState.csv = { header, body: rows.slice(hi + 1) };
      const guess = (re) => Math.max(0, header.findIndex((c) => re.test(c)));
      const sel = (id, idx) => `<select id="${id}">${header.map((h, i) => `<option value="${i}" ${i === idx ? "selected" : ""}>${esc(h || `#${i + 1}`)}</option>`).join("")}</select>`;
      el("exp-csv-map").innerHTML = `<div class="mini-form">
          <label>${esc(t("날짜 열"))}${sel("exp-col-date", guess(/일자|날짜|거래일|이용일|date/i))}</label>
          <label>${esc(t("가맹점·내용 열"))}${sel("exp-col-merchant", guess(/가맹점|이용처|적요|내용|거래처|상호|merchant/i))}</label>
          <label>${esc(t("금액 열"))}${sel("exp-col-amount", guess(/금액|이용금액|출금|amount/i))}</label>
        </div>
        <div id="exp-csv-preview" style="margin-top:8px"></div>
        <button type="button" class="btn btn--sm" id="exp-csv-go" style="margin-top:8px">${esc(t("가져오기"))}</button>`;
      renderCsvPreview();
    } else if (/^exp-col-/.test(e.target.id)) renderCsvPreview();
  });
  function csvRows() {
    const c = expState.csv;
    if (!c) return [];
    const di = Number(el("exp-col-date").value), mi = Number(el("exp-col-merchant").value), ai = Number(el("exp-col-amount").value);
    return c.body.map((r) => ({ date: normDate(r[di]), merchant: String(r[mi] || "").trim(), amount: normAmount(r[ai]) }));
  }
  function renderCsvPreview() {
    const rows = csvRows();
    const ok = rows.filter((r) => r.date && r.merchant && r.amount > 0);
    el("exp-csv-preview").innerHTML = `${esc(t("가져올 줄 {n} / 전체 {all} (취소·빈 줄 제외)", { n: ok.length, all: rows.length }))}
      ${ok.slice(0, 5).map((r) => `<div class="tnum" style="color:var(--text-muted)">${esc(r.date)} · ${esc(r.merchant)} · ${esc(expWon(r.amount))}</div>`).join("")}`;
  }
  el("exp-import")?.addEventListener("click", async (e) => {
    if (e.target.id !== "exp-csv-go") return;
    const rows = csvRows().filter((r) => r.date && r.merchant && r.amount > 0);
    if (!rows.length) { toast(t("가져올 줄이 없습니다")); return; }
    e.target.disabled = true;
    const r = await adminFetch("/api/admin/expenses/import", {
      method: "POST",
      body: JSON.stringify({ rows, defaults: { category: el("exp-csv-cat").value, paymentMethod: el("exp-csv-method").value, cardLast4: el("exp-csv-card").value, fundedBy: el("exp-csv-funded").value } }),
    });
    e.target.disabled = false;
    if (!r) return;
    toast(t("{c}건 가져옴 · 중복 {d}건 건너뜀", { c: r.created, d: r.duplicates }));
    el("exp-import").hidden = true;
    el("exp-import").innerHTML = "";
    el("exp-f-status").value = "RECORDED";
    paintExpenses();
  });

  /* ---------- 내보내기·AI 요약 ---------- */
  el("exp-export-csv")?.addEventListener("click", () => downloadExportFile(`/api/admin/expenses/export?month=${expMonth()}&format=csv`, `reiten-expenses-${expMonth()}`, "csv"));
  el("exp-export-xlsx")?.addEventListener("click", () => downloadExportFile(`/api/admin/expenses/export?month=${expMonth()}&format=xlsx`, `reiten-expenses-${expMonth()}`, "xlsx"));
  el("exp-ai-copy")?.addEventListener("click", async () => {
    const r = await adminFetch(`/api/admin/expenses/ai-summary?month=${expMonth()}`);
    if (!r || !r.text) return;
    try {
      await navigator.clipboard.writeText(r.text);
      toast(t("AI 피드백용 요약을 복사했습니다 — ChatGPT·Claude 등에 붙여넣으세요"));
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = r.text;
      ta.style.cssText = "width:100%;height:220px;margin-top:8px";
      el("exp-newform").innerHTML = "";
      el("exp-newform").appendChild(ta);
      ta.select();
      toast(t("자동 복사가 막혀 있어요. 선택된 글을 직접 복사해 주세요."));
    }
  });

  /* ---------- 전체 그리기 ---------- */
  async function paintExpenses({ keepForms = false } = {}) {
    const month = expMonth();
    const [meta, stats, pv, hist, rec, costs, margin] = await Promise.all([
      adminFetch("/api/admin/expenses/meta"),
      adminFetch(`/api/admin/expenses/stats?month=${month}`),
      adminFetch("/api/admin/expenses/settlement/preview"),
      adminFetch("/api/admin/expenses/settlements"),
      adminFetch("/api/admin/expenses/recurring"),
      adminFetch("/api/admin/expenses/unit-costs"),
      adminFetch(`/api/admin/expenses/margin?month=${month}`),
    ]);
    if (!meta) return;
    expState.meta = meta;
    el("exp-migration-note").hidden = !(meta.migrationMissing || (stats && stats.migrationMissing));
    if (meta.migrationMissing) return;
    // 거르기 칸 채우기(선택 유지)
    const fc = el("exp-f-category"), ff = el("exp-f-funded");
    const keep = [fc.value, ff.value];
    fc.innerHTML = `<option value="">${esc(t("모든 분류"))}</option>` + Object.keys(meta.categories).map((k) => `<option value="${esc(k)}">${esc(catLabel(k))}</option>`).join("");
    ff.innerHTML = `<option value="">${esc(t("낸 사람 전체"))}</option><option value="business">${esc(t("사업자"))}</option>` + meta.partners.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    [fc.value, ff.value] = keep;
    if (stats && !stats.migrationMissing) paintStats(stats);
    paintSettlement(pv);
    paintSettlementHistory(hist && hist.items);
    paintRecurring(rec && rec.items);
    if (costs && margin) paintMargin(costs, margin);
    paintPartners(meta.partners);
    if (!keepForms) el("exp-newform").innerHTML = "";
    await paintExpenseList();
  }

  el("exp-month")?.addEventListener("change", () => paintExpenses());
  ["exp-f-status", "exp-f-category", "exp-f-funded"].forEach((id) => el(id)?.addEventListener("change", () => paintExpenseList()));
