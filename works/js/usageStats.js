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
    agent: "AI 승인함", expenses: "지출·정산", staff: "직원·권한",
  };
  const USAGE_FEATURE_LABEL = {
    "feature:export:ord-export": "주문 내보내기",
    "feature:export:inv-export": "재고 내보내기",
    "feature:export:dash-export": "대시보드 내보내기",
    "feature:export:mb-export": "회원 CSV 내보내기",
  };

  let usagePeriodDays = 30;

  /* 한 줄 막대(2026-11-11) — 예전엔 항목마다 이름 줄 + 막대 줄로 두 줄씩 써서 스크롤이 길었다.
     이름 · 막대 · 횟수 · 최근 사용(짧게)을 한 줄에, 넓은 화면에선 두 단으로 나눠 한 화면에 들어오게 한다. */
  function usageShortDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function usageBarRowsHTML(rows, max) {
    if (!rows.length) return `<p class="small" style="color:var(--text-muted)">${esc(t("데이터가 아직 없습니다"))}</p>`;
    return `<div class="usage-rows">${rows
      .map(
        (r) => `<div class="usage-row" title="${r.lastUsedAt ? esc(t("최근") + " " + fmtDate(r.lastUsedAt)) : ""}">
        <span class="usage-name">${esc(r.label)}</span>
        <span class="usage-track"><span class="usage-fill" style="width:${max ? Math.max(2, Math.round((r.count / max) * 100)) : 0}%"></span></span>
        <span class="usage-count tnum">${esc(String(r.count))}</span>
        <span class="usage-last tnum">${r.lastUsedAt ? esc(usageShortDate(r.lastUsedAt)) : ""}</span>
      </div>`
      )
      .join("")}</div>`;
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
      .map((it) => ({ label: t(USAGE_FEATURE_LABEL[it.key] || it.key), count: it.count, lastUsedAt: it.lastUsedAt }))
      .sort((a, b) => b.count - a.count);
    const featureMax = Math.max(1, ...featureRows.map((r) => r.count));

    el("usage-summary").textContent = t("최근 {days}일간 총 {n}건의 사용 기록", { days: usagePeriodDays, n: result.totalEvents });
    // 안 쓴(0회) 탭은 막대 대신 한 줄 칩으로 모은다 — "안 쓰는 기능"이 한눈에 보이고 스크롤도 줄어든다
    const used = tabRows.filter((r) => r.count > 0);
    const unused = tabRows.filter((r) => r.count === 0);
    el("usage-tabs").innerHTML = usageBarRowsHTML(used, tabMax) + (unused.length
      ? `<div class="usage-unused"><span class="m-label">${esc(t("이 기간에 안 연 탭"))}</span> ${unused.map((r) => `<span class="usage-chip">${esc(r.label)}</span>`).join("")}</div>`
      : "");
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
