  /* 지출·정산 — CSV 가져오기 (2026-11-11 큰 파일 나누기 — 내용·순서는 그대로). expenses.js 다음에 불러온다 */

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
    return `<div style="position:relative"><button type="button" class="form-x exp-import-close" aria-label="${esc(t("닫기"))}" title="${esc(t("닫기"))}">✕</button></div><b>${esc(t("카드사·은행 거래내역 CSV 가져오기"))}</b>
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
    setDisclosure(el("exp-import-toggle"), !box.hidden);
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
    if (e.target.closest(".exp-import-close")) { el("exp-import").hidden = true; setDisclosure(el("exp-import-toggle"), false); return; }
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
    setDisclosure(el("exp-import-toggle"), false);
    el("exp-f-status").value = "RECORDED";
    paintExpenses();
  });
