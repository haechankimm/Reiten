  /* ---------- 대시보드 (매출/베스트셀러 요약) ---------- */
  function dayLabel(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function renderDashboard(d) {
    el("dashboard-stats").innerHTML = `
      <div class="stat-tile">
        <div class="stat-tile-label">${esc(t("오늘 매출"))}</div>
        <div class="stat-tile-value tnum">${money(d.todayRevenue)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile-label">${esc(t("이번 달 매출"))}</div>
        <div class="stat-tile-value tnum">${money(d.monthRevenue)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile-label">${esc(t("누적 주문"))}</div>
        <div class="stat-tile-value tnum">${d.totalOrders.toLocaleString("ko-KR")}</div>
        <div class="stat-tile-sub">${esc(t("건"))}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile-label">${esc(t("입금 대기"))}</div>
        <div class="stat-tile-value tnum">${d.pendingCount.toLocaleString("ko-KR")}</div>
        <div class="stat-tile-sub">${esc(t("건 — 확인 필요"))}</div>
      </div>`;

    const max = Math.max(1, ...d.dailyRevenue.map((r) => r.total));
    el("dashboard-revenue-chart").innerHTML = d.dailyRevenue
      .map(
        (r) => `
        <div class="chart-bar-col" title="${esc(dayLabel(r.date))} · ${esc(money(r.total))}">
          <div class="chart-bar" style="height:${Math.max(2, Math.round((r.total / max) * 100))}%"></div>
          <span class="chart-bar-label">${esc(dayLabel(r.date))}</span>
        </div>`
      )
      .join("");

    const bestMax = Math.max(1, ...d.bestsellers.map((b) => b.qty));
    el("dashboard-bestsellers").innerHTML = d.bestsellers.length
      ? d.bestsellers
          .map(
            (b, i) => `
          <div class="best-row">
            <span class="best-rank">${i + 1}</span>
            <span>${esc(t(b.name))}</span>
            <span class="tnum">${esc(t("{n}개", { n: b.qty }))}</span>
            <div class="best-bar-track"><div class="best-bar-fill" style="width:${Math.round((b.qty / bestMax) * 100)}%"></div></div>
          </div>`
          )
          .join("")
      : `<p class="small" style="color:var(--text-muted)">${esc(t("아직 주문이 없습니다"))}</p>`;

    /* GA4 방문자 분석과 달리 이건 우리 DB의 실제 결제 완료 주문만 센 값이라 device가 없는
       주문(마이그레이션 022 이전에 만들어졌거나, 서버가 device 없이 저장한 경우)은 "확인
       안 됨"으로 묶는다 — DEVICE_LABEL은 아래에서 GA4 렌더링과 같이 쓰므로 여기서 참조. */
    const deviceMax = Math.max(1, ...(d.salesByDevice || []).map((s) => s.revenue));
    el("dashboard-sales-by-device").innerHTML = (d.salesByDevice || []).length
      ? d.salesByDevice
          .map(
            (s) => `
          <div class="best-row">
            <span></span>
            <span>${esc(t(DEVICE_LABEL[s.device] || "확인 안 됨"))}</span>
            <span class="tnum">${esc(money(s.revenue))} <span class="small" style="color:var(--text-muted)">(${esc(t("{n}건", { n: s.orders }))})</span></span>
            <div class="best-bar-track"><div class="best-bar-fill" style="width:${Math.round((s.revenue / deviceMax) * 100)}%"></div></div>
          </div>`
          )
          .join("")
      : `<p class="small" style="color:var(--text-muted)">${esc(t("아직 주문이 없습니다"))}</p>`;

    /* 반품 사유 통계 — return_requests.reason을 그대로 집계한 것(server.js의
       computeDashboardStats). 새 테이블 없이 "왜 반품이 많은지"를 한눈에 보여주는 용도. */
    const reasonMax = Math.max(1, ...(d.returnReasons || []).map((r) => r.count));
    el("dashboard-return-reasons").innerHTML = (d.returnReasons || []).length
      ? d.returnReasons
          .map(
            (r) => `
          <div class="best-row">
            <span></span>
            <span>${esc(t(r.reason))}</span>
            <span class="tnum">${esc(t("{n}건", { n: r.count }))}</span>
            <div class="best-bar-track"><div class="best-bar-fill" style="width:${Math.round((r.count / reasonMax) * 100)}%"></div></div>
          </div>`
          )
          .join("")
      : `<p class="small" style="color:var(--text-muted)">${esc(t("아직 반품 신청이 없습니다"))}</p>`;

    /* 첫 구매·재구매 감사 쿠폰 발급/사용 현황 — server.js의 computeDashboardStats가
       coupons(발급)·orders.coupon_code(사용)만으로 집계해서 내려준다. 새 쿠폰이 하나도
       안 나갔으면(issued=0) 발급률 계산이 무의미하니 "아직 없음" 문구만 보여준다. */
    const thanksRows = [
      { label: "첫 구매 감사 쿠폰", stat: d.firstPurchaseCoupon },
      { label: "재구매 감사 쿠폰", stat: d.repeatPurchaseCoupon },
    ].filter((r) => r.stat);
    el("dashboard-thanks-coupons").innerHTML = thanksRows.some((r) => r.stat.issued > 0)
      ? thanksRows
          .map(
            (r) => `
          <div class="best-row">
            <span></span>
            <span>${esc(t(r.label))}</span>
            <span class="tnum">${esc(t("발급 {issued}건 · 사용 {used}건 ({rate}%)", { issued: r.stat.issued, used: r.stat.used, rate: r.stat.usageRate }))}</span>
            <div class="best-bar-track"><div class="best-bar-fill" style="width:${r.stat.issued ? Math.round((r.stat.used / r.stat.issued) * 100) : 0}%"></div></div>
          </div>`
          )
          .join("")
      : `<p class="small" style="color:var(--text-muted)">${esc(t("아직 발급된 감사 쿠폰이 없습니다"))}</p>`;
  }

  const DEVICE_LABEL = { mobile: "모바일", desktop: "PC", tablet: "태블릿" };
  const CHANNEL_LABEL = {
    Direct: "직접 접속", "Organic Search": "검색(자연)", "Paid Search": "검색(광고)",
    Referral: "다른 사이트 링크", "Organic Social": "SNS(자연)", "Paid Social": "SNS(광고)",
    Email: "이메일", Display: "디스플레이 광고", Unassigned: "미분류",
  };

  /* GA4 방문자 통계(선택 기능) — server/.env에 GA4_SERVICE_ACCOUNT_JSON/GA4_PROPERTY_ID가
     설정 안 돼 있으면 서버가 stats:null을 내려주고, 이때는 섹션 자체를 숨긴다.
     labelMap 값(한국어)을 t() 없이 그대로 꽂아 쓰고 있어서 독일어 모드에서도 "직접 접속" 같은
     한글이 그대로 새던 버그 발견·수정 — 반드시 t()를 거쳐야 사전 번역이 적용된다. */
  function barRows(rows, labelMap, valueKey, labelKey) {
    if (!rows.length) return `<p class="small" style="color:var(--text-muted)">${esc(t("데이터가 아직 없습니다"))}</p>`;
    const max = Math.max(1, ...rows.map((r) => r[valueKey]));
    return rows
      .map(
        (r) => `
        <div class="best-row">
          <span></span>
          <span>${esc(t(labelMap[r[labelKey]] || r[labelKey]))}</span>
          <span class="tnum">${r[valueKey].toLocaleString("ko-KR")}</span>
          <div class="best-bar-track"><div class="best-bar-fill" style="width:${Math.round((r[valueKey] / max) * 100)}%"></div></div>
        </div>`
      )
      .join("");
  }

  /* "PC만 있고 모바일·태블릿은 왜 없냐"는 피드백 — 방문이 0인 기기 종류도 항상 표시해서
     "데이터 누락"이 아니라 "그냥 0건"이라는 걸 바로 알 수 있게 한다(유입 경로는 종류가 GA4
     기준 8종 이상으로 많고 매번 달라질 수 있어 여기까지는 적용하지 않음). */
  function withAllDeviceCategories(byDevice) {
    const known = Object.keys(DEVICE_LABEL);
    return known.map((device) => byDevice.find((r) => r.device === device) || { device, users: 0 });
  }

  function renderVisitorStats(stats) {
    if (!stats) {
      el("dashboard-visitors").hidden = true;
      return;
    }
    el("dashboard-visitors").hidden = false;
    el("dashboard-devices").innerHTML = barRows(withAllDeviceCategories(stats.byDevice), DEVICE_LABEL, "users", "device");
    el("dashboard-sources").innerHTML = barRows(stats.bySource, CHANNEL_LABEL, "sessions", "source");
  }

  /* 기본 30일 — "3개월/6개월/누적"으로 바꿔보고 싶다는 요청으로 세그먼트 버튼 추가.
     "누적"은 GA4가 실제로 무한정 보관하지 않아(속성 데이터 보관 설정에 따라 보통 최대
     14~18개월) 완전한 전체 누적은 아니고, 그 최대 범위(540일)로 조회한다 — 화면에도 이 점을
     그대로 안내해뒀다. */
  let visitorPeriodDays = 30;
  el("visitor-period-switch")?.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (Number(btn.dataset.days) === visitorPeriodDays) return;
      visitorPeriodDays = Number(btn.dataset.days);
      el("visitor-period-switch").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      loadVisitorStats();
    });
  });

  async function loadVisitorStats() {
    const analytics = await adminFetch(`/api/admin/analytics?days=${visitorPeriodDays}`);
    renderVisitorStats(analytics && analytics.stats);
  }

  async function paintAdminDashboard() {
    const result = await adminFetch("/api/admin/dashboard");
    if (!result) return;
    renderDashboard(result);
    loadVisitorStats();
  }

  function downloadDashboardExport(format) {
    return downloadExportFile(`/api/admin/dashboard/export?format=${format}`, "reiten-dashboard", format);
  }
  wireExportMenu("dash-export", "dash-export-menu", downloadDashboardExport);

  /* /api/admin/orders 호출이 실제로 성공했을 때(=서버가 관리자로 인정했을 때)만 패널을 연다 —
     profile.role만 믿지 않는다(계정 페이지 관리자 판단 로직과 동일한 원칙). */
  async function tryShowAdminPanel(profile) {
    const orders = await adminFetch("/api/admin/orders");
    if (!orders) return false;
    el("admin-panel").hidden = false;
    el("sidebar").hidden = false;
    el("admin-chip").hidden = false;
    el("notif-wrap").hidden = false;
    el("logout").hidden = false;
    const name = profile.name || profile.email;
    el("admin-name").textContent = name;
    el("admin-avatar").textContent = name.slice(0, 1).toUpperCase();
    currentAdminId = profile.id;
    paintNotifications();
    /* 로그인 시점 조회만으로는 Works를 계속 켜둔 사이 들어온 신규 알림을 새로고침 전까지
       모른다는 피드백 — 60초마다 자동으로 다시 센다(패널이 열려 있어도 갱신됨). */
    if (!notifPollTimer) notifPollTimer = setInterval(paintNotifications, 60000);
    paintAdminAccounts();
    paintAdminMembers();
    paintAdminOrders();
    paintAdminReturns();
    paintAdminInventory();
    paintQnaTemplates().then(() => paintAdminQna());
    paintAdminProducts();
    paintAdminCoupons();
    paintAdminReviews();
    paintAdminLookbook();
    paintAdminSettings();
    paintAdminAuditLog();
    paintAdminDashboard();
    initPush();
    return true;
  }

