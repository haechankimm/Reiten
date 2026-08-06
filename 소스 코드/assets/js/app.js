/* =========================================================
   REITEN — 공통 스크립트
   ========================================================= */

/* ---------- 유틸 ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = (n) => {
  const num = Number(n || 0);
  return getLang() === "ko"
    ? num.toLocaleString("ko-KR") + "원"
    : "₩" + num.toLocaleString("en-US");
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const qs = (k) => new URLSearchParams(location.search).get(k);
const getProduct = (id) => PRODUCTS.find((p) => p.id === id);
const getCharm = (k) => CHARMS.find((c) => c.key === k);
const getFinish = (k) => FINISHES.find((f) => f.key === k);

let uidSeed = 0;
const uid = () => "u" + Date.now().toString(36) + (uidSeed++).toString(36);

/* =========================================================
   상품 목록 — server/가 떠 있으면 관리자 패널에서 등록·수정한 DB 목록으로
   PRODUCTS 배열 내용을 통째로 교체한다(참조를 유지해야 다른 파일의
   `const PRODUCTS`를 그대로 쓰는 코드가 전부 갱신된 값을 본다).
   서버가 없거나 요청이 실패하면 data.js의 정적 목록이 그대로 남는다.
   ========================================================= */
async function loadProducts() {
  try {
    const res = await fetch("/api/products");
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data)) {
      PRODUCTS.length = 0;
      PRODUCTS.push(...data);
    }
  } catch (e) {}
}

/* 룩북 슬롯 — server/가 떠 있으면 관리자 패널에서 등록·수정한 DB 목록으로
   LOOKBOOK 배열 내용을 통째로 교체한다. 서버가 없거나 요청이 실패하면
   data.js의 정적 목록이 그대로 남는다. */
async function loadLookbook() {
  try {
    const res = await fetch("/api/lookbook");
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data)) {
      LOOKBOOK.length = 0;
      LOOKBOOK.push(...data);
    }
  } catch (e) {}
}

/* =========================================================
   테마 (오프화이트 / 나이트)
   ========================================================= */
const THEME_KEY = "reiten_theme";
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  $$(".js-theme").forEach((b) => b.setAttribute("aria-pressed", String(t === "night")));
}

/* =========================================================
   시동 진동 — 테마 전환 버튼을 누르는 순간, 바이크 시동을 거는 듯한
   느낌으로 화면 전체(<html>)가 아주 짧게 흔들린다.
   1) 크랭크  : 크고 불규칙한 2~3번의 흔들림 (스타터가 엔진을 돌리는 구간)
   2) 캐치·레브: 빠르고 잦은 진동, 진폭이 정점을 찍고 잦아드는 구간 (엔진이 걸리는 순간)
   3) 아이들  : 진폭이 지수적으로 0에 수렴하는 미세 진동 (공회전으로 안정)
   같은 타이밍에 밝기(filter)도 살짝 흔들어 "점화" 되는 느낌을 더한다.
   body에는 이미 --t(0.4s) 컬러 트랜지션이 걸려 있어 팔레트 전환과 함께 재생된다.
   ========================================================= */
const ENGINE_KICK_FRAMES = [
  { transform: "translate(0,0) rotate(0deg)",              filter: "brightness(1)",     offset: 0 },
  { transform: "translate(-3px,1px) rotate(-0.28deg)",      filter: "brightness(0.94)",  offset: 0.06 },
  { transform: "translate(3.2px,-1px) rotate(0.32deg)",     filter: "brightness(1.1)",   offset: 0.13 },
  { transform: "translate(-2.6px,1.2px) rotate(-0.22deg)",  filter: "brightness(0.96)",  offset: 0.19 },
  { transform: "translate(2.2px,-1.4px) rotate(0.24deg)",   filter: "brightness(1.05)",  offset: 0.26 },
  { transform: "translate(-1.6px,1px) rotate(-0.16deg)",    filter: "brightness(0.98)",  offset: 0.34 },
  { transform: "translate(1.2px,-0.8px) rotate(0.12deg)",   filter: "brightness(1.02)",  offset: 0.43 },
  { transform: "translate(-0.8px,0.6px) rotate(-0.08deg)",  filter: "brightness(1)",     offset: 0.55 },
  { transform: "translate(0.5px,-0.4px) rotate(0.05deg)",   filter: "brightness(1)",     offset: 0.68 },
  { transform: "translate(-0.25px,0.2px) rotate(-0.02deg)", filter: "brightness(1)",     offset: 0.82 },
  { transform: "translate(0,0) rotate(0deg)",               filter: "brightness(1)",     offset: 1 },
];

function kickEngine() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!document.documentElement.animate) return;
  document.documentElement.animate(ENGINE_KICK_FRAMES, { duration: 560, easing: "linear" });
}
function initTheme() {
  let t = "light";
  try { t = localStorage.getItem(THEME_KEY) || "light"; } catch (e) {}
  applyTheme(t);
}
initTheme();

/* =========================================================
   장바구니
   ========================================================= */
const CART_KEY = "reiten_cart_v1";

const Cart = {
  read() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
    catch (e) { return []; }
  },
  write(items) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (e) {}
    Cart.paint();
  },
  add(item) {
    const items = Cart.read();
    const same = items.find((i) => i.sig === item.sig);
    if (same) same.qty = Math.min(99, same.qty + item.qty);
    else items.push({ ...item, key: uid() });
    Cart.write(items);
  },
  setQty(key, qty) {
    const items = Cart.read();
    const it = items.find((i) => i.key === key);
    if (!it) return;
    it.qty = Math.max(1, Math.min(99, qty));
    Cart.write(items);
  },
  remove(key) {
    Cart.write(Cart.read().filter((i) => i.key !== key));
  },
  clear() { Cart.write([]); },
  count() { return Cart.read().reduce((s, i) => s + i.qty, 0); },
  subtotal() { return Cart.read().reduce((s, i) => s + i.unit * i.qty, 0); },
  shipping() {
    const sub = Cart.subtotal();
    if (sub === 0) return 0;
    return sub >= SITE.shipping.freeOver ? 0 : SITE.shipping.fee;
  },
  total() { return Cart.subtotal() + Cart.shipping(); },
  paint() {
    const n = Cart.count();
    $$(".js-cart-count").forEach((el) => {
      el.textContent = n;
      el.classList.toggle("on", n > 0);
    });
  },
};

/* =========================================================
   토스트
   ========================================================= */
let toastTimer;
function toast(msg) {
  let el = $(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add("on"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 2600);
}

/* =========================================================
   헤더 / 푸터
   ========================================================= */
const NAV = [
  { href: "shop.html", label: "Shop" },
  { href: "customizer.html", label: "Zip Studio" },
  { href: "lookbook.html", label: "Lookbook" },
  { href: "about.html", label: "About" },
];

function renderHeader(active = "") {
  const links = NAV.map(
    (n) =>
      `<a href="${n.href}"${n.href === active ? ' aria-current="page"' : ""}>${n.label}</a>`
  ).join("");

  const lang = getLang();
  const langMenu = PUBLIC_LANGS.map(
    (l) =>
      `<button type="button" data-lang="${l}" aria-current="${l === lang}">${LANG_LABEL[l]}</button>`
  ).join("");

  document.body.insertAdjacentHTML(
    "afterbegin",
    `
<a class="skip-link" href="#main">${esc(t("본문으로 건너뛰기"))}</a>
<header class="hdr">
  <div class="hdr__in">
    <a class="brand" href="index.html" aria-label="${esc(t("REITEN 홈"))}">
      <img src="assets/img/logo-wordmark.png" alt="REITEN" width="948" height="195">
    </a>
    <nav class="nav" aria-label="${esc(t("주요 메뉴"))}">${links}</nav>
    <div class="hdr__spacer"></div>
    <div class="hdr__tools">
      <div class="lang-wrap">
        <button class="icon-btn js-lang" type="button" aria-haspopup="true" aria-expanded="false" aria-label="${esc(t("언어 선택"))}" title="${esc(t("언어 선택"))}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 4 5.7 4 9s-1.4 6.4-4 9c-2.6-2.6-4-5.7-4-9s1.4-6.4 4-9Z"/></svg>
        </button>
        <div class="lang-menu js-lang-menu" role="menu" hidden>${langMenu}</div>
      </div>
      <button class="icon-btn js-theme toggle-light" type="button" aria-pressed="false" aria-label="${esc(t("야간 주행 모드 전환"))}" title="${esc(t("야간 주행 모드"))}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      </button>
      <a class="icon-btn" href="account.html" aria-label="${esc(t("내 계정"))}" title="${esc(t("내 계정"))}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6"/></svg>
      </a>
      <a class="icon-btn" href="cart.html" aria-label="${esc(t("장바구니"))}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16l-1.3 12.1a2 2 0 0 1-2 1.9H7.3a2 2 0 0 1-2-1.9L4 7Z"/><path d="M9 7V5.5a3 3 0 0 1 6 0V7"/></svg>
        <em class="cart-count js-cart-count" aria-hidden="true">0</em>
      </a>
      <button class="icon-btn burger" type="button" aria-expanded="false" aria-controls="mnav" aria-label="${esc(t("메뉴 열기"))}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </button>
    </div>
  </div>
</header>
<div class="mnav" id="mnav">${NAV.map((n) => `<a href="${n.href}">${n.label}</a>`).join("")}
  <a href="account.html">${esc(t("내 계정"))}</a>
  <a href="cart.html">Cart</a>
</div>`
  );

  const burger = $(".burger");
  const mnav = $("#mnav");
  burger?.addEventListener("click", () => {
    const open = mnav.classList.toggle("open");
    burger.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
  });

  $$(".js-theme").forEach((b) =>
    b.addEventListener("click", () => {
      applyTheme(document.documentElement.dataset.theme === "night" ? "light" : "night");
      kickEngine();
    })
  );

  const langBtn = $(".js-lang");
  const langMenuEl = $(".js-lang-menu");
  langBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = langMenuEl.hasAttribute("hidden");
    if (open) langMenuEl.removeAttribute("hidden");
    else langMenuEl.setAttribute("hidden", "");
    langBtn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", () => {
    langMenuEl?.setAttribute("hidden", "");
    langBtn?.setAttribute("aria-expanded", "false");
  });
  $$(".js-lang-menu button").forEach((b) =>
    b.addEventListener("click", () => setLang(b.dataset.lang))
  );

  Cart.paint();
}

function renderFooter() {
  const b = SITE.biz, o = SITE.order;
  document.body.insertAdjacentHTML(
    "beforeend",
    `
<footer class="ftr">
  <div class="wrap">
    <div class="ftr__top">
      <div class="ftr__logo">
        <img src="assets/img/logo-lockup.png" alt="REITEN" width="956" height="429" style="height:52px;width:auto">
        <p class="small" style="max-width:32ch;margin:0">
          ${t("Reiten — 독일어로 '타다'.<br>말에서 기계로 옮겨 탄 사람들을 위한 옷.")}
        </p>
      </div>
      <div>
        <h4>Shop</h4>
        <ul>
          <li><a href="shop.html">${t("전체 상품")}</a></li>
          <li><a href="shop.html?cat=후드티">${t("후드티")}</a></li>
          <li><a href="shop.html?cat=후드집업">${t("후드집업")}</a></li>
          <li><a href="shop.html?cat=크롭 후드티">${t("크롭 후드티")}</a></li>
          <li><a href="customizer.html">${t("지퍼 참 스튜디오")}</a></li>
          <li><a href="charms.html">${t("참 갤러리")}</a></li>
        </ul>
      </div>
      <div>
        <h4>Brand</h4>
        <ul>
          <li><a href="about.html">${t("브랜드 스토리")}</a></li>
          <li><a href="lookbook.html">${t("룩북 / 라이딩 필름")}</a></li>
          <li><a href="about.html#care">${t("소재 & 관리법")}</a></li>
          <li><a href="about.html#policy">${t("배송 · 교환 안내")}</a></li>
          <li><a href="reviews.html">${t("상품 리뷰")}</a></li>
          <li><a href="qna.html">${t("상품 문의")}</a></li>
          <li><a href="order-lookup.html">${t("주문 조회")}</a></li>
          <li><a href="return-request.html">${t("반품 · 교환 신청")}</a></li>
        </ul>
      </div>
      <div>
        <h4>Contact</h4>
        <ul>
          <li><a href="mailto:${esc(o.email)}">${esc(o.email)}</a></li>
          <li><a href="#">Instagram ${esc(o.instagram)}</a></li>
          <li><span class="small">${esc(o.kakao)}</span></li>
        </ul>
      </div>
    </div>
    <div class="ftr__legal">
      <div>
        ${esc(b.company)} · ${t("대표")} ${esc(b.ceo)}<br>
        ${t("사업자등록번호")} ${esc(b.regNo)} · ${t("통신판매업신고")} ${esc(b.mailOrderNo)}<br>
        ${esc(b.address)} · ${esc(b.tel)} · ${t("개인정보관리책임자")} ${esc(b.privacyOfficer)}
      </div>
      <div>© ${new Date().getFullYear()} REITEN. All rights reserved.</div>
    </div>
  </div>
</footer>`
  );
}

/* =========================================================
   스크롤 리빌
   ========================================================= */
function initReveal() {
  const els = $$("[data-reveal]");
  if (!els.length) return;
  if (!("IntersectionObserver" in window)) {
    els.forEach((e) => e.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (ents) =>
      ents.forEach((e) => {
        if (e.isIntersecting) {
          e.target.style.transitionDelay = (e.target.dataset.reveal || 0) + "ms";
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }),
    { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
  );
  els.forEach((e) => io.observe(e));

  // 안전장치 : 관찰이 어떤 이유로든 동작하지 않아도 콘텐츠는 반드시 보이게 한다
  setTimeout(() => els.forEach((e) => e.classList.add("in")), 1500);
}

/* =========================================================
   리플렉티브 스포트라이트 (마우스 따라다니는 빛)
   ========================================================= */
function initBeams(root = document) {
  $$(".shot, .beamable", root).forEach((shot) => {
    if (shot.dataset.beam) return;
    shot.dataset.beam = "1";
    if (!$(".shot__beam", shot)) {
      shot.insertAdjacentHTML("beforeend", '<i class="shot__beam"></i>');
    }
    shot.addEventListener("pointermove", (e) => {
      const r = shot.getBoundingClientRect();
      shot.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
      shot.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
    });
  });
}

/* =========================================================
   라이더 사이즈 가이드 (보호대 착용 시 권장 사이즈)
   ========================================================= */
function rideGuideHTML(key) {
  const g = PROTECTOR_GUIDE[key];
  if (!g) return "";
  return `
<div class="ride-guide__head">
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"/></svg>
  <span>${esc(t("보호대 착용 시 사이즈 가이드"))}</span>
</div>
<p class="small">${esc(t(g.note))}</p>
<table class="spec">
  <thead><tr>${g.head.map((h) => `<th>${esc(t(h))}</th>`).join("")}</tr></thead>
  <tbody>${g.rows
    .map(
      (r) => `<tr>${r
        .map((c, i) =>
          i === r.length - 1
            ? `<td>${c === "" ? `<span class="tbd">${esc(t("추후 계측"))}</span>` : esc(c)}</td>`
            : `<td>${esc(c)}</td>`
        )
        .join("")}</tr>`
    )
    .join("")}</tbody>
</table>
<p class="small" style="margin-top:10px">${esc(t("가슴단면 여유분은 실제 프로텍터를 착용시켜 계측한 뒤 업데이트될 예정입니다."))}</p>`;
}

/* =========================================================
   상품 카드
   ========================================================= */
function productCard(p, delay = 0) {
  const img = p.images.find(Boolean);
  const name = t(p.nameKo);
  const media = img
    ? `<div class="card__media beamable">
         <img src="${img}" alt="${esc(name)}" loading="lazy">
         ${p.badge ? `<span class="card__badge">${esc(p.badge)}</span>` : ""}
       </div>`
    : `<div class="card__media ph">
         <span class="ph__label">${t("사진 준비중")}</span>
         ${p.badge ? `<span class="card__badge">${esc(p.badge)}</span>` : ""}
       </div>`;

  const dots = p.colors
    .map((c) => `<i class="sw" style="background:${COLORS[c].hex}" title="${esc(t(COLORS[c].label))}"></i>`)
    .join("");

  return `
<a class="card" href="product.html?id=${encodeURIComponent(p.id)}" data-reveal="${delay}">
  ${media}
  <div class="card__body">
    <div class="card__name">${esc(name)}</div>
    <div class="card__sub">${esc(t(p.short))}</div>
    <div class="card__price tnum">${money(p.price)}</div>
    <div class="swatches">${dots}</div>
  </div>
</a>`;
}

/* =========================================================
   참(charm) SVG
   ========================================================= */
function charmSVG(charmKey, finishKey, opts = {}) {
  const c = getCharm(charmKey);
  if (!c || c.key === "none" || !c.paths.length) return "";
  const id = "c" + Math.random().toString(36).slice(2, 8);
  const silver = finishKey === "silver";
  const isColor = finishKey === "color";

  const main = silver ? `url(#g${id})` : isColor ? c.accent : "#1b1b1f";
  const accent = silver ? "#575c62" : isColor ? "#17171b" : "#3a3a40";
  const leaf = isColor ? "#2fae4e" : main;
  const strokeCol = isColor ? "#2fae4e" : main;

  const holes = c.paths.filter((p) => p.role === "hole");
  const body = c.paths
    .filter((p) => p.role !== "hole")
    .map((p) => {
      if (p.role === "stroke")
        return `<path d="${p.d}" fill="none" stroke="${strokeCol}" stroke-width="5" stroke-linecap="round"/>`;
      const f = p.role === "accent" ? accent : p.role === "leaf" ? leaf : main;
      return `<path d="${p.d}" fill="${f}"${p.evenodd ? ' fill-rule="evenodd"' : ""} stroke="${f}" stroke-width="1.2" stroke-linejoin="round"/>`;
    })
    .join("");

  const maskDef = holes.length
    ? `<mask id="m${id}"><rect x="0" y="0" width="100" height="120" fill="#fff"/>${holes
        .map((p) => `<path d="${p.d}" fill="#000"/>`)
        .join("")}</mask>`
    : "";

  const glowClass = silver ? " reflective" : isColor ? " reflective-soft" : "";

  return `
<svg class="charm-svg${glowClass}" viewBox="0 0 100 120" ${opts.attrs || ""} role="img" aria-label="${esc(t("{label} 참", { label: t(c.label) }))}"
  <defs>
    <linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#c3c9cf"/>
      <stop offset="20%" stop-color="#ffffff"/>
      <stop offset="42%" stop-color="#959ba2"/>
      <stop offset="62%" stop-color="#f4f7f9"/>
      <stop offset="84%" stop-color="#8d9299"/>
      <stop offset="100%" stop-color="#d7dbdf"/>
    </linearGradient>
    ${maskDef}
  </defs>
  <g${holes.length ? ` mask="url(#m${id})"` : ""}>${body}</g>
</svg>`;
}

/* =========================================================
   부팅
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  initReveal();
  initBeams();
});
