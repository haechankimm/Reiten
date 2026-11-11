/* qna.html 전용 스크립트 — 예전엔 HTML 안 인라인 <script>였다(2026-11-11 분리, 동작 동일). */
  applyI18n();
  renderHeader("");

  (async () => {
  await Promise.all([loadProducts(), loadColors()]);

  const el = (id) => document.getElementById(id);
  const filterProduct = qs("product");
  let serverUp = false;
  let items = [];
  let activeFilter = filterProduct && PRODUCTS.some(p => p.id === filterProduct) ? filterProduct : "all";

  function productLabel(id) {
    if (id === "general") return t("전체 상품");
    const p = getProduct(id);
    return p ? productName(p) : id;
  }

  function paintFilters() {
    const cats = ["all", "general", ...PRODUCTS.map(p => p.id)];
    el("filters").innerHTML = cats.map(id => `
      <button class="chip" type="button" data-id="${id}" aria-pressed="${id === activeFilter}">
        ${id === "all" ? esc(t("전체")) : esc(productLabel(id))}
      </button>`).join("");
    el("filters").querySelectorAll(".chip").forEach(b =>
      // 필터 칩도 다시 그려야 aria-pressed(선택 표시)가 바뀐다 — 예전엔 목록만 다시 그렸다(2026-10-28 정기 감사).
      b.addEventListener("click", () => { activeFilter = b.dataset.id; paintFilters(); paintList(); }));
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString(getLang() === "ko" ? "ko-KR" : getLang() === "ja" ? "ja-JP" : "en-US");
  }

  /* 아래 템플릿 문구는 data-i18n 대신 t()로 바로 번역한다 — applyI18n()은 페이지 로드 때 한 번만 돌아서
     나중에 innerHTML로 그린 data-i18n 문구는 영어·일본어에서도 한국어로 남았다(2026-10-28 정기 감사). */
  function paintList() {
    const list = activeFilter === "all" ? items : items.filter(q => q.productId === activeFilter);
    el("list").innerHTML = list.map(q => `
      <div class="panel" data-reveal>
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline">
          <b>${esc(q.name)}</b>
          <span class="small tnum">${fmtDate(q.at)}</span>
        </div>
        <div class="small" style="margin-top:6px">${esc(productLabel(q.productId))} · ${q.status === "답변완료" ? esc(t("답변완료")) : esc(t("답변대기"))}</div>
        <p style="margin-top:10px">${
          q.secret && q.question === null
            ? `🔒 ${esc(t("비밀글입니다."))}`
            : esc(q.question)
        }</p>
        ${q.answer ? `
          <div class="notice" style="margin-top:12px">
            <b>${esc(t("판매자 답변"))}</b>
            <p style="margin-top:6px">${esc(q.answer)}</p>
          </div>` : ""}
      </div>`).join("");
    el("empty").hidden = list.length > 0;
    initReveal();
  }

  el("q-product").innerHTML = ["general", ...PRODUCTS.map(p => p.id)]
    .map(id => `<option value="${id}">${esc(productLabel(id))}</option>`).join("");
  if (filterProduct && PRODUCTS.some(p => p.id === filterProduct)) el("q-product").value = filterProduct;

  // 회원이면 내 문의 목록에서 비밀글 답변을 볼 수 있어 이메일이 필수가 아니다(비회원만 이메일 칸을 보여줌).
  let isMember = false;
  (async () => {
    const profile = await getCurrentProfile();
    isMember = !!profile;
    if (profile && profile.name) el("q-name").value = profile.name;
  })();
  el("q-secret").addEventListener("change", () => {
    el("q-email-field").hidden = !(el("q-secret").checked && !isMember);
  });

  /* 비슷한 질문 먼저 보여주기 — 문의를 입력하는 동안 이미 답변된 과거 문의 중 겹치는 단어가
     있는 것을 미리 보여줘서, 같은 질문이 반복 등록되는 걸 줄이고 고객도 더 빨리 답을 얻게
     한다(완전 자동응답이 아니라 참고용 — 그래도 등록은 자유롭게 할 수 있음). 새 API 없이
     이미 받아온 items(GET /api/qna)만으로 클라이언트에서 계산한다. */
  function tokenize(text) {
    return [...new Set(
      String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 2)
    )];
  }

  function findSimilarQna(text) {
    const tokens = tokenize(text);
    if (!tokens.length) return [];
    const candidates = items.filter((q) => q.answer && !(q.secret && q.question === null));
    return candidates
      .map((q) => ({ q, score: tokens.filter((tok) => tokenize(q.question).includes(tok)).length }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.q.at) - new Date(a.q.at))
      .slice(0, 3)
      .map((s) => s.q);
  }

  function paintSimilarQna() {
    const matches = findSimilarQna(el("q-question").value);
    const box = el("similar-qna");
    if (!matches.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = `
      <div class="notice">
        <b>${esc(t("이미 비슷한 질문에 답변드린 적이 있어요"))}</b>
        <div style="margin-top:10px;display:grid;gap:10px">
          ${matches.map((q) => `
            <div>
              <p style="font-weight:600">${esc(q.question)}</p>
              <p class="small" style="margin-top:4px">${esc(q.answer)}</p>
            </div>`).join("")}
        </div>
        <p class="small" style="margin-top:10px;color:var(--muted,#888)" >${esc(t("원하는 답을 못 찾으셨다면 그대로 등록해 주세요."))}</p>
      </div>`;
  }

  let similarQnaTimer = null;
  el("q-question").addEventListener("input", () => {
    clearTimeout(similarQnaTimer);
    similarQnaTimer = setTimeout(paintSimilarQna, 400);
  });

  el("qna-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = el("q-name");
    const question = el("q-question");
    let ok = true;
    if (!name.value.trim()) { name.setAttribute("aria-invalid", "true"); name.closest(".field").querySelector(".err").classList.add("on"); ok = false; }
    else { name.setAttribute("aria-invalid", "false"); name.closest(".field").querySelector(".err").classList.remove("on"); }
    if (!question.value.trim()) { question.setAttribute("aria-invalid", "true"); question.closest(".field").querySelector(".err").classList.add("on"); ok = false; }
    else { question.setAttribute("aria-invalid", "false"); question.closest(".field").querySelector(".err").classList.remove("on"); }
    // 비회원 비밀글은 답변 받을 이메일이 필수(회원은 내 문의에서 답변을 볼 수 있어 선택).
    const emailInput = el("q-email");
    const needEmail = el("q-secret").checked && !isMember;
    const emailVal = emailInput.value.trim();
    const emailBad = (needEmail && !emailVal) || (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal));
    emailInput.setAttribute("aria-invalid", String(emailBad));
    emailInput.closest(".field").querySelector(".err").classList.toggle("on", emailBad);
    if (emailBad) ok = false;
    if (!ok) return;

    const btn = el("q-submit");
    btn.disabled = true;
    try {
      const token = await getAccessToken();
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = "Bearer " + token;

      const res = await fetch("/api/qna", {
        method: "POST",
        headers,
        body: JSON.stringify({
          productId: el("q-product").value,
          name: name.value.trim(),
          question: question.value.trim(),
          secret: el("q-secret").checked,
          email: emailVal || undefined,
        }),
      });
      if (!res.ok) {
        toast(apiErrorText(await res.json().catch(() => ({})), t("문의 등록에 실패했습니다")));
        return;
      }
      const created = await res.json();
      items = [created, ...items];
      question.value = "";
      el("q-secret").checked = false;
      emailInput.value = "";
      el("q-email-field").hidden = true;
      el("similar-qna").hidden = true;
      paintList();
      toast(t("문의가 등록되었습니다"));
    } catch (err) {
      toast(t("문의 등록에 실패했습니다"));
    } finally {
      btn.disabled = false;
    }
  });

  (async () => {
    try {
      const token = await getAccessToken();
      const headers = {};
      if (token) headers.Authorization = "Bearer " + token;
      const res = await fetch("/api/qna", { headers });
      if (res.ok) {
        items = await res.json();
        serverUp = true;
      }
    } catch (err) {}

    if (!serverUp) {
      el("qna-form").hidden = true;
      el("no-server-notice").hidden = false;
    }
    paintFilters();
    paintList();
  })();

  renderFooter();
  })();
