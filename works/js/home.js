  /* ---------- 오늘(홈) — 로그인 직후 첫 화면 ----------
     예전엔 로그인하면 곧장 "전체 주문" 목록으로 가서, 오늘 상황을 파악하려면 대시보드 탭을
     따로 눌러야 했다(2026-09, figlo WORKS 벤치마크로 나온 요청) — 이미 있는 대시보드·알림벨
     데이터를 재활용해 첫 화면에서 바로 보여준다.
     제목(큰 글씨)은 Claude 앱의 새 대화 화면(시간대에 따라 "저녁 단상"처럼 짧고 담백한
     문구가 뜨는 것)을 참고해 시간대 4구간(아침/오후/저녁/밤)마다 하나씩 고정 문구를 쓴다
     (2026-09-11, 사용자 요청 — "OOO님, 오늘도 힘내세요" 같은 고정 인사말을 큰 제목에 쓰지
     말아달라던 것과 같은 맥락). 이름·확인 건수처럼 실제로 쓸모 있는 정보는 사라지지 않고
     그 아래 작은 부제(subline)로 옮겨서, 시간대(0~4시=밤)×확인할 게 있는지(0건/일부 건)를
     조합한 8가지 문장 중 하나를 그때그때 고른다(무작위가 아니라 시간·상태 기반이라 같은
     시간대·같은 상태에서 다시 열어도 뜬금없이 안 바뀜). */
  function homeTimeBucket(hour) {
    if (hour < 5) return "night";
    if (hour < 11) return "morning";
    if (hour < 18) return "afternoon";
    if (hour < 22) return "evening";
    return "night";
  }

  const HOME_TITLE = {
    morning: "아침의 시작",
    afternoon: "오후의 흐름",
    evening: "저녁 단상",
    night: "밤의 고요",
  };

  function homeSublineKey(bucket, pendingTotal) {
    const busy = pendingTotal > 0;
    const keys = {
      morning: { idle: "{name}님, 오늘은 조용하네요.", busy: "{name}님, 확인할 게 {n}건 있어요." },
      afternoon: { idle: "{name}님, 순조롭게 흘러가고 있어요.", busy: "{name}님, 확인할 게 {n}건 남아있어요." },
      evening: { idle: "{name}님, 오늘 하루도 무사히 마무리되고 있어요.", busy: "{name}님, 마감 전에 {n}건만 더 확인해 주세요." },
      night: { idle: "{name}님, 늦은 시간까지 고생 많으세요.", busy: "{name}님, {n}건이 아직 남아있어요." },
    };
    return keys[bucket][busy ? "busy" : "idle"];
  }

  function homeTileHTML(label, value, tab) {
    return `
      <button type="button" class="panel home-tile" data-tab-link="${esc(tab)}" style="text-align:left;cursor:pointer">
        <div class="small" style="color:var(--text-muted)">${esc(label)}</div>
        <div class="tnum" style="font-size:22px;font-weight:700;margin-top:4px">${esc(value)}</div>
      </button>`;
  }

  function homeShortcutHTML(label, desc, tab) {
    return `
      <button type="button" class="panel home-shortcut" data-tab-link="${esc(tab)}" style="text-align:left;cursor:pointer">
        <b>${esc(label)}</b>
        <div class="small" style="color:var(--text-muted);margin-top:4px">${esc(desc)}</div>
      </button>`;
  }

  /* "한눈에 보이는 그래프가 없어 허전하다"는 피드백(2026-09-10)으로 추가 — reports.js의
     대시보드 탭이 이미 계산해 내려주는 dailyRevenue/bestsellers를 그대로 재사용한다(새 API
     호출 없이 이 페이지가 이미 받아온 dash 객체만 다시 그림). 전체 대시보드는 여전히 별도
     탭에 있고, 여기는 로그인 직후 "오늘 상황"만 요약해서 보여주는 축소판이다. */
  function homeRevenueChartHTML(dailyRevenue) {
    const max = Math.max(1, ...dailyRevenue.map((r) => r.total));
    return dailyRevenue
      .map((r) => {
        const d = new Date(r.date + "T00:00:00");
        const label = `${d.getMonth() + 1}/${d.getDate()}`;
        return `
        <div class="chart-bar-col" title="${esc(label)} · ${esc(money(r.total))}">
          <div class="chart-bar" style="height:${Math.max(2, Math.round((r.total / max) * 100))}%"></div>
          <span class="chart-bar-label">${esc(label)}</span>
        </div>`;
      })
      .join("");
  }

  function homeBestsellersHTML(bestsellers) {
    if (!bestsellers.length) return `<p class="small" style="color:var(--text-muted)">${esc(t("아직 주문이 없습니다"))}</p>`;
    const max = Math.max(1, ...bestsellers.slice(0, 3).map((b) => b.qty));
    return bestsellers
      .slice(0, 3)
      .map(
        (b, i) => `
      <div class="best-row">
        <span class="best-rank">${i + 1}</span>
        <span>${esc(t(b.name))}</span>
        <span class="tnum">${esc(t("{n}개", { n: b.qty }))}</span>
        <div class="best-bar-track"><div class="best-bar-fill" style="width:${Math.round((b.qty / max) * 100)}%"></div></div>
      </div>`
      )
      .join("");
  }

  function goToTab(tab) {
    document.querySelector(`.nav-item[data-tab="${tab}"]`)?.click();
  }

  /* ---------- 인수인계 노트 ----------
     "오늘 특이사항을 다음 근무자에게 남기고 싶다"는 요청(2026-09) — 대화형이 아니라 짧은
     메모를 시간순으로 쌓아두는 게시판. 037_handoff_notes_and_calendar.sql 미실행이면 서버가
     빈 목록만 내려줘 조용히 비어 보인다(다른 선택 기능과 같은 원칙). */
  function handoffNoteRowHTML(n) {
    return `
      <div class="panel" data-id="${esc(n.id)}" style="padding:10px 12px;display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div style="min-width:0">
          <div style="word-break:break-word">${esc(n.content)}</div>
          <div class="small" style="color:var(--text-muted);margin-top:4px">${esc(emailName(n.adminEmail))} · ${fmtDateTime(n.at)}</div>
        </div>
        <button type="button" class="btn btn--sm btn--ghost handoff-delete" aria-label="${esc(t("삭제"))}">✕</button>
      </div>`;
  }

  async function paintHandoffNotes() {
    const result = await adminFetch("/api/admin/handoff-notes");
    if (!result) return;
    el("handoff-list").innerHTML = result.items.length
      ? result.items.map(handoffNoteRowHTML).join("")
      : `<p class="small" style="color:var(--text-muted)">${esc(t("아직 남긴 노트가 없습니다"))}</p>`;
    el("handoff-list").querySelectorAll(".handoff-delete").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]").dataset.id;
        btn.disabled = true;
        const ok = await adminFetch(`/api/admin/handoff-notes/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!ok) { btn.disabled = false; return; }
        paintHandoffNotes();
      })
    );
  }

  el("handoff-submit").addEventListener("click", async () => {
    const input = el("handoff-input");
    const content = input.value.trim();
    if (!content) return;
    const btn = el("handoff-submit");
    btn.disabled = true;
    const result = await adminFetch("/api/admin/handoff-notes", { method: "POST", body: JSON.stringify({ content }) });
    btn.disabled = false;
    if (!result) return;
    input.value = "";
    paintHandoffNotes();
  });
  el("handoff-input").addEventListener("keydown", (e) => { if (e.key === "Enter") el("handoff-submit").click(); });

  async function paintAdminHome(profile) {
    const [dash, notif] = await Promise.all([
      adminFetch("/api/admin/dashboard"),
      adminFetch("/api/admin/notifications"),
    ]);
    if (!dash || !notif) return;

    const pendingTotal = notif.total || 0;
    const name = profile.name || profile.email;
    const bucket = homeTimeBucket(new Date().getHours());
    const dateStr = new Date().toLocaleDateString(getLang() === "de" ? "de-DE" : "ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
    el("home-greeting").textContent = t(HOME_TITLE[bucket]);
    el("home-subline").textContent = `${t(homeSublineKey(bucket, pendingTotal), { name, n: pendingTotal })} · ${dateStr}`;

    el("home-tiles").innerHTML = [
      homeTileHTML(t("오늘 매출"), money(dash.todayRevenue), "dashboard"),
      homeTileHTML(t("이번 달 매출"), money(dash.monthRevenue), "dashboard"),
      homeTileHTML(t("오늘 주문"), t("{n}건", { n: dash.todayOrders }), "orders"),
      homeTileHTML(t("입금 확인 대기"), t("{n}건", { n: dash.pendingCount }), "orders"),
      homeTileHTML(t("확인 필요 총계"), t("확인 필요 {n}건", { n: pendingTotal }), "orders"),
    ].join("");

    el("home-revenue-chart").innerHTML = homeRevenueChartHTML(dash.dailyRevenue || []);
    el("home-bestsellers").innerHTML = homeBestsellersHTML(dash.bestsellers || []);

    el("home-shortcuts").innerHTML = [
      homeShortcutHTML(t("전체 주문"), t("주문 검색·상태 변경·배송 등록"), "orders"),
      homeShortcutHTML(t("재고"), t("색상·사이즈별 수량 확인·수정"), "inventory"),
      homeShortcutHTML(t("결제 트랜잭션"), t("실패·불일치한 결제 시도 확인"), "paymentlog"),
      homeShortcutHTML(t("회원 계정 관리"), t("회원 검색, 차단·삭제, 관리자 승격"), "members"),
      homeShortcutHTML(t("발송 실패 아웃박스"), t("이메일·알림 발송 실패 확인"), "outbox"),
      homeShortcutHTML(t("대시보드"), t("매출·베스트셀러·기기별 통계"), "dashboard"),
      homeShortcutHTML(t("캘린더"), t("발매일·행사·휴무 일정 확인"), "calendar"),
    ].join("");

    document.querySelectorAll("[data-tab-link]").forEach((btn) =>
      btn.addEventListener("click", () => goToTab(btn.dataset.tabLink))
    );

    paintHandoffNotes();
  }
