  /* ---------- 사용 통계 ----------
     "어떤 탭·기능을 자주/안 쓰는지 중장기로 보고 싶다"는 요청(2026-09) — nav.js의
     trackUsage()가 쌓아온 admin_usage_log를 집계해서 보여준다. 탭은 사이드바에 있는 걸
     전부 먼저 나열해두고(한 번도 안 열어본 탭도 0건으로 보이게) 서버 집계값을 덮어씌우는
     방식 — 그래야 "이 기능은 아예 안 쓴다"는 것 자체가 눈에 보인다. */
  const USAGE_TAB_LABEL = {
    home: "오늘", orders: "전체 주문", returns: "반품·교환 신청", inventory: "재고", qna: "Q&A",
    paymentlog: "결제 트랜잭션", products: "상품", coupons: "쿠폰", reviews: "리뷰", lookbook: "룩북",
    members: "회원 계정 관리", calendar: "캘린더", notices: "공지", outbox: "발송 실패 아웃박스",
    settings: "정보", auditlog: "활동 로그", dashboard: "대시보드", usagestats: "사용 통계",
  };
  const USAGE_FEATURE_LABEL = {
    "feature:export:ord-export": "주문 내보내기",
    "feature:export:inv-export": "재고 내보내기",
    "feature:export:dash-export": "대시보드 내보내기",
    "feature:export:mb-export": "회원 CSV 내보내기",
  };

  let usagePeriodDays = 30;

  function usageBarRowsHTML(rows, max) {
    if (!rows.length) return `<p class="small" style="color:var(--text-muted)">${esc(t("데이터가 아직 없습니다"))}</p>`;
    return rows
      .map(
        (r) => `
      <div class="best-row">
        <span></span>
        <span>${esc(r.label)}</span>
        <span class="tnum">${esc(t("{n}회", { n: r.count }))}${r.lastUsedAt ? ` <span class="small" style="color:var(--text-muted)">· ${esc(t("최근"))} ${fmtDate(r.lastUsedAt)}</span>` : ""}</span>
        <div class="best-bar-track"><div class="best-bar-fill" style="width:${max ? Math.round((r.count / max) * 100) : 0}%"></div></div>
      </div>`
      )
      .join("");
  }

  async function paintUsageStats() {
    const result = await adminFetch(`/api/admin/usage-log/stats?days=${usagePeriodDays}`);
    if (!result) return;

    const byKey = new Map(result.items.map((it) => [it.key, it]));

    // 탭은 사이드바에 있는 전체 목록을 기준으로 그린다 — 로그가 하나도 없는 탭도 0건으로 노출.
    const tabRows = Object.keys(USAGE_TAB_LABEL)
      .map((tab) => {
        const item = byKey.get(`tab:${tab}`);
        return { label: t(USAGE_TAB_LABEL[tab]), count: item ? item.count : 0, lastUsedAt: item ? item.lastUsedAt : null };
      })
      .sort((a, b) => b.count - a.count);
    const tabMax = Math.max(1, ...tabRows.map((r) => r.count));

    // 기능은 실제로 한 번이라도 기록된 것만 보여준다(목록이 앞으로 계속 늘어날 수 있어 0건까지
    // 강제로 다 나열하면 오히려 안 쓰는 게 아니라 "아직 안 만든 기능"까지 섞여 헷갈린다).
    const featureRows = result.items
      .filter((it) => it.key.startsWith("feature:"))
      .map((it) => ({ label: USAGE_FEATURE_LABEL[it.key] || it.key, count: it.count, lastUsedAt: it.lastUsedAt }))
      .sort((a, b) => b.count - a.count);
    const featureMax = Math.max(1, ...featureRows.map((r) => r.count));

    el("usage-summary").textContent = t("최근 {days}일간 총 {n}건의 사용 기록", { days: usagePeriodDays, n: result.totalEvents });
    el("usage-tabs").innerHTML = usageBarRowsHTML(tabRows, tabMax);
    el("usage-features").innerHTML = usageBarRowsHTML(featureRows, featureMax);
  }

  el("usage-period-switch")?.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      usagePeriodDays = Number(btn.dataset.days);
      el("usage-period-switch").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      paintUsageStats();
    });
  });

  document.querySelector('.nav-item[data-tab="usagestats"]')?.addEventListener("click", paintUsageStats);
