  /* ---------- 사내 캘린더 ----------
     figlo 등 다른 관리자 툴의 "캘린더" 탭을 본떠, 발매일·행사·휴무 같은 일정을 색으로
     구분해 한 화면(월 단위)에서 본다(2026-09 요청). 반복 일정은 없음(037 마이그레이션 주석
     참고) — 필요해지면 나중에 추가. */
  const CAL_COLORS = ["blue", "green", "orange", "purple", "red", "gray"];
  const CAL_COLOR_VAR = {
    blue: "var(--accent)",
    green: "var(--status-done-ink)",
    orange: "var(--status-pending-ink)",
    purple: "var(--status-shipping-ink)",
    red: "var(--danger)",
    gray: "var(--status-neutral-ink)",
  };

  function calTodayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const calState = { year: 0, month: 0, events: [], selectedDate: calTodayISO(), editingId: null };

  function calMonthKey() {
    return `${calState.year}-${String(calState.month).padStart(2, "0")}`;
  }

  function calColorPickerHTML(selected) {
    return CAL_COLORS.map(
      (c) => `<button type="button" class="cal-color-dot" data-color="${c}" aria-pressed="${c === selected}" style="background:${CAL_COLOR_VAR[c]}" aria-label="${esc(c)}"></button>`
    ).join("");
  }

  function calOpenForm({ id = null, date = calState.selectedDate, title = "", color = "blue", memo = "" } = {}) {
    calState.editingId = id;
    el("cal-form-panel").hidden = false;
    el("cal-f-title").value = title;
    el("cal-f-date").value = date;
    el("cal-f-memo").value = memo;
    el("cal-f-color").innerHTML = calColorPickerHTML(color);
    el("cal-f-color").dataset.value = color;
    el("cal-f-color").querySelectorAll(".cal-color-dot").forEach((b) =>
      b.addEventListener("click", () => {
        el("cal-f-color").dataset.value = b.dataset.color;
        el("cal-f-color").querySelectorAll(".cal-color-dot").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      })
    );
    el("cal-f-delete").hidden = !id;
    el("cal-f-title").focus();
  }

  function calCloseForm() {
    calState.editingId = null;
    el("cal-form-panel").hidden = true;
  }

  el("cal-new").addEventListener("click", () => calOpenForm({ date: calState.selectedDate }));
  el("cal-add-for-day").addEventListener("click", () => calOpenForm({ date: calState.selectedDate }));
  el("cal-f-cancel").addEventListener("click", calCloseForm);

  el("cal-f-save").addEventListener("click", async () => {
    const title = el("cal-f-title").value.trim();
    const date = el("cal-f-date").value;
    const color = el("cal-f-color").dataset.value || "blue";
    const memo = el("cal-f-memo").value.trim();
    if (!title) { toast(t("제목을 입력해 주세요.")); return; }
    if (!date) { toast(t("날짜를 선택해 주세요.")); return; }

    const btn = el("cal-f-save");
    btn.disabled = true;
    const result = calState.editingId
      ? await adminFetch(`/api/admin/calendar-events/${encodeURIComponent(calState.editingId)}`, {
          method: "PATCH",
          body: JSON.stringify({ title, date, color, memo }),
        })
      : await adminFetch("/api/admin/calendar-events", {
          method: "POST",
          body: JSON.stringify({ title, date, color, memo }),
        });
    btn.disabled = false;
    if (!result) return;
    toast(t("일정을 저장했습니다"));
    calCloseForm();
    calState.selectedDate = date;
    await calLoadMonth();
  });

  el("cal-f-delete").addEventListener("click", async () => {
    if (!calState.editingId) return;
    if (!confirm(t("이 일정을 삭제할까요?"))) return;
    const ok = await adminFetch(`/api/admin/calendar-events/${encodeURIComponent(calState.editingId)}`, { method: "DELETE" });
    if (!ok) return;
    toast(t("일정을 삭제했습니다"));
    calCloseForm();
    await calLoadMonth();
  });

  function calEventsOnDate(date) {
    return calState.events.filter((e) => e.date === date);
  }

  function calDayEventRowHTML(e) {
    return `
      <div class="panel" data-id="${esc(e.id)}" style="padding:8px 12px;display:flex;align-items:center;gap:10px;cursor:pointer" tabindex="0">
        <span class="cal-dot" style="background:${CAL_COLOR_VAR[e.color] || CAL_COLOR_VAR.blue}"></span>
        <div style="flex:1;min-width:0">
          <b>${esc(e.title)}</b>
          ${e.memo ? `<div class="small" style="color:var(--text-muted);margin-top:2px">${esc(e.memo)}</div>` : ""}
        </div>
      </div>`;
  }

  function calRenderDayEvents() {
    const d = new Date(calState.selectedDate + "T00:00:00");
    el("cal-selected-label").textContent = d.toLocaleDateString(getLang() === "de" ? "de-DE" : "ko-KR", { month: "long", day: "numeric", weekday: "long" });
    const evts = calEventsOnDate(calState.selectedDate);
    el("cal-day-events").innerHTML = evts.length
      ? evts.map(calDayEventRowHTML).join("")
      : `<p class="small" style="color:var(--text-muted)">${esc(t("이 날은 일정이 없습니다."))}</p>`;
    el("cal-day-events").querySelectorAll("[data-id]").forEach((row) =>
      row.addEventListener("click", () => {
        const e = calState.events.find((x) => x.id === row.dataset.id);
        if (e) calOpenForm(e);
      })
    );
  }

  const CAL_WEEKDAY_LABELS_KO = ["일", "월", "화", "수", "목", "금", "토"];
  const CAL_WEEKDAY_LABELS_DE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

  function calRenderGrid() {
    const labels = getLang() === "de" ? CAL_WEEKDAY_LABELS_DE : CAL_WEEKDAY_LABELS_KO;
    const first = new Date(calState.year, calState.month - 1, 1);
    const daysInMonth = new Date(calState.year, calState.month, 0).getDate();
    const startWeekday = first.getDay();
    const today = calTodayISO();

    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push("");
    for (let d = 1; d <= daysInMonth; d++) cells.push(`${calState.year}-${String(calState.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);

    const header = labels.map((l, i) => `<div class="cal-weekday${i === 0 ? " cal-weekday--sun" : i === 6 ? " cal-weekday--sat" : ""}">${esc(l)}</div>`).join("");

    const dayCells = cells
      .map((date) => {
        if (!date) return `<div class="cal-cell cal-cell--empty"></div>`;
        const day = Number(date.slice(-2));
        const evts = calEventsOnDate(date);
        const shown = evts.slice(0, 3);
        const more = evts.length - shown.length;
        return `
        <button type="button" class="cal-cell${date === today ? " cal-cell--today" : ""}${date === calState.selectedDate ? " cal-cell--selected" : ""}" data-date="${date}">
          <span class="cal-cell-num">${day}</span>
          <span class="cal-cell-events">
            ${shown.map((e) => `<span class="cal-pill" style="background:${CAL_COLOR_VAR[e.color] || CAL_COLOR_VAR.blue}">${esc(e.title)}</span>`).join("")}
            ${more > 0 ? `<span class="cal-pill-more">+${more}</span>` : ""}
          </span>
        </button>`;
      })
      .join("");

    el("cal-grid").innerHTML = `<div class="cal-grid-header">${header}</div><div class="cal-grid-body">${dayCells}</div>`;
    el("cal-grid").querySelectorAll(".cal-cell[data-date]").forEach((cell) =>
      cell.addEventListener("click", () => {
        calState.selectedDate = cell.dataset.date;
        calRenderGrid();
        calRenderDayEvents();
      })
    );
  }

  async function calLoadMonth() {
    const result = await adminFetch(`/api/admin/calendar-events?month=${calMonthKey()}`);
    if (!result) return;
    calState.events = result.items;
    const monthDate = new Date(calState.year, calState.month - 1, 1);
    el("cal-month-label").textContent = monthDate.toLocaleDateString(getLang() === "de" ? "de-DE" : "ko-KR", { year: "numeric", month: "long" });
    calRenderGrid();
    calRenderDayEvents();
  }

  function calGoToMonth(year, month) {
    calState.year = year;
    calState.month = month;
    calLoadMonth();
  }

  el("cal-prev").addEventListener("click", () => {
    const m = calState.month === 1 ? 12 : calState.month - 1;
    const y = calState.month === 1 ? calState.year - 1 : calState.year;
    calGoToMonth(y, m);
  });
  el("cal-next").addEventListener("click", () => {
    const m = calState.month === 12 ? 1 : calState.month + 1;
    const y = calState.month === 12 ? calState.year + 1 : calState.year;
    calGoToMonth(y, m);
  });
  el("cal-today").addEventListener("click", () => {
    const d = new Date();
    calState.selectedDate = calTodayISO();
    calGoToMonth(d.getFullYear(), d.getMonth() + 1);
  });

  function paintAdminCalendarOnce() {
    if (calState.year) return; // 탭을 여러 번 눌러도 매번 이번 달로 리셋되지 않게
    const d = new Date();
    calGoToMonth(d.getFullYear(), d.getMonth() + 1);
  }
  document.querySelector('.nav-item[data-tab="calendar"]')?.addEventListener("click", paintAdminCalendarOnce);
