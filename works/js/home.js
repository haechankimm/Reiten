  /* ---------- 오늘(홈) — 로그인 직후 첫 화면 ----------
     예전엔 로그인하면 곧장 "전체 주문" 목록으로 가서, 오늘 상황을 파악하려면 대시보드 탭을
     따로 눌러야 했다(2026-09, figlo WORKS 벤치마크로 나온 요청) — 이미 있는 대시보드·알림벨
     데이터를 재활용해 첫 화면에서 바로 보여준다. "OOO님, 오늘도 힘내세요" 같은 고정 인사말은
     쓰지 말아달라는 요청이 있어서, 시간대(아침/오후/저녁) × 확인할 게 있는지(0건/일부 건)를
     조합한 6가지 문장 중 하나를 그때그때 고른다(무작위가 아니라 시간·상태 기반이라 같은
     시간대·같은 상태에서 다시 열어도 뜬금없이 안 바뀜). */
  function homeGreetingKey(hour, pendingTotal) {
    const bucket = hour < 11 ? "morning" : hour < 18 ? "afternoon" : "evening";
    const busy = pendingTotal > 0;
    const keys = {
      morning: { idle: "{name}님, 좋은 아침이에요 — 오늘은 조용하네요.", busy: "{name}님, 좋은 아침이에요 — 확인할 게 {n}건 있어요." },
      afternoon: { idle: "{name}님, 순조롭게 흘러가는 오후예요.", busy: "{name}님, 오후에도 확인할 게 {n}건 남아있어요." },
      evening: { idle: "{name}님, 오늘 하루도 무사히 마무리되고 있어요.", busy: "{name}님, 마감 전에 {n}건만 더 확인해 주세요." },
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

  function goToTab(tab) {
    document.querySelector(`.nav-item[data-tab="${tab}"]`)?.click();
  }

  async function paintAdminHome(profile) {
    const [dash, notif] = await Promise.all([
      adminFetch("/api/admin/dashboard"),
      adminFetch("/api/admin/notifications"),
    ]);
    if (!dash || !notif) return;

    const pendingTotal = notif.total || 0;
    const name = profile.name || profile.email;
    el("home-greeting").textContent = t(homeGreetingKey(new Date().getHours(), pendingTotal), { name, n: pendingTotal });
    el("home-subline").textContent = new Date().toLocaleDateString(getLang() === "de" ? "de-DE" : "ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

    el("home-tiles").innerHTML = [
      homeTileHTML(t("오늘 매출"), money(dash.todayRevenue), "dashboard"),
      homeTileHTML(t("오늘 주문"), t("{n}건", { n: dash.todayOrders }), "orders"),
      homeTileHTML(t("입금 확인 대기"), t("{n}건", { n: dash.pendingCount }), "orders"),
      homeTileHTML(t("확인 필요 총계"), t("확인 필요 {n}건", { n: pendingTotal }), "orders"),
    ].join("");

    el("home-shortcuts").innerHTML = [
      homeShortcutHTML(t("전체 주문"), t("주문 검색·상태 변경·배송 등록"), "orders"),
      homeShortcutHTML(t("재고"), t("색상·사이즈별 수량 확인·수정"), "inventory"),
      homeShortcutHTML(t("결제 트랜잭션"), t("실패·불일치한 결제 시도 확인"), "paymentlog"),
      homeShortcutHTML(t("회원 계정 관리"), t("회원 검색, 차단·삭제, 관리자 승격"), "members"),
      homeShortcutHTML(t("발송 실패 아웃박스"), t("이메일·알림 발송 실패 확인"), "outbox"),
      homeShortcutHTML(t("대시보드"), t("매출·베스트셀러·기기별 통계"), "dashboard"),
    ].join("");

    document.querySelectorAll("[data-tab-link]").forEach((btn) =>
      btn.addEventListener("click", () => goToTab(btn.dataset.tabLink))
    );
  }
