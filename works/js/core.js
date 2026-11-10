  /* account.html의 관리자 패널 로직을 그대로 옮겨왔다 — 소비자용 app.js(헤더/테마/배너 애니메이션 등)는
     Works에서 쓸 일이 없어 아예 불러오지 않고, 거기서 쓰던 esc/money/toast만 최소한으로 다시 정의한다. */
  const el = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const money = (n) => {
    const num = Number(n || 0);
    return getLang() === "ko" ? num.toLocaleString("ko-KR") + "원" : "₩" + num.toLocaleString("en-US");
  };

  let toastTimer;
  /* toast(msg) — 짧은 안내. toast(msg, { undo: async () => {...} }) — "되돌리기" 버튼이 붙고 6초 동안 보인다(2026-11-11).
     되돌리기는 같은 서버 기능을 반대로 한 번 더 부르는 것이라 활동 로그에도 두 줄(원래 동작·되돌림)이 남는다. */
  function toast(msg, opts) {
    let box = document.querySelector(".toast");
    if (!box) {
      box = document.createElement("div");
      box.className = "toast";
      box.setAttribute("role", "status");
      document.body.appendChild(box);
    }
    box.textContent = msg;
    const undo = opts && typeof opts.undo === "function" ? opts.undo : null;
    if (undo) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-undo";
      btn.textContent = t("되돌리기");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        clearTimeout(toastTimer);
        box.classList.remove("on");
        try {
          const ok = await undo();
          if (ok !== false) toast(t("되돌렸습니다"));
        } catch (e) {
          toast(t("되돌리지 못했습니다"));
        }
      });
      box.appendChild(btn);
    }
    box.classList.toggle("toast--action", !!undo);
    requestAnimationFrame(() => box.classList.add("on"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove("on"), undo ? 6000 : 2600);
  }

  /* 라이트/다크는 기본적으로 OS 설정을 따르고, 한 번 수동으로 바꾸면 그 이후로는
     기기와 무관하게 그 선택을 기억한다(로컬에만 저장, 서버에는 안 감). */
  const savedTheme = localStorage.getItem("works_theme");
  if (savedTheme === "dark" || savedTheme === "light") document.documentElement.setAttribute("data-theme", savedTheme);
  el("theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const current = root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("works_theme", next);
  });

  applyI18n();

  function authErrorMessage(error) {
    const msg = String((error && error.message) || "");
    if (/password.*(least|weak)/i.test(msg)) return t("비밀번호는 6자 이상이어야 합니다.");
    if (/invalid.*email/i.test(msg)) return t("이메일 형식이 올바르지 않습니다.");
    if (/rate limit/i.test(msg)) return t("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
    return msg;
  }

  const ORDER_STATUSES = ["입금대기", "입금확인", "배송중", "완료", "취소"];
  /* 반품·교환·주문취소 신청은 유형마다 쓰는 상태가 다르다(2026-10-02, 서버 routes/returns.js와 같은 표).
     반품 "완료"는 환불 처리 창에서만, 교환은 "재발송" 단계가 있고, 취소 신청 "완료"는 실제 주문 취소. */
  const RETURN_STATUSES_BY_TYPE = {
    return: ["접수", "수거중", "처리중", "완료", "반려"],
    exchange: ["접수", "수거중", "재발송", "완료", "반려"],
    cancel: ["접수", "완료", "반려"],
  };
  const RETURN_STATUSES = ["접수", "수거중", "처리중", "재발송", "완료", "반려"];
  const ORDER_STATUS_CLASS = { "입금대기": "st-pending", "입금확인": "st-confirmed", "배송중": "st-shipping", "완료": "st-done", "취소": "st-neutral" };
  const RETURN_STATUS_CLASS = { "접수": "st-pending", "수거중": "st-shipping", "처리중": "st-confirmed", "재발송": "st-shipping", "완료": "st-done", "반려": "st-neutral" };

  /* 날짜만으로는 "오늘 들어온 주문 중 어느 게 먼저인지" 구분이 안 된다는 피드백 — 시:분까지
     함께 보여준다(초 단위는 목록에서 불필요한 정보라 뺌). */
  function fmtDate(iso) {
    return new Date(iso).toLocaleString(getLang() === "de" ? "de-DE" : "ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  }

