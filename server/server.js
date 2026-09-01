require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const Sentry = require("@sentry/node");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const cron = require("node-cron");
const { SITE, PRODUCTS: STATIC_PRODUCTS, CHARM_PRICE, EXTRA_PRICE, EXTRAS, COURIERS } = require("../소스 코드/assets/js/data.js");
const { supabaseAdmin } = require("./lib/supabase");
const { requireAuth, optionalAuth, requireAdmin } = require("./lib/auth");
const {
  sendOrderNotification,
  sendCustomerOrderReceived,
  sendCustomerPaymentConfirmed,
  sendCustomerShipped,
  sendAdminLowStock,
  sendAdminRestockAlert,
  sendAdminCardPaid,
  sendCustomerCardPaid,
  sendCustomerAutoCancelled,
  sendAdminCardCancelFailed,
  sendAdminOrderFinalizeFailed,
  sendAdminRefundFailed,
  sendAdminLoginLocked,
  sendAdminSettlementReport,
  sendCustomerOrderCancelled,
  sendCustomerFirstPurchaseThanks,
  sendCustomerRepeatPurchaseThanks,
  sendCustomerRestockNotice,
} = require("./lib/mailer");
const kakao = require("./lib/kakao");
const { orderNo, priceItem, shippingFor } = require("./lib/pricing");
const { resolveCoupon } = require("./lib/coupons");
const { toProductDto } = require("./lib/products");
const { paginationParams } = require("./lib/pagination");
const { toCsv, toXlsxBuffer, toPdfBuffer, toCsvGeneric, toXlsxBufferGeneric, fmtExportDate } = require("./lib/orderExport");
const portone = require("./lib/portone");
const { kstMonthRangeISO, applyKstDateRangeFilter } = require("./lib/kst");
const { restoreItemsFromOrder, findOutOfStockSinceFromLogs } = require("./lib/inventory");
const { logAdminAction, logInventoryChange, logSystemError } = require("./lib/adminLog");
const { writeLimiter } = require("./lib/rateLimiters");
const {
  FIRST_PURCHASE_COUPON_CODE_PREFIX,
  REPEAT_PURCHASE_COUPON_CODE_PREFIX,
  FIRST_PURCHASE_COUPON_SETTING_LABEL,
  REPEAT_PURCHASE_COUPON_THRESHOLD_LABEL,
  REPEAT_PURCHASE_COUPON_PERCENT_LABEL,
} = require("./lib/thanksCoupons");
const { isMissingSchemaError, isMissingColumnError } = require("./lib/pgErrors");
const { normalizeTel } = require("./lib/phone");
/* 아래는 돈·재고를 건드리지 않는 순수 CRUD 라우트 그룹 — server.js 본체에서 분리해
   각자 독립된 Express Router로 관리한다(2026-09-01, 코드 크기 정리 1·2단계). 결제·주문·재고·
   반품환불처럼 실제 돈이 걸린 라우트는 아직 이 파일에 그대로 남아있다 — README 0번 섹션
   "server.js 라우트 분리" 참고. */
const settingsRoutes = require("./routes/settings");
const lookbookRoutes = require("./routes/lookbook");
const colorsRoutes = require("./routes/colors");
const qnaRoutes = require("./routes/qna");
const healthRoutes = require("./routes/health");
const adminsRoutes = require("./routes/admins");
const membersRoutes = require("./routes/members");
const dashboardRoutes = require("./routes/dashboard");
const productsRoutes = require("./routes/products");
const reviewsRoutes = require("./routes/reviews");
const restockRoutes = require("./routes/restock");
const pushRoutes = require("./routes/push");
const { sendPushToAdmins } = require("./lib/push");

/* SENTRY_DSN이 없으면 아무 것도 하지 않고 조용히 건너뛴다(로컬 개발 환경 포함) —
   README 02번 "에러를 관리자가 아니라 고객이 먼저 발견하는 구조"를 메우기 위한 최소 계측. */
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0 });
}
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
  Sentry.captureException(err);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  Sentry.captureException(err);
});

const PORT = process.env.PORT || 3000;
const SITE_DIR = path.join(__dirname, "..", "소스 코드");
const WORKS_DIR = path.join(__dirname, "..", "works");

const app = express();

/* Render/Railway 등은 자체 프록시를 한 단계 거쳐 요청을 전달한다.
   이 설정이 없으면 express-rate-limit이 모든 방문자를 프록시의 IP 하나로 착각해
   한 명이 많이 요청하면 전체 방문자가 같이 차단될 수 있다. 로컬 직접 실행 시에는 영향 없음. */
app.set("trust proxy", 1);

/* CSP — 빌드 도구 없는 정적 사이트라 인라인 <script>/<style>에 크게 의존하므로 'unsafe-inline'을
   허용한다(nonce 기반으로 바꾸려면 전 페이지에 빌드 단계가 필요해져 지금 구조와 안 맞음).
   완벽한 XSS 차단은 아니지만, 그래도 아래 두 가지는 확실히 막는다: ① 스크립트가 주입되더라도
   여기 허용목록에 없는 임의의 외부 도메인으로 데이터를 빼돌리는 것(connect-src/img-src) ②
   <object>/<embed> 삽입. 실제 쓰는 외부 도메인만 최소로 나열 — GA4(googletagmanager/
   google-analytics), 채널톡(channel.io), 포트원 결제 SDK(portone.io), Pretendard 폰트
   (jsDelivr), 다음 우편번호 검색(daumcdn), Cloudinary(상품 사진), Supabase(로그인·API).
   카카오 로그인(Supabase OAuth 리다이렉트)·포트원 카드 인증 팝업은 전부 새 창/최상위 이동이라
   CSP 대상이 아님. */
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://www.googletagmanager.com",
          "https://cdn.channel.io",
          "https://cdn.portone.io",
          "https://cdn.jsdelivr.net",
          "https://t1.daumcdn.net",
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdn.channel.io"],
        fontSrc: ["'self'", "data:", "https://cdn.jsdelivr.net", "https://cdn.channel.io"],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://res.cloudinary.com",
          "https://www.google-analytics.com",
          "https://*.google-analytics.com",
          "https://*.channel.io",
          "https://*.kakaocdn.net",
        ],
        connectSrc: [
          "'self'",
          "https://*.supabase.co",
          "wss://*.supabase.co",
          "https://www.google-analytics.com",
          "https://*.google-analytics.com",
          "https://*.analytics.google.com",
          "https://*.channel.io",
          "wss://*.channel.io",
          "https://*.portone.io",
          "https://t1.daumcdn.net",
        ],
        frameSrc: ["https://*.channel.io"],
        mediaSrc: ["'self'", "https://*.channel.io"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  })
);

// 전체 API 남용 방지 (기본): IP당 15분에 300회
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

// writeLimiter(쓰기·조회 남용 방지, IP당 15분 20회)는 lib/rateLimiters.js에서 가져온다 —
// routes/qna.js 등 분리된 라우트 파일과 반드시 같은 인스턴스를 써야 카운터가 안 나뉜다.

/* 포트원 웹훅은 서명 검증에 "파싱 전 원본 문자열"이 필요해서, 이 라우트만 아래
   express.json()보다 먼저 등록해 그 미들웨어를 타지 않게 한다(등록 순서대로 매칭되는 Express 특성 이용).
   finalizeCardOrder는 파일 아래쪽에 있지만 function 선언이라 호이스팅되어 여기서도 바로 쓸 수 있다.
   결제 완료를 알려주는 이 웹훅은 /api/order(카드 분기)가 이미 검증→주문 생성을 처리하는 것과 별개로,
   고객이 결제 직후 브라우저를 닫아버려 그 확인 요청이 서버에 닿지 못하는 경우를 위한 보조 경로다.
   orders.payment_id로 이미 처리된 건인지 먼저 확인해서 멱등하게 동작한다(포트원이 같은 웹훅을
   여러 번 재전송해도 주문이 중복 생성되지 않음). */
app.post("/api/payments/webhook", express.text({ type: "*/*" }), async (req, res) => {
  if (!portone.isConfigured()) return res.status(503).end();

  let webhook;
  try {
    webhook = await portone.verifyWebhook(req.body, req.headers);
  } catch (e) {
    console.error("[payments/webhook] 서명 검증 실패:", e.message);
    return res.status(400).end();
  }

  if (webhook.type !== "Transaction.Paid") {
    return res.status(200).end();
  }

  const { paymentId } = webhook.data;

  const { data: existingOrder } = await supabaseAdmin.from("orders").select("order_no").eq("payment_id", paymentId).maybeSingle();
  if (existingOrder) return res.status(200).end(); // /api/order 쪽에서 이미 처리됨

  const { data: pending } = await supabaseAdmin.from("pending_payments").select("*").eq("payment_id", paymentId).maybeSingle();
  if (!pending) return res.status(200).end(); // 알 수 없는 결제 건이거나 이미 소비됨

  let verified;
  try {
    verified = await portone.getVerifiedPayment(paymentId);
  } catch (e) {
    console.error("[payments/webhook] 결제 조회 실패:", e.message);
    return res.status(500).end(); // 포트원이 재시도하도록 5xx로 응답
  }
  if (verified.status !== "PAID" || verified.amount.total !== pending.total) {
    console.error("[payments/webhook] 금액/상태 불일치:", paymentId);
    return res.status(200).end(); // 재시도해도 결과가 같으므로 200으로 끝내 재전송을 막는다
  }

  const result = await finalizeCardOrder({ pending, paymentId, userId: null });
  res.status(result.ok ? 200 : result.status).end();
});

app.use(express.json());

/* works.reiten.kr로 들어온 요청은 관리자 전용 정적 사이트(works/)를 먼저 찾는다.
   express.static은 파일을 못 찾으면 그냥 next()로 넘어가므로, works/에 없는 assets/*
   요청은 아래의 SITE_DIR static으로 자연스럽게 이어져 이미지·CSS·공용 JS를 공유한다
   (사이트별로 중복 보관하지 않음). API·인증·DB는 완전히 동일한 이 서버 인스턴스를 쓴다.
   works.localhost는 로컬 개발 전용 별칭이다(.localhost는 브라우저가 별도 설정 없이 항상
   127.0.0.1로 처리하는 예약 도메인이라 실제 인터넷에서는 접근 자체가 불가능함) — 예전엔
   `/__works-preview`라는 별도 경로로 로컬 미리보기를 우회했었는데, 그 경로는 프로덕션에서도
   인증 없이 그대로 열려 있어(works.reiten.kr 분기와 무관하게 항상 마운트돼 있었음) 관리자
   패널 화면이 누구에게나 노출되는 불필요한 표면이었다(실제 데이터 API는 여전히 requireAdmin이
   막지만, UI 셸 자체가 열리는 것만으로도 줄일 수 있는 노출). 2026-09-01, 이 분기 하나로 통합해
   프로덕션 노출은 없애고 로컬에서는 실제 호스트네임 분기 로직을 그대로 검증하도록 정리함
   (http://works.localhost:3000 으로 접속하면 됨). */
app.use((req, res, next) => {
  if (req.hostname === "works.reiten.kr" || req.hostname === "works.localhost") {
    return express.static(WORKS_DIR)(req, res, next);
  }
  next();
});

function escapeHtmlAttr(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* 카카오톡·페이스북 링크 카드는 가로 1.91:1(1200x630) 기준으로 미리보기를 만든다. 상품 사진은
   세로 4:5라 그대로 쓰면 위아래가 어색하게 잘린다 — Cloudinary의 c_fill,g_auto로 가로 1200x630에
   맞춰 미리 잘라서 내려준다. g_auto는 사진에서 시선이 가는 영역(그래픽·인물 등)을 자동으로 찾아
   그 부분이 잘리지 않도록 크롭 위치를 잡아주는 옵션이라, 그냥 가운데를 자르는 것보다 안전하다. */
function cloudinaryOgImage(url) {
  if (!url || !url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  return url.replace("/upload/", "/upload/c_fill,g_auto,w_1200,h_630,q_auto,f_auto/");
}

/* product.html은 순수 정적 파일(내용은 브라우저에서 JS가 채운다) — 그래서 og:title/og:image를
   JS로 아무리 잘 넣어도, 카카오톡·페이스북 같은 링크 미리보기 봇에는 전혀 반영되지 않는다.
   그 봇들은 JS를 실행하지 않고 서버가 응답한 raw HTML만 그대로 읽기 때문이다("함께 보면 좋은 것"
   추천처럼 화면에 보이는 것과, 크롤러가 보는 것은 다른 문제). express.static보다 먼저 이 라우트를
   등록해 GET /product.html?id=... 요청만 가로채서 <head>의 title·description·og 태그를 실제
   상품 정보로 바꿔치기한 뒤 돌려주고, id가 없거나 상품을 못 찾으면 next()로 넘겨 평소처럼
   정적 파일이 그대로 나가게 한다. */
app.get("/product.html", async (req, res, next) => {
  const id = req.query.id;
  if (!id) return next();

  let product;
  try {
    const products = await getActiveProducts();
    product = products.find((p) => p.id === id);
  } catch (e) {
    return next();
  }
  if (!product) return next();

  let html;
  try {
    html = await fs.promises.readFile(path.join(SITE_DIR, "product.html"), "utf8");
  } catch (e) {
    return next();
  }

  const title = `${product.nameKo} — REITEN`;
  const description = String(product.short || product.desc || "").slice(0, 150);
  const image = (product.images || []).find(Boolean);
  const imageUrl = image
    ? cloudinaryOgImage(new URL(image, `${req.protocol}://${req.get("host")}`).href)
    : "https://reiten.kr/assets/img/og-image.png";
  const pageUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

  const metaTags = [
    `<meta property="og:title" content="${escapeHtmlAttr(title)}">`,
    `<meta property="og:description" content="${escapeHtmlAttr(description)}">`,
    `<meta property="og:type" content="product">`,
    `<meta property="og:url" content="${escapeHtmlAttr(pageUrl)}">`,
    `<meta property="og:image" content="${escapeHtmlAttr(imageUrl)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join("\n");

  html = html
    .replace(/<title>.*?<\/title>/, `<title>${escapeHtmlAttr(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtmlAttr(description)}">`)
    .replace("</head>", `${metaTags}\n</head>`);

  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.use(
  express.static(SITE_DIR, {
    setHeaders: (res, filePath) => {
      // 제품 사진은 파일명이 안 바뀌므로 7일 캐시. HTML/CSS/JS는 재배포 시 즉시 반영되도록 캐시하지 않는다.
      if (filePath.includes(`${path.sep}img${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=604800, immutable");
      }
    },
  })
);

/* ---------- 상품 (products 테이블 — 관리자 패널에서 추가·수정·삭제) ----------
   data.js의 정적 PRODUCTS는 마이그레이션 004를 실행하지 않은 서버나 조회 실패 시의 폴백으로만 쓰인다.
   toProductDto/productPatchFromBody는 ./lib/products.js로, priceItem/shippingFor/orderNo는
   ./lib/pricing.js로 분리해 Supabase 없이도 단위 테스트할 수 있게 했다(server/test/ 참고). */

/* GET /api/products가 로그인 없이 아무나 부를 수 있는 공개 API인데, 호출될 때마다 products
   전체 + inventory 전체(withRealSoldOut)를 매번 다시 읽고 있었다 — 방문자가 늘어나거나
   상품·컬러 수가 늘어나면 이 두 쿼리가 트래픽에 정비례해서 늘어나는 구조. 15초 TTL 메모리
   캐시로 감싸서, 15초 동안 아무리 많이 방문해도 실제 DB 조회는 최대 1번만 나가게 한다.
   품절 표시가 최대 15초 늦게 반영될 수 있지만(실제 결제 시점엔 decrement_inventory가 항상
   실시간으로 재검증하므로 판매 정합성엔 영향 없음), 이 정도 지연은 상품 목록 화면에서
   체감되지 않는 수준이라 감수한다. 캐시는 이 프로세스 메모리에만 있어 재배포하면 초기화됨. */
const PRODUCTS_CACHE_TTL_MS = 15000;
let productsCache = { data: null, at: 0 };

async function getActiveProducts() {
  if (productsCache.data && Date.now() - productsCache.at < PRODUCTS_CACHE_TTL_MS) {
    return productsCache.data;
  }
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[products] DB 조회 실패, 정적 목록으로 폴백:", error.message);
    return STATIC_PRODUCTS;
  }
  const { products: result, degraded } = await withRealSoldOut(data.map(toProductDto));
  /* 재고 조회가 실패해 품절 정보가 부정확한 상태(degraded)로는 캐시에 쓰지 않는다 — 그대로
     캐시하면 일시적인 DB 오류 한 번이 실제로는 재고 조회 자체가 복구된 뒤에도 남은 15초
     동안 "품절 정보 없음" 상태를 그대로 밀어붙이게 된다. 캐시를 안 쓰면 바로 다음 요청이
     새로 시도해서 이 창이 넓어지지 않는다(2026-09-01 코드 감사에서 발견). */
  if (!degraded) productsCache = { data: result, at: Date.now() };
  return result;
}

/* 관리자가 손으로 체크하는 soldOut 배열(상품.sizes 전체에 적용 — "이 사이즈는 어느 컬러든 안 판다")과
   실제 결제 시 차감되는 inventory 테이블(product_id + color + size, 014_inventory_by_color.sql)이
   서로 다른 값을 가질 수 있다(주문으로 실재고가 0이 돼도 관리자가 체크박스를 갱신하기 전까지는
   반영 안 됨, 또는 행 자체가 아직 없어 항상 재고 0으로 취급됨). 고객 화면에 내려줄 때는 컬러별
   실재고 0(또는 행 없음)인 사이즈를 outOfStockByColor로 따로 계산해 붙여준다 — soldOut은 그대로
   두고(전체 컬러 공통 품절), 특정 컬러만 재고가 없는 경우는 product.html이 "지금 고른 컬러"에
   한해 그 사이즈를 막는 데 이 필드를 쓴다. */
async function withRealSoldOut(products) {
  if (!products.length) return { products, degraded: false };
  const ids = products.map((p) => p.id);
  const { data, error } = await supabaseAdmin.from("inventory").select("product_id, color, size, qty").in("product_id", ids);
  if (error) {
    console.error("[products] 재고 조회 실패, 관리자가 입력한 품절 정보만 사용:", error.message);
    return { products, degraded: true };
  }
  const qtyByProduct = new Map();
  for (const row of data) {
    if (!qtyByProduct.has(row.product_id)) qtyByProduct.set(row.product_id, new Map());
    qtyByProduct.get(row.product_id).set(`${row.color}:${row.size}`, row.qty);
  }
  const withStock = products.map((p) => {
    const qtyByColorSize = qtyByProduct.get(p.id);
    const outOfStockByColor = {};
    for (const color of p.colors || []) {
      const outSizes = (p.sizes || []).filter((size) => {
        const qty = qtyByColorSize ? qtyByColorSize.get(`${color}:${size}`) : undefined;
        return (qty ?? 0) <= 0;
      });
      if (outSizes.length) outOfStockByColor[color] = outSizes;
    }
    return { ...p, outOfStockByColor };
  });
  return { products: withStock, degraded: false };
}

app.get("/api/products", async (req, res) => {
  res.json(await getActiveProducts());
});

const REQUIRED_CUSTOMER_FIELDS = ["name", "tel", "email", "zip", "addr", "payer"];
const PRICE_OPTS = { extras: EXTRAS, charmPrice: CHARM_PRICE, extraPrice: EXTRA_PRICE };
const ORDER_DEVICE_TYPES = ["mobile", "tablet", "desktop"];

/* 무통장입금(/api/order)과 카드결제 준비(/api/payments/prepare)가 "장바구니를 검증하고 가격을
   다시 계산한다"는 부분만큼은 완전히 같은 로직이었는데 그동안 두 곳에 따로 복붙돼 있었다 —
   가격 정책을 바꿀 때 한쪽만 고치고 다른 쪽을 놓치기 쉬운 지점이라 하나로 합친다. 이 함수는
   DB에 아무것도 쓰지 않고(coupon 조회만 함) 검증된 값 또는 에러만 돌려주므로, 호출부가
   재고 차감·저장 같은 각자의 나머지 절차를 이어서 하면 된다. */
async function validateAndPriceOrder(body, products) {
  const { customer, items: rawItems, couponCode, device } = body || {};
  if (!customer || typeof customer !== "object") {
    return { error: { status: 400, body: { error: "customer 정보가 없습니다." } } };
  }
  const missing = REQUIRED_CUSTOMER_FIELDS.filter((f) => !String(customer[f] || "").trim());
  if (missing.length) {
    return { error: { status: 400, body: { error: `필수 항목이 비었습니다: ${missing.join(", ")}` } } };
  }
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return { error: { status: 400, body: { error: "장바구니 항목이 없습니다." } } };
  }

  const items = rawItems.map((raw) => priceItem(raw, products, PRICE_OPTS));
  if (items.some((it) => it === null)) {
    return { error: { status: 400, body: { error: "존재하지 않는 상품·참(charm) 또는 잘못된 수량이 포함되어 있습니다." } } };
  }

  const subtotal = items.reduce((s, it) => s + it.sum, 0);
  const shipping = shippingFor(subtotal, SITE.shipping);

  let coupon;
  try {
    coupon = await resolveCoupon(supabaseAdmin, couponCode, { rawItems, items, subtotal });
  } catch (e) {
    return { error: { status: e.status || 400, body: { error: e.message } } };
  }

  const total = subtotal - coupon.discount + shipping;
  return {
    rawItems,
    items,
    subtotal,
    shipping,
    coupon,
    total,
    device: ORDER_DEVICE_TYPES.includes(device) ? device : "unknown",
  };
}

/* ---------- 카드결제(포트원) ----------
   결제창을 열기 전에 서버가 먼저 금액을 계산해서 pending_payments에 저장해두고, 그 값 그대로
   결제창에 넘긴다(사전검증) — 브라우저에서 금액을 조작해도 결제창에 표시되는 금액 자체가
   서버 계산값이라 소용없다. 결제가 끝나면 /api/order가 paymentId로 다시 포트원에 물어봐서
   실제로 그 금액만큼 결제됐는지 확인한 뒤에만 주문을 만든다(사후검증, 009_card_payments.sql 참고). */
app.post("/api/payments/prepare", writeLimiter, async (req, res) => {
  if (!portone.isConfigured()) {
    return res.status(503).json({ error: "카드결제가 아직 준비되지 않았습니다." });
  }

  const products = await getActiveProducts();
  const priced = await validateAndPriceOrder(req.body, products);
  if (priced.error) return res.status(priced.error.status).json(priced.error.body);
  const { rawItems, items, subtotal, shipping, coupon, total, device } = priced;
  const { customer } = req.body;

  /* "reiten-" 접두어를 붙이면 43자가 되는데, NHN KCP V2 라이브 채널로 전환한 뒤 실제 결제를
     시도해보니 "KCP V2의 경우 주문 번호는 최대 40자를 넘을 수 없습니다"로 결제창 자체가 안
     열렸다(포트원 테스트 채널에서는 이 제약이 걸리지 않아 여태 못 보고 넘어갔던 문제).
     UUID만 쓰면 36자라 여유 있게 들어간다. */
  const paymentId = crypto.randomUUID();
  const normalizedCustomer = {
    name: String(customer.name).trim(),
    tel: String(customer.tel).trim(),
    email: String(customer.email).trim(),
    zip: String(customer.zip).trim(),
    addr: String(customer.addr).trim(),
    addr2: String(customer.addr2 || "").trim(),
    memo: String(customer.memo || "").trim(),
    payer: String(customer.payer).trim(),
  };

  const { error } = await insertOrderRow("pending_payments", {
    payment_id: paymentId,
    customer: normalizedCustomer,
    raw_items: rawItems,
    items,
    subtotal,
    shipping,
    total,
    coupon_code: coupon.code,
    discount: coupon.discount,
    device,
  });
  if (error) {
    console.error("[payments/prepare] 저장 실패:", error.message);
    return res.status(500).json({ error: "결제 준비에 실패했습니다." });
  }

  // 결제창을 열어놓고 이탈한 오래된(24시간 지난) 시도는 다음 요청 때 조용히 정리한다(별도 크론 불필요).
  supabaseAdmin
    .from("pending_payments")
    .delete()
    .lt("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .then(() => {});

  const orderName = items.length > 1 ? `${items[0].name} 외 ${items.length - 1}건` : items[0].name;
  res.json({
    paymentId,
    totalAmount: total,
    orderName,
    storeId: process.env.PORTONE_STORE_ID,
    channelKey: process.env.PORTONE_CHANNEL_KEY,
    customer: { fullName: normalizedCustomer.name, phoneNumber: normalizedCustomer.tel, email: normalizedCustomer.email },
  });
});

/* orders/pending_payments에 device(기기 종류, 022_order_device.sql)를 넣어 insert하되,
   마이그레이션이 아직 안 돌아서 컬럼이 없으면(PGRST204) device 없이 한 번 더 시도한다.
   기기 정보는 부가 통계용일 뿐이라 이것 때문에 주문·결제 생성 자체(핵심 기능)가 막히면
   절대 안 된다 — reviews.order_no와 같은 원칙(위 리뷰 실구매 인증 참고). */
async function insertOrderRow(table, row, { returning = false } = {}) {
  const run = (r) => {
    const q = supabaseAdmin.from(table).insert(r);
    return returning ? q.select().single() : q;
  };
  let result = await run(row);
  if (isMissingColumnError(result.error) && "device" in row) {
    console.warn(`[${table}] 'device' 컬럼 없음(마이그레이션 022 미실행) — device 없이 재시도`);
    const { device, ...rest } = row;
    result = await run(rest);
  }
  return result;
}

/* 결제 취소 시도 헬퍼 — 성공/실패 여부만 boolean으로 돌려주고, 실패 시 로그만 남긴다(호출부가
   결제취소 실패까지 감안해서 관리자 알림·시스템 오류 로그를 남기므로 여기서는 안 던짐). */
async function tryCancelCardPayment(paymentId, reason) {
  try {
    await portone.cancelPayment(paymentId, reason);
    return true;
  } catch (e) {
    console.error(`[order] ⚠️ ${reason} — 결제 자동 취소 실패:`, paymentId, e.message);
    return false;
  }
}

/* 020_order_seq.sql의 Postgres 시퀀스에서 절대 겹치지 않는 정수를 받아온다 — 실패하면(마이그레이션
   미실행 등) undefined를 반환해 orderNo()가 예전 방식(임의 4자리)으로 조용히 폴백하게 한다. */
async function nextOrderSeq() {
  const { data, error } = await supabaseAdmin.rpc("next_order_seq");
  if (error) {
    console.error("[order] 주문번호 시퀀스 발급 실패, 임의값으로 폴백:", error.message);
    return undefined;
  }
  return Number(data);
}

/* 재고 차감 + 품절 감지 + 재고 이력 기록 — 무통장입금(/api/order)과 카드결제(finalizeCardOrder)가
   거의 그대로 복붙해 두고 있던 부분을 하나로 묶었다. 결제를 이미 받았는지(카드결제만 해당—실패
   시 결제 취소가 필요함)는 호출부마다 달라서 그 판단은 그대로 각 호출부에 남겨두고, 여기서는
   "차감이 됐는지, 안 됐다면 왜인지"만 돌려준다. */
async function decrementInventoryForItems(inventoryItems, products, ref) {
  const { error: invError } = await supabaseAdmin.rpc("decrement_inventory", { p_items: inventoryItems });
  if (invError) {
    const m = /OUT_OF_STOCK:([^:]+):([^:]*):(.+)/.exec(invError.message || "");
    if (m) {
      const [, productId, color, size] = m;
      const product = products.find((p) => p.id === productId);
      return { ok: false, outOfStock: { productId, color, size, name: product ? product.nameKo : productId } };
    }
    return { ok: false, dbError: invError.message };
  }

  logInventoryChange(
    inventoryItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: -it.qty, reason: "order", ref }))
  );

  /* 방금 차감한 조합 중 재고가 0이 된 게 있으면 관리자에게 알린다.
     inventoryItems에 없는 다른 컬러·사이즈까지 걸리지 않도록 정확히 같은 (productId, color, size) 쌍만 추린다. */
  const productIds = [...new Set(inventoryItems.map((it) => it.productId))];
  const sizes = [...new Set(inventoryItems.map((it) => it.size))];
  const { data: stockRows } = await supabaseAdmin
    .from("inventory")
    .select("product_id, color, size, qty")
    .in("product_id", productIds)
    .in("size", sizes);
  const zeroed = (stockRows || [])
    .filter((row) => row.qty <= 0 && inventoryItems.some((it) => it.productId === row.product_id && it.color === row.color && it.size === row.size))
    .map((row) => ({ name: products.find((p) => p.id === row.product_id)?.nameKo || row.product_id, size: row.size }));
  if (zeroed.length) {
    sendAdminLowStock(zeroed).catch((err) => console.error("[mailer] 재고 소진 알림 메일 발송 실패:", err.message));
  }

  return { ok: true };
}

/* /api/order(카드결제 분기)와 웹훅(/api/payments/webhook) 양쪽에서 똑같이 필요한 "결제 확인 후
   주문 확정" 로직 — 재고 차감, 주문 저장, 알림 메일까지 한 번에 처리한다. 두 곳에 각각 복붙하면
   나중에 한쪽만 고치고 다른 쪽을 놓치기 쉬운, 돈이 걸린 로직이라 함수로 묶어 하나만 유지한다.
   실패해도 예외를 던지지 않고 { ok:false, status, body }로 반환한다(호출부가 그대로 res에 흘려보냄). */
async function finalizeCardOrder({ pending, paymentId, userId }) {
  const products = await getActiveProducts();
  const { customer, items, raw_items: rawItems, subtotal, shipping, total, coupon_code: couponCode, discount, device } = pending;
  const orderNumber = orderNo(await nextOrderSeq());

  const inventoryItems = [];
  rawItems.forEach((raw, i) => {
    if (
      typeof raw.productId === "string" &&
      !raw.productId.startsWith("charm-") &&
      typeof raw.size === "string" &&
      raw.size
    ) {
      inventoryItems.push({ productId: raw.productId, color: raw.color || "", size: raw.size, qty: items[i].qty });
    }
  });

  if (inventoryItems.length) {
    const decResult = await decrementInventoryForItems(inventoryItems, products, orderNumber);
    if (!decResult.ok) {
      if (decResult.outOfStock) {
        const { productId, color, size, name } = decResult.outOfStock;
        /* 카드결제는 이 시점에 이미 돈을 받은 상태다 — 재고가 없어 주문을 못 만든다면
           반드시 결제를 취소해서 "결제는 됐는데 주문은 없는" 상태를 만들지 않는다.
           그 취소마저 실패하면(이중 실패) 서버 로그만으로는 관리자가 놓치기 쉬워 즉시 메일을 보낸다. */
        try {
          await portone.cancelPayment(paymentId, "재고 부족으로 자동 취소");
        } catch (cancelErr) {
          console.error("[order] ⚠️ 재고 부족으로 인한 결제 자동 취소 실패 — 수동 확인 필요:", paymentId, cancelErr.message);
          sendAdminCardCancelFailed({ paymentId, productId, size, cancelError: cancelErr.message }).catch((err) =>
            console.error("[mailer] 결제취소 실패 긴급 알림 메일 발송 실패:", err.message)
          );
          logSystemError("card_cancel_failed", { paymentId, productId, size, error: cancelErr.message });
        }
        return { ok: false, status: 409, body: { error: "OUT_OF_STOCK", productId, color, size, name } };
      }
      /* 재고부족(위 OUT_OF_STOCK)이 아닌 다른 이유(DB 오류 등)로 재고 차감 자체가 실패한
         경우도 카드결제는 이미 승인된 뒤라 결제만 그대로 남는 사고가 나던 부분 — 위
         OUT_OF_STOCK 분기와 같은 원칙으로 결제를 취소하고 관리자에게 알린다. */
      console.error("[order] 재고 차감 실패:", decResult.dbError);
      const cancelled = await tryCancelCardPayment(paymentId, "재고 차감 오류로 자동 취소");
      sendAdminOrderFinalizeFailed({ paymentId, stage: "재고 차감", reason: decResult.dbError, paymentCancelled: cancelled }).catch((err) =>
        console.error("[mailer] 주문 확정 실패 긴급 알림 메일 발송 실패:", err.message)
      );
      logSystemError("order_finalize_failed", { paymentId, stage: "inventory_decrement", error: decResult.dbError, paymentCancelled: cancelled });
      return { ok: false, status: 500, body: { error: "재고 확인 중 오류가 발생했습니다." } };
    }
  }

  /* 반품 시 재고를 복원하려면 어떤 상품·사이즈·컬러를 얼마나 샀는지가 주문 레코드 자체에 남아있어야
     한다 — items(name/options/qty/unit/sum)에는 원래 productId가 없어서 나중엔 알 수 없었다.
     rawItems와 순서가 그대로 대응되므로 그대로 붙여서 저장한다. */
  const itemsForStorage = items.map((it, i) => ({ ...it, productId: rawItems[i].productId, size: rawItems[i].size || null, color: rawItems[i].color || null }));

  const { data: saved, error: saveError } = await insertOrderRow(
    "orders",
    {
      order_no: orderNumber,
      user_id: userId,
      customer,
      items: itemsForStorage,
      device: device || "unknown",
      subtotal,
      shipping,
      total,
      coupon_code: couponCode || null,
      discount: discount || 0,
      payment_method: "card",
      payment_id: paymentId,
      status: "입금확인",
    },
    { returning: true }
  );

  if (saveError) {
    if (saveError.code === "23505") {
      /* 경쟁 상태: 포트원 웹훅(/api/payments/webhook)과 결제 직후 프론트엔드 확인 요청(/api/order)이
         거의 동시에 도착하면 둘 다 "아직 주문 없음" 확인을 통과해 각자 재고를 차감하고 저장을
         시도할 수 있다. 이 경우 payment_id 유니크 제약(009_card_payments.sql)에 걸려 나중에
         도착한 쪽만 여기로 온다 — 결제 자체는 먼저 도착한 쪽이 이미 정상 처리했으므로, 이 쪽은
         자신이 중복으로 차감한 재고만 되돌리고 먼저 성공한 주문을 그대로 반환한다. 결제를
         취소하면 정상 결제·주문이 취소되는 사고로 이어지므로 여기서는 절대 취소하지 않는다. */
      console.warn("[order] 주문 저장 중복(경쟁 상태) — 기존 주문으로 대체:", paymentId);
      if (inventoryItems.length) {
        const { error: restoreError } = await supabaseAdmin.rpc("restore_inventory", { p_items: inventoryItems });
        if (restoreError) {
          console.error("[order] ⚠️ 중복 저장 정리 중 재고 복원 실패 — 수동 확인 필요:", paymentId, restoreError.message);
        } else {
          logInventoryChange(
            inventoryItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: it.qty, reason: "order_finalize_duplicate", ref: paymentId }))
          );
        }
      }
      const { data: existing } = await supabaseAdmin.from("orders").select("*").eq("payment_id", paymentId).maybeSingle();
      if (existing) return { ok: true, saved: existing };
      /* 유니크 위반인데 아직 다른 트랜잭션의 행이 안 보이는 극히 드문 복제 지연 케이스 —
         결제는 취소하지 않고(다른 트랜잭션이 곧 성공했을 가능성이 큼) 관리자에게만 남긴다. */
      logSystemError("order_finalize_duplicate_not_found", { paymentId });
      return { ok: false, status: 500, body: { error: "주문 처리 중입니다. 잠시 후 주문 조회에서 확인해 주세요." } };
    }

    /* 여기까지 오는 동안 재고는 이미 차감됐고 결제도 이미 승인된 상태다(주문번호 충돌 —
       020_order_seq.sql로 사실상 불가능해졌지만 — 이나 그 밖의 일시적 DB 오류로 저장만
       실패할 수 있음). 재고를 되돌리고 결제도 취소해서 "결제·재고차감은 됐는데 주문 기록이
       없는" 상태로 남지 않게 한다. */
    console.error("[order] 주문 저장 실패:", saveError.message);
    if (inventoryItems.length) {
      const { error: restoreError } = await supabaseAdmin.rpc("restore_inventory", { p_items: inventoryItems });
      if (restoreError) {
        console.error("[order] ⚠️ 주문 저장 실패 후 재고 복원도 실패 — 수동 확인 필요:", paymentId, restoreError.message);
      } else {
        logInventoryChange(
          inventoryItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: it.qty, reason: "order_finalize_failed", ref: paymentId }))
        );
      }
    }
    const cancelled = await tryCancelCardPayment(paymentId, "주문 저장 오류로 자동 취소");
    sendAdminOrderFinalizeFailed({ paymentId, stage: "주문 저장", reason: saveError.message, paymentCancelled: cancelled }).catch((err) =>
      console.error("[mailer] 주문 확정 실패 긴급 알림 메일 발송 실패:", err.message)
    );
    logSystemError("order_finalize_failed", { paymentId, stage: "order_save", error: saveError.message, paymentCancelled: cancelled });
    return { ok: false, status: 500, body: { error: "주문 저장에 실패했습니다." } };
  }

  await supabaseAdmin.from("pending_payments").delete().eq("payment_id", paymentId);

  sendAdminCardPaid(saved).catch((err) => console.error("[mailer] 카드결제 관리자 알림 메일 발송 실패:", err.message));
  sendCustomerCardPaid(saved).catch((err) => console.error("[mailer] 카드결제 완료 메일 발송 실패:", err.message));
  kakao.sendAlimtalk("CARD_PAID", customer.tel, { name: customer.name, orderNo: saved.order_no }).catch(() => {});
  sendPushToAdmins({ title: "새 주문 접수", body: `${saved.order_no} · 카드결제 완료`, tab: "orders" }).catch((err) =>
    console.error("[push] 알림 발송 실패:", err.message)
  );
  issueThanksCouponsIfEligible(saved).catch((err) => console.error("[thanks-coupon] 처리 실패:", err.message));

  return { ok: true, saved };
}

/* 고객 전용 1회용 감사 쿠폰(THANKS-/LOYAL- 접두사)에 공통으로 쓰는 고유 코드 생성 — 첫 구매·
   재구매 감사 쿠폰 둘 다 같은 규칙(접두사+무작위 6자리 hex, 충돌 시 최대 5회 재시도)이라
   하나로 뽑았다(재고 차감 로직을 통합했던 것과 같은 원칙 — 위 운영 규칙 2번 참고). */
async function generateUniqueCouponCode(prefix) {
  for (let i = 0; i < 5; i++) {
    const candidate = `${prefix}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const { data: exists } = await supabaseAdmin.from("coupons").select("code").eq("code", candidate).maybeSingle();
    if (!exists) return candidate;
  }
  return null;
}

/* 첫 구매/재구매 감사 쿠폰이 "이 고객이 이 마일스톤(첫 구매, 5번째 구매 등)에 도달했다"는
   판정을 두 번 하지 않도록 원자적으로 선점한다(028_coupon_milestones.sql). SELECT로 먼저
   확인하고 나서 INSERT하는 방식은 두 주문이 거의 동시에 확정되면(카드결제 웹훅과 프론트엔드
   확인이 겹치는 경우, 관리자가 여러 건을 빠르게 입금확인 처리하는 경우 등) 둘 다 SELECT를
   통과해버려 같은 마일스톤 쿠폰이 중복 발급될 수 있다(2026-09-01 코드 감사에서 발견) —
   tel+milestone에 유니크 제약을 건 테이블에 INSERT를 시도해서, 유니크 위반(23505)이 나면
   "이미 다른 요청이 선점했다"는 뜻으로 조용히 포기한다. 마이그레이션 미실행 시엔 잠금 없이
   진행(예전과 같은 경합 위험이 남지만, 이 기능 자체가 막히지는 않음 — 다른 선택 기능과 같은
   "미실행 시 조용히 저하" 원칙). */
async function claimCouponMilestone(tel, milestone) {
  const { error } = await supabaseAdmin.from("coupon_milestones").insert({ tel, milestone });
  if (!error) return true;
  if (error.code === "23505") return false;
  if (isMissingSchemaError(error)) {
    console.warn("[coupon-milestone] coupon_milestones 테이블 없음(마이그레이션 028 미실행) — 잠금 없이 진행");
    return true;
  }
  console.error("[coupon-milestone] 잠금 시도 실패:", error.message);
  return true;
}

/* ---------- 첫 구매 감사 쿠폰 ----------
   카드결제(finalizeCardOrder, 결제 즉시 "입금확인")와 무통장입금(관리자가 PATCH로 "입금확인"
   처리) 양쪽에서 공통으로 부른다. 이 고객의 확정 주문(취소·입금대기 제외)이 이번이 처음이면,
   그 고객 전용 1회용 쿠폰을 새로 만들어 coupons 테이블에 저장하고(Works "쿠폰" 탭에도 그대로
   보임 — usage_limit=1이라 자연히 "한 번만" 쓸 수 있게 됨, 새 검증 로직 없이 기존
   resolveCoupon()이 그대로 처리) 메일로 안내한다.
   할인율은 새 설정 테이블을 만들지 않고 기존 admin_settings(Works "정보" 탭)를 재사용한다 —
   관리자가 그 탭에서 이 라벨의 값을 숫자로 바꾸면 다음 발급부터 바로 반영된다. 설정 자체가
   없으면(처음 배포 시) 기본값 1%로 폴백한다.
   코드 접두사(THANKS-)는 Works 대시보드 "첫 구매 쿠폰 발급 현황"(computeDashboardStats)이
   발급/사용 건수를 집계할 때도 그대로 쓰인다 — 접두사를 바꾸면 그쪽 집계도 같이 바꿔야 한다.
   ⚠️ 이 항목의 label은 free-text인 admin_settings에서 정확히 문자열이 일치해야 찾아진다 —
   routes/settings.js가 이 라벨(과 아래 재구매 라벨)의 이름 변경·삭제를 막아둔 이유가 이것
   (2026-09-01 코드 감사에서 발견: 이름을 조금이라도 고치면 조용히 기본값으로 되돌아감). */
const FIRST_PURCHASE_COUPON_DEFAULT_PERCENT = 1;

/* hasPriorOrder는 호출부(issueThanksCouponsIfEligible)가 한 번의 쿼리로 미리 계산해서 넘겨준다
   — 재구매 감사 쿠폰과 거의 같은 대상 집합을 각자 따로 조회하던 것을 통합함(2026-09-01 코드
   감사에서 발견한 비효율). */
async function maybeIssueFirstPurchaseCoupon(order, hasPriorOrder) {
  if (hasPriorOrder) return;

  const telDigits = normalizeTel(order.customer && order.customer.tel);
  if (!telDigits) return;
  if (!(await claimCouponMilestone(telDigits, "first_purchase"))) return;

  const { data: setting } = await supabaseAdmin
    .from("admin_settings")
    .select("value")
    .eq("label", FIRST_PURCHASE_COUPON_SETTING_LABEL)
    .maybeSingle();
  const parsedPercent = Math.floor(Number(setting && setting.value));
  const percent = Number.isFinite(parsedPercent) && parsedPercent > 0 && parsedPercent <= 100 ? parsedPercent : FIRST_PURCHASE_COUPON_DEFAULT_PERCENT;

  const code = await generateUniqueCouponCode(FIRST_PURCHASE_COUPON_CODE_PREFIX);
  if (!code) {
    console.error("[first-purchase-coupon] 고유 코드 생성 실패(5회 시도)");
    logSystemError("first_purchase_coupon_failed", { orderNo: order.order_no, stage: "code_generation" });
    return;
  }

  const { error: insertError } = await supabaseAdmin.from("coupons").insert({
    code,
    discount_type: "percent",
    discount_value: percent,
    scope: "all",
    usage_limit: 1,
    active: true,
  });
  if (insertError) {
    console.error("[first-purchase-coupon] 쿠폰 생성 실패:", insertError.message);
    logSystemError("first_purchase_coupon_failed", { orderNo: order.order_no, stage: "coupon_insert", error: insertError.message });
    return;
  }

  await sendCustomerFirstPurchaseThanks({ customer: order.customer, code, discountValue: percent }).catch((err) =>
    console.error("[mailer] 첫 구매 감사 쿠폰 메일 발송 실패:", err.message)
  );
}

/* ---------- 재구매 감사 쿠폰 ----------
   첫 구매 감사 쿠폰과 똑같은 자리(카드결제 확정·관리자의 "입금확인" 처리)에서 같이 호출된다.
   이 고객의 확정 주문 수(취소·입금대기 제외, 이번 주문 포함)가 정확히 기준 횟수(기본 5회)에
   "막 도달한" 순간에만 1회 발급한다 — 매번 세는 게 아니라 "==threshold"로만 판정해서 6번째·
   7번째 구매에서 또 발급되는 걸 막는다(그 다음은 10번째·15번째처럼 다음 단계를 원하면 관리자가
   기준 횟수 자체를 나중에 조정하면 된다 — 지금은 "5번째"만 지원). 할인율·기준 횟수 모두 첫
   구매 쿠폰과 같은 원칙으로 새 테이블 없이 admin_settings를 재사용한다. */
const REPEAT_PURCHASE_COUPON_DEFAULT_THRESHOLD = 5;
const REPEAT_PURCHASE_COUPON_DEFAULT_PERCENT = 5;

/* confirmedCount도 호출부가 미리 계산해서 넘겨준다(위 첫 구매 쿠폰 참고). */
async function maybeIssueRepeatPurchaseCoupon(order, confirmedCount) {
  const telDigits = normalizeTel(order.customer && order.customer.tel);
  if (!telDigits) return;

  const { data: thresholdSetting } = await supabaseAdmin
    .from("admin_settings")
    .select("value")
    .eq("label", REPEAT_PURCHASE_COUPON_THRESHOLD_LABEL)
    .maybeSingle();
  const parsedThreshold = Math.floor(Number(thresholdSetting && thresholdSetting.value));
  const threshold = Number.isFinite(parsedThreshold) && parsedThreshold > 1 ? parsedThreshold : REPEAT_PURCHASE_COUPON_DEFAULT_THRESHOLD;

  if (confirmedCount !== threshold) return;
  if (!(await claimCouponMilestone(telDigits, `repeat_${threshold}`))) return;

  const { data: percentSetting } = await supabaseAdmin
    .from("admin_settings")
    .select("value")
    .eq("label", REPEAT_PURCHASE_COUPON_PERCENT_LABEL)
    .maybeSingle();
  const parsedPercent = Math.floor(Number(percentSetting && percentSetting.value));
  const percent = Number.isFinite(parsedPercent) && parsedPercent > 0 && parsedPercent <= 100 ? parsedPercent : REPEAT_PURCHASE_COUPON_DEFAULT_PERCENT;

  const code = await generateUniqueCouponCode(REPEAT_PURCHASE_COUPON_CODE_PREFIX);
  if (!code) {
    console.error("[repeat-purchase-coupon] 고유 코드 생성 실패(5회 시도)");
    logSystemError("repeat_purchase_coupon_failed", { orderNo: order.order_no, stage: "code_generation" });
    return;
  }

  const { error: insertError } = await supabaseAdmin.from("coupons").insert({
    code,
    discount_type: "percent",
    discount_value: percent,
    scope: "all",
    usage_limit: 1,
    active: true,
  });
  if (insertError) {
    console.error("[repeat-purchase-coupon] 쿠폰 생성 실패:", insertError.message);
    logSystemError("repeat_purchase_coupon_failed", { orderNo: order.order_no, stage: "coupon_insert", error: insertError.message });
    return;
  }

  await sendCustomerRepeatPurchaseThanks({ customer: order.customer, code, discountValue: percent, purchaseCount: threshold }).catch((err) =>
    console.error("[mailer] 재구매 감사 쿠폰 메일 발송 실패:", err.message)
  );
}

/* 첫 구매·재구매 감사 쿠폰 둘 다 "이 고객의 확정 주문이 몇 건이고 그중 이번 주문이 처음인지"를
   판단해야 하는데, 예전엔 거의 같은 조건(입금확인/배송중/완료 상태의 orders 전체)으로 각자
   따로 조회하고 있었다(2026-09-01 코드 감사에서 발견한 비효율 — 주문이 확정될 때마다 매번
   두 번 왕복). 한 번만 조회해서 두 판정에 그대로 나눠 쓴다. */
async function issueThanksCouponsIfEligible(order) {
  const telDigits = normalizeTel(order.customer && order.customer.tel);
  if (!telDigits) return;

  const { data: matchingOrders, error } = await supabaseAdmin
    .from("orders")
    .select("order_no, customer")
    .in("status", ["입금확인", "배송중", "완료"]);
  if (error) {
    console.error("[thanks-coupon] 기존 주문 조회 실패:", error.message);
    logSystemError("thanks_coupon_failed", { orderNo: order.order_no, stage: "order_lookup", error: error.message });
    return;
  }

  const sameCustomer = (matchingOrders || []).filter((o) => normalizeTel(o.customer && o.customer.tel) === telDigits);
  const hasPriorOrder = sameCustomer.some((o) => o.order_no !== order.order_no);
  const confirmedCount = sameCustomer.length;

  await Promise.all([
    maybeIssueFirstPurchaseCoupon(order, hasPriorOrder).catch((err) => console.error("[first-purchase-coupon] 처리 실패:", err.message)),
    maybeIssueRepeatPurchaseCoupon(order, confirmedCount).catch((err) => console.error("[repeat-purchase-coupon] 처리 실패:", err.message)),
  ]);
}

app.post("/api/order", writeLimiter, optionalAuth, async (req, res) => {
  if (req.body && req.body.paymentId) {
    const paymentId = String(req.body.paymentId).trim();
    const { data: pending, error: pendErr } = await supabaseAdmin
      .from("pending_payments")
      .select("*")
      .eq("payment_id", paymentId)
      .maybeSingle();
    if (pendErr || !pending) {
      /* 결제 준비 요청 이후 웹훅이 먼저 도착해 이미 주문이 만들어졌을 수도 있다 — 그 경우 정상 케이스다. */
      const { data: already } = await supabaseAdmin.from("orders").select("*").eq("payment_id", paymentId).maybeSingle();
      if (already) {
        return res.json({
          no: already.order_no, at: already.created_at, customer: already.customer, items: already.items,
          subtotal: already.subtotal, shipping: already.shipping, total: already.total,
          discount: already.discount, couponCode: already.coupon_code,
          paymentMethod: already.payment_method, sent: true,
        });
      }
      return res.status(400).json({ error: "결제 정보를 찾을 수 없습니다. 처음부터 다시 시도해 주세요." });
    }

    let verified;
    try {
      verified = await portone.getVerifiedPayment(paymentId);
    } catch (e) {
      console.error("[order] 결제 조회 실패:", e.message);
      return res.status(502).json({ error: "결제 확인 중 오류가 발생했습니다." });
    }
    if (verified.status !== "PAID" || verified.amount.total !== pending.total) {
      console.error(
        "[order] 결제 검증 실패:", paymentId,
        "status=", verified.status, "amount=", verified.amount && verified.amount.total, "expected=", pending.total
      );
      return res.status(402).json({ error: "결제가 확인되지 않았습니다." });
    }

    const result = await finalizeCardOrder({ pending, paymentId, userId: req.user ? req.user.id : null });
    if (!result.ok) return res.status(result.status).json(result.body);
    return res.json({
      no: result.saved.order_no, at: result.saved.created_at, customer: result.saved.customer, items: result.saved.items,
      subtotal: result.saved.subtotal, shipping: result.saved.shipping, total: result.saved.total,
      discount: result.saved.discount, couponCode: result.saved.coupon_code,
      paymentMethod: result.saved.payment_method, sent: true,
    });
  }

  /* 쿠폰이 유효하지 않으면 재고를 건드리기 전에(아래 decrement_inventory 호출 전에) 먼저 실패시킨다 —
     재고만 축나고 주문은 안 만들어지는 상황을 피하기 위해서다. */
  const products = await getActiveProducts();
  const priced = await validateAndPriceOrder(req.body, products);
  if (priced.error) return res.status(priced.error.status).json(priced.error.body);
  const { rawItems, items, subtotal, shipping, coupon, total, device } = priced;
  const { customer } = req.body;

  const orderNumber = orderNo(await nextOrderSeq());

  /* 실물 재고가 있는(참/추가아이템이 아닌) 상품·사이즈 조합만 차감 대상으로 뽑는다.
     rawItems와 items는 map()으로 만들어져 인덱스가 그대로 대응된다. */
  const inventoryItems = [];
  rawItems.forEach((raw, i) => {
    if (
      typeof raw.productId === "string" &&
      !raw.productId.startsWith("charm-") &&
      typeof raw.size === "string" &&
      raw.size
    ) {
      inventoryItems.push({ productId: raw.productId, color: raw.color || "", size: raw.size, qty: items[i].qty });
    }
  });

  if (inventoryItems.length) {
    const decResult = await decrementInventoryForItems(inventoryItems, products, orderNumber);
    if (!decResult.ok) {
      if (decResult.outOfStock) return res.status(409).json({ error: "OUT_OF_STOCK", ...decResult.outOfStock });
      console.error("[order] 재고 차감 실패:", decResult.dbError);
      return res.status(500).json({ error: "재고 확인 중 오류가 발생했습니다." });
    }
  }

  const normalizedCustomer = {
    name: String(customer.name).trim(),
    tel: String(customer.tel).trim(),
    email: String(customer.email).trim(),
    zip: String(customer.zip).trim(),
    addr: String(customer.addr).trim(),
    addr2: String(customer.addr2 || "").trim(),
    memo: String(customer.memo || "").trim(),
    payer: String(customer.payer).trim(),
  };

  /* 반품 시 재고를 복원하려면 어떤 상품·사이즈·컬러를 얼마나 샀는지가 주문 레코드 자체에 남아있어야
     한다 — items(name/options/qty/unit/sum)에는 원래 productId가 없어서 나중엔 알 수 없었다. */
  const itemsForStorage = items.map((it, i) => ({ ...it, productId: rawItems[i].productId, size: rawItems[i].size || null, color: rawItems[i].color || null }));

  const { data: saved, error: saveError } = await insertOrderRow(
    "orders",
    {
      order_no: orderNumber,
      user_id: req.user ? req.user.id : null,
      customer: normalizedCustomer,
      items: itemsForStorage,
      device,
      subtotal,
      shipping,
      total,
      coupon_code: coupon.code,
      discount: coupon.discount,
    },
    { returning: true }
  );

  if (saveError) {
    /* 여기까지 오는 동안 재고는 이미 차감된 상태다 — 저장만 실패하면 주문 기록 없이 재고만
       영구히 줄어드는 사고가 난다. 카드결제 경로(finalizeCardOrder)는 이 경우 재고를 복원
       하는데 무통장입금 경로만 그 처리가 빠져 있던 것을 2026-09-01 코드 감사에서 발견해
       맞췄다(카드결제와 달리 아직 돈을 받은 상태가 아니라 결제 취소·환불은 필요 없음). */
    console.error("[order] 주문 저장 실패:", saveError.message);
    if (inventoryItems.length) {
      const { error: restoreError } = await supabaseAdmin.rpc("restore_inventory", { p_items: inventoryItems });
      if (restoreError) {
        console.error("[order] ⚠️ 주문 저장 실패 후 재고 복원도 실패 — 수동 확인 필요:", orderNumber, restoreError.message);
      } else {
        logInventoryChange(
          inventoryItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: it.qty, reason: "order_finalize_failed", ref: orderNumber }))
        );
      }
    }
    logSystemError("bank_order_finalize_failed", { orderNo: orderNumber, error: saveError.message });
    return res.status(500).json({ error: "주문 저장에 실패했습니다." });
  }

  sendOrderNotification(saved).catch((err) => {
    console.error("[mailer] 주문 알림 메일 발송 실패:", err.message);
  });
  sendCustomerOrderReceived(saved).catch((err) => {
    console.error("[mailer] 주문 접수 확인 메일 발송 실패:", err.message);
  });
  kakao.sendAlimtalk("ORDER_RECEIVED", saved.customer.tel, { name: saved.customer.name, orderNo: saved.order_no }).catch(() => {});
  sendPushToAdmins({ title: "새 주문 접수", body: `${saved.order_no} · 무통장입금 대기`, tab: "orders" }).catch((err) =>
    console.error("[push] 알림 발송 실패:", err.message)
  );

  res.json({
    no: saved.order_no,
    at: saved.created_at,
    customer: saved.customer,
    items: saved.items,
    subtotal: saved.subtotal,
    shipping: saved.shipping,
    total: saved.total,
    discount: saved.discount,
    couponCode: saved.coupon_code,
    paymentMethod: "bank_transfer",
    sent: true,
  });
});

/* 브라우저가 Supabase 클라이언트를 초기화하기 위한 공개 설정값 — anon key는 비밀이 아니다
   (Supabase의 RLS가 실제 접근 권한을 결정하며, service role key만 비밀로 취급한다). */
app.get("/api/config", (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    // storeId/channelKey는 포트원 결제창을 여는 데 필요한 공개 식별자다(비밀 아님) —
    // 실제 인증은 서버의 PORTONE_API_SECRET으로만 이뤄지므로 브라우저에 노출돼도 안전하다.
    cardPaymentEnabled: portone.isConfigured(),
    portoneStoreId: process.env.PORTONE_STORE_ID || null,
    portoneChannelKey: process.env.PORTONE_CHANNEL_KEY || null,
  });
});

/* GET /health는 routes/health.js에서 가져온다 — UptimeRobot이 DB 연결까지 확인할 수 있는
   전용 엔드포인트(2026-09-01 추가, 위 0번 섹션 참고). */
app.use(healthRoutes);

/* ---------- 관리자 로그인 실패 잠금 ----------
   로그인 자체는 브라우저가 Supabase Auth를 직접 호출해서 이뤄진다(server/를 거치지 않음) —
   그래서 이 서버가 로그인 성공·실패를 직접 볼 방법이 없다. works/index.html이 로그인 시도
   전후로 이 두 엔드포인트에 결과를 "보고"하게 해서, 같은 이메일로 7번 연속 실패하면 일정 시간
   로그인 버튼 자체를 막는다.
   ⚠️ 이건 실제 로그인 화면을 통한 시도에 대한 보완장치일 뿐이다. Supabase Auth REST API는
   공개 anon key로 누구나 직접 호출할 수 있어서(우리 서버를 거칠 필요가 없음), 이 엔드포인트를
   아예 건드리지 않고 Supabase에 바로 비밀번호를 대입하는 공격은 막지 못한다 — 그건 Supabase
   대시보드의 Authentication > Rate Limits(또는 Attack Protection)에서 별도로 설정해야
   하는, 코드로는 우회할 수 없는 영역이다. */
const LOGIN_FAIL_THRESHOLD = 7;
const LOGIN_LOCK_MINUTES = 15;

app.get("/api/admin/login-lock", writeLimiter, async (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase().slice(0, 200);
  if (!email) return res.json({ locked: false });

  const { data, error } = await supabaseAdmin.from("login_attempts").select("locked_until").eq("email", email).maybeSingle();
  if (error) console.error("[login-lock] 조회 실패(017_login_lockout.sql 미실행일 수 있음):", error.message);
  const lockedUntil = data?.locked_until ? new Date(data.locked_until) : null;
  if (lockedUntil && lockedUntil > new Date()) {
    return res.json({ locked: true, retryAfterSeconds: Math.ceil((lockedUntil - new Date()) / 1000) });
  }
  res.json({ locked: false });
});

app.post("/api/admin/login-lock", writeLimiter, async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase().slice(0, 200);
  const success = !!(req.body || {}).success;
  if (!email) return res.status(400).json({ error: "email이 필요합니다." });

  if (success) {
    /* success:true(실패 카운트 초기화)는 로그인이 방금 실제로 성공했을 때만 브라우저가 이미
       손에 쥐고 있는 Supabase 세션 토큰이 있다 — 그 토큰을 요구해서 본인 것이 맞는지 검증한다.
       검증 없이 email+success만 믿으면, 로그인을 한 번도 시도하지 않은 공격자가 남의 이메일로
       success:true를 계속 보내 실패 카운트를 미리 지워서 잠금 자체를 무력화할 수 있었다.
       (success:false는 로그인이 실패했을 때 보고하는 것이라 애초에 토큰이 존재하지 않으므로
       이 검증을 적용할 수 없다 — 그 경로의 잔여 위험은 알려진 제약으로 남겨둠.) */
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "인증 토큰이 필요합니다." });
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user || String(data.user.email || "").trim().toLowerCase() !== email) {
      return res.status(403).json({ error: "본인 계정에 대해서만 초기화할 수 있습니다." });
    }
    await supabaseAdmin.from("login_attempts").delete().eq("email", email);
    return res.json({ ok: true });
  }

  const { data: prev, error: selectError } = await supabaseAdmin.from("login_attempts").select("fail_count").eq("email", email).maybeSingle();
  if (selectError) console.error("[login-lock] 조회 실패(017_login_lockout.sql 미실행일 수 있음):", selectError.message);
  const failCount = (prev?.fail_count || 0) + 1;
  const patch = { email, fail_count: failCount, updated_at: new Date().toISOString() };

  if (failCount >= LOGIN_FAIL_THRESHOLD) {
    patch.locked_until = new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000).toISOString();
    patch.fail_count = 0; // 잠금이 풀리면 다시 처음부터 셀 수 있게 초기화
    sendAdminLoginLocked({ email, failCount }).catch((err) => console.error("[mailer] 로그인 잠금 알림 메일 발송 실패:", err.message));
  }

  const { error: upsertError } = await supabaseAdmin.from("login_attempts").upsert(patch, { onConflict: "email" });
  if (upsertError) console.error("[login-lock] 저장 실패:", upsertError.message);
  res.json({ ok: true });
});

/* ---------- 비회원 주문 조회 (주문번호 + 연락처) ---------- */
app.post("/api/orders/lookup", writeLimiter, async (req, res) => {
  const { orderNo: reqOrderNo, tel } = req.body || {};
  const orderNoStr = String(reqOrderNo || "").trim();
  const telDigits = normalizeTel(tel);

  if (!orderNoStr || !telDigits) {
    return res.status(400).json({ error: "주문번호와 연락처를 입력해 주세요." });
  }

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("order_no, customer, items, subtotal, shipping, total, status, courier, tracking_no, created_at")
    .eq("order_no", orderNoStr)
    .maybeSingle();

  if (error) {
    console.error("[orders/lookup] 조회 실패:", error.message);
    return res.status(500).json({ error: "조회 중 오류가 발생했습니다." });
  }

  // 주문이 없거나 연락처가 일치하지 않으면 어느 쪽이 틀렸는지 알려주지 않는다.
  if (!data || normalizeTel(data.customer.tel) !== telDigits) {
    return res.status(404).json({ error: "일치하는 주문을 찾을 수 없습니다. 주문번호와 연락처를 다시 확인해 주세요." });
  }

  res.json({
    no: data.order_no,
    at: data.created_at,
    items: data.items,
    subtotal: data.subtotal,
    shipping: data.shipping,
    total: data.total,
    status: data.status,
    courier: data.courier || null,
    trackingNo: data.tracking_no || null,
  });
});

/* ---------- 회원 주문내역 ---------- */
app.get("/api/my/orders", requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("order_no, items, subtotal, shipping, total, status, courier, tracking_no, created_at")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[my/orders] 조회 실패:", error.message);
    return res.status(500).json({ error: "주문내역을 불러오지 못했습니다." });
  }

  res.json(
    data.map((o) => ({
      no: o.order_no,
      at: o.created_at,
      items: o.items,
      subtotal: o.subtotal,
      shipping: o.shipping,
      total: o.total,
      status: o.status,
      courier: o.courier || null,
      trackingNo: o.tracking_no || null,
    }))
  );
});

/* ---------- 반품 · 교환 신청 ---------- */
app.post("/api/returns", writeLimiter, optionalAuth, async (req, res) => {
  const { orderNo: reqOrderNo, contactName, contactTel, reason, detail } = req.body || {};

  const orderNoStr = String(reqOrderNo || "").trim();
  const nameStr = String(contactName || "").trim().slice(0, 40);
  const telStr = String(contactTel || "").trim().slice(0, 20);
  const reasonStr = String(reason || "").trim().slice(0, 40);
  const detailStr = String(detail || "").trim().slice(0, 1000);

  if (!orderNoStr || !nameStr || !telStr || !reasonStr) {
    return res.status(400).json({ error: "주문번호·이름·연락처·사유를 모두 입력해 주세요." });
  }

  /* 주문번호+연락처가 실제 주문과 일치하는지 확인한다(/api/orders/lookup, 리뷰 실구매 인증과
     같은 원칙) — 이게 없으면 존재하지 않는 주문번호나 남의 주문번호로도 반품 신청이 쌓여서
     관리자가 매번 수작업으로 걸러야 했다. */
  const { data: orderRow, error: orderLookupError } = await supabaseAdmin
    .from("orders")
    .select("order_no, customer")
    .eq("order_no", orderNoStr)
    .maybeSingle();
  if (orderLookupError) {
    console.error("[returns] 주문 확인 실패:", orderLookupError.message);
    return res.status(500).json({ error: "주문 확인 중 오류가 발생했습니다." });
  }
  if (!orderRow || normalizeTel(orderRow.customer.tel) !== normalizeTel(telStr)) {
    return res.status(404).json({ error: "일치하는 주문을 찾을 수 없습니다. 주문번호와 연락처를 다시 확인해 주세요." });
  }

  const { data, error } = await supabaseAdmin
    .from("return_requests")
    .insert({
      order_no: orderNoStr,
      user_id: req.user ? req.user.id : null,
      contact_name: nameStr,
      contact_tel: telStr,
      reason: reasonStr,
      detail: detailStr || null,
    })
    .select()
    .single();

  if (error) {
    console.error("[returns] 저장 실패:", error.message);
    return res.status(500).json({ error: "접수에 실패했습니다." });
  }

  res.json({
    id: data.id,
    orderNo: data.order_no,
    contactName: data.contact_name,
    contactTel: data.contact_tel,
    reason: data.reason,
    detail: data.detail,
    status: data.status,
    at: data.created_at,
  });
});

/* logAdminAction·logInventoryChange·logSystemError는 lib/adminLog.js로,
   applyKstDateRangeFilter는 lib/kst.js로 옮겨서 위 import에서 가져온다 — 여러 라우트 파일이
   공유하는 로그·필터 헬퍼라 한 곳에 있어야 한다(2026-09-01, 코드 크기 정리 1단계). */

app.get("/api/admin/audit-log", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query);
  const { adminEmail, action, targetType, targetId, dateFrom, dateTo } = req.query;

  let query = supabaseAdmin.from("admin_audit_log").select("*", { count: "exact" }).order("at", { ascending: false });
  if (adminEmail) query = query.ilike("admin_email", `%${adminEmail}%`);
  if (action) query = query.eq("action", action);
  /* 주문 상세 화면의 "변경 이력" 타임라인용 — targetType+targetId(예: order/R260830-000003)로
     좁히면 그 주문 하나에 대한 변경만 뽑을 수 있다. 새 테이블 없이 기존 감사로그를 재사용. */
  if (targetType) query = query.eq("target_type", targetType);
  if (targetId) query = query.eq("target_id", targetId);
  query = applyKstDateRangeFilter(query, "at", dateFrom, dateTo);

  const { data, error, count } = await query.range(from, to);

  if (error) return res.status(500).json({ error: "감사 로그를 불러오지 못했습니다." });
  res.json({
    items: data.map((r) => ({
      id: r.id,
      adminEmail: r.admin_email,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      detail: r.detail,
      at: r.at,
    })),
    page,
    pageSize,
    total: count ?? data.length,
  });
});

/* 관리자 대시보드(GET /api/admin/dashboard·/dashboard/export, GA4 방문자 통계 /api/admin/analytics) —
   돈이 오가는 라우트가 아니라 읽기 전용 집계라 routes/dashboard.js로 분리했다(2026-09-01,
   라우트 분리 다음 라운드). computeDashboardStats도 그 파일로 함께 옮겼다. */
app.use(dashboardRoutes);

/* ---------- 알림센터 ----------
   "확인이 필요한 것들"을 한눈에 모아 보여주는 용도 — 별도 읽음/안읽음 상태를 DB에 저장하지
   않고, 그때그때 조건에 맞는 건수를 센다(입금대기 주문 = 아직 확인 안 한 신규 주문으로 취급,
   입금확인 등으로 상태를 바꾸면 자연히 카운트에서 빠짐). 5개 쿼리를 병렬로 돌린다.
   시스템 오류(카드결제 이중실패·환불 실패)만 예외 — 별도 사이드바 탭이 없어 tab을
   "systemErrors"로 두고, 클릭하면 works/index.html이 탭 이동 대신 같은 자리에서 목록을
   펼쳐 보여준다(아래 /api/admin/system-errors 참고). system_error_log 테이블이 아직
   없으면(019 미실행) 조회가 실패하는데, 다른 마이그레이션과 같은 원칙으로 조용히 0건 취급한다. */
app.get("/api/admin/notifications", requireAdmin, async (req, res) => {
  const [orders, inventory, qna, returns, systemErrors] = await Promise.all([
    supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).eq("status", "입금대기"),
    supabaseAdmin.from("inventory").select("product_id", { count: "exact", head: true }).lte("qty", 0),
    supabaseAdmin.from("qna").select("id", { count: "exact", head: true }).is("answer", null),
    supabaseAdmin.from("return_requests").select("id", { count: "exact", head: true }).eq("status", "접수"),
    supabaseAdmin.from("system_error_log").select("id", { count: "exact", head: true }).eq("resolved", false),
  ]);

  const items = [
    { key: "pendingOrders", label: "입금 확인 대기 주문", count: orders.count || 0, tab: "orders" },
    { key: "outOfStock", label: "품절된 재고 조합", count: inventory.count || 0, tab: "inventory" },
    { key: "unansweredQna", label: "답변 대기 Q&A", count: qna.count || 0, tab: "qna" },
    { key: "pendingReturns", label: "처리 대기 반품·교환 신청", count: returns.count || 0, tab: "returns" },
    { key: "systemErrors", label: "시스템 오류", count: systemErrors.count || 0, tab: "systemErrors" },
  ];
  res.json({ items, total: items.reduce((sum, it) => sum + it.count, 0) });
});

const SYSTEM_ERROR_LABEL = {
  card_cancel_failed: "카드결제 취소 실패(이중실패)",
  refund_failed: "환불 실패",
  order_finalize_failed: "카드결제 후 주문 확정 실패",
  bank_order_finalize_failed: "무통장입금 주문 저장 실패(재고 확인 필요)",
};

/* 알림센터 벨에서 "시스템 오류" 행을 눌렀을 때 펼쳐 보여줄 상세 목록 — 최근 미해결 20건만.
   해결 처리는 DB에서 지우지 않고 resolved=true로만 표시한다(감사 로그와 같은 원칙 — 무슨 일이
   있었는지는 남겨둔다). */
app.get("/api/admin/system-errors", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("system_error_log")
    .select("*")
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return res.status(500).json({ error: "시스템 오류 로그를 불러오지 못했습니다." });
  res.json({
    items: data.map((r) => ({ id: r.id, type: r.type, label: SYSTEM_ERROR_LABEL[r.type] || r.type, detail: r.detail, at: r.created_at })),
  });
});

app.post("/api/admin/system-errors/:id/resolve", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("system_error_log").update({ resolved: true }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "처리에 실패했습니다." });
  res.json({ ok: true });
});

/* 관리자 계정 관리(GET/POST /api/admin/admins, DELETE /api/admin/admins/:id) — 돈·재고를
   건드리지 않는 순수 CRUD라 routes/admins.js로 분리했다(2026-09-01, 라우트 분리 다음 라운드). */
app.use(adminsRoutes);

/* 일반 회원 계정 관리(GET /api/admin/members, PATCH .../ban, DELETE) — admins.js와 같은
   이유로 별도 파일로 분리했다(2026-09-01, README "다음 세션이 가장 먼저 할 일" 19번). */
app.use(membersRoutes);

/* ---------- 관리자 ---------- */
/* 필터: q(주문번호·주문자명·연락처·이메일 중 아무 데나 부분 일치) · status(정확히 일치) ·
   dateFrom/dateTo(그 날짜의 KST 00:00~23:59:59, YYYY-MM-DD). q는 PostgREST의 or 필터로
   네 컬럼(주소값은 jsonb라 ->> 로 텍스트 추출)을 한 번에 검색한다. 이메일 검색은 2026-09-01에
   추가 — "회원 계정 관리" 탭에서 특정 회원의 주문 내역으로 바로 넘어올 수 있게 하려면 이메일로도
   찾아져야 했다(works/js/members.js의 "주문 보기" 참고).
   목록(GET /api/admin/orders)과 내보내기(GET /api/admin/orders/export)가 이 로직을 공유한다. */
function applyOrderFilters(query, reqQuery) {
  const { q, status, dateFrom, dateTo } = reqQuery;
  if (q) {
    const v = String(q).trim().slice(0, 60).replace(/[%,()]/g, "");
    if (v) query = query.or(`order_no.ilike.%${v}%,customer->>name.ilike.%${v}%,customer->>tel.ilike.%${v}%,customer->>email.ilike.%${v}%`);
  }
  if (status) query = query.eq("status", status);
  query = applyKstDateRangeFilter(query, "created_at", dateFrom, dateTo);
  return query;
}

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query);

  let query = supabaseAdmin
    .from("orders")
    .select("order_no, customer, items, subtotal, shipping, total, status, courier, tracking_no, created_at", { count: "exact" })
    .order("created_at", { ascending: false });
  query = applyOrderFilters(query, req.query);

  const { data, error, count } = await query.range(from, to);

  if (error) return res.status(500).json({ error: "주문 목록을 불러오지 못했습니다." });

  res.json({
    items: data.map((o) => ({
      no: o.order_no,
      at: o.created_at,
      customer: o.customer,
      items: o.items,
      subtotal: o.subtotal,
      shipping: o.shipping,
      total: o.total,
      status: o.status,
      courier: o.courier || null,
      trackingNo: o.tracking_no || null,
    })),
    page,
    pageSize,
    total: count ?? data.length,
  });
});

/* 주문 목록 내보내기 — 화면의 검색·필터 조건을 그대로 받아(위 applyOrderFilters 재사용)
   페이지네이션 없이 최대 EXPORT_MAX_ROWS건까지 한 번에 뽑는다. ?format=csv|xlsx|pdf. */
const EXPORT_MAX_ROWS = 5000;
app.get("/api/admin/orders/export", requireAdmin, async (req, res) => {
  const format = String(req.query.format || "csv").toLowerCase();
  if (!["csv", "xlsx", "pdf"].includes(format)) {
    return res.status(400).json({ error: "format은 csv, xlsx, pdf 중 하나여야 합니다." });
  }

  let query = supabaseAdmin
    .from("orders")
    .select("order_no, customer, items, subtotal, shipping, total, status, courier, tracking_no, created_at")
    .order("created_at", { ascending: false })
    .limit(EXPORT_MAX_ROWS);
  query = applyOrderFilters(query, req.query);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: "주문 목록을 불러오지 못했습니다." });

  const filename = `reiten-orders-${new Date().toISOString().slice(0, 10)}`;
  try {
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
      res.send(toCsv(data));
    } else if (format === "xlsx") {
      const buf = await toXlsxBuffer(data);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
      res.send(Buffer.from(buf));
    } else {
      const buf = await toPdfBuffer(data);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
      res.send(buf);
    }
    logAdminAction(req, "order.export", "order", "export", { format, count: data.length, q: req.query.q || null });
  } catch (e) {
    console.error("[admin/orders/export] 생성 실패:", e.message);
    res.status(500).json({ error: "내보내기 파일 생성에 실패했습니다." });
  }
});

/* 상태가 (처음으로) "입금확인"이 되는 순간의 메일·알림톡·첫구매쿠폰, 운송장번호가 처음
   채워지는 순간의 배송시작 메일·알림톡 — 건별 PATCH(/api/admin/orders/:no)와 일괄
   PATCH(/api/admin/orders/bulk) 양쪽이 완전히 똑같은 조건으로 처리해야 해서 하나로 뽑았다. */
async function notifyOrderStatusSideEffects(prev, saved, patch) {
  if (patch.status === "입금확인" && prev?.status !== "입금확인") {
    sendCustomerPaymentConfirmed(saved).catch((err) => {
      console.error("[mailer] 입금 확인 메일 발송 실패:", err.message);
    });
    kakao.sendAlimtalk("PAYMENT_CONFIRMED", saved.customer.tel, { name: saved.customer.name, orderNo: saved.order_no }).catch(() => {});
    issueThanksCouponsIfEligible(saved).catch((err) => console.error("[thanks-coupon] 처리 실패:", err.message));
  }
  if (!prev?.tracking_no && saved.tracking_no) {
    sendCustomerShipped(saved).catch((err) => {
      console.error("[mailer] 배송 시작 메일 발송 실패:", err.message);
    });
    kakao
      .sendAlimtalk("SHIPPED", saved.customer.tel, { name: saved.customer.name, orderNo: saved.order_no, trackingNo: saved.tracking_no })
      .catch(() => {});
  }
}

const ORDER_BULK_MAX = 200;

/* 여러 주문의 상태·배송정보를 한 번에 저장한다(운송장번호 CSV 일괄 입력, 입금확인 일괄 처리
   용도). 건별 PATCH와 달리 "취소"는 여기서 지원하지 않는다 — 취소는 재고 복원·카드 환불이
   자동으로 나가는 민감한 동작이라, 실수로 여러 건을 한꺼번에 취소·환불해버리는 사고를
   구조적으로 막기 위해 일부러 뺐다(취소는 계속 건별로만 가능). 이미 취소된 주문을 되돌리는
   것도 같은 이유로 여기선 막는다. 항목 하나가 실패해도 나머지는 계속 처리하고, 결과를
   항목별로 돌려준다(CSV에 오타가 섞여 있어도 나머지는 정상 처리되게).
   ⚠️ 반드시 아래 `/:no` 라우트보다 먼저 등록해야 한다 — Express는 `:no`가 슬래시 없는 문자열이면
   "bulk"도 그대로 흡수해버려서(2026-09-01 코드 감사에서 발견, 상품 일괄 처리와 같은 원인의
   버그), 순서가 뒤바뀌면 이 라우트가 죽은 코드가 된다. */
app.patch("/api/admin/orders/bulk", requireAdmin, async (req, res) => {
  const items = Array.isArray(req.body?.orders) ? req.body.orders : [];
  if (!items.length) return res.status(400).json({ error: "orders가 필요합니다." });
  if (items.length > ORDER_BULK_MAX) {
    return res.status(400).json({ error: `한 번에 최대 ${ORDER_BULK_MAX}건까지 처리할 수 있습니다.` });
  }

  const results = [];
  for (const item of items) {
    const orderNo = String(item?.orderNo || "").trim();
    if (!orderNo) {
      results.push({ orderNo: null, ok: false, error: "orderNo가 필요합니다." });
      continue;
    }

    const patch = {};
    if (item.status !== undefined) {
      const statusStr = String(item.status).trim();
      if (!statusStr) {
        results.push({ orderNo, ok: false, error: "status가 비어 있습니다." });
        continue;
      }
      if (statusStr === "취소") {
        results.push({ orderNo, ok: false, error: "일괄 처리에서는 취소를 지원하지 않습니다 — 개별로 처리해 주세요." });
        continue;
      }
      patch.status = statusStr;
    }
    if (item.courier !== undefined) {
      const courierStr = String(item.courier || "").trim();
      if (courierStr && !COURIERS.some((c) => c.key === courierStr)) {
        results.push({ orderNo, ok: false, error: "존재하지 않는 택배사입니다." });
        continue;
      }
      patch.courier = courierStr || null;
    }
    if (item.trackingNo !== undefined) {
      patch.tracking_no = String(item.trackingNo || "").trim().slice(0, 60) || null;
    }
    if (!Object.keys(patch).length) {
      results.push({ orderNo, ok: false, error: "변경할 값이 없습니다." });
      continue;
    }

    const { data: prev } = await supabaseAdmin.from("orders").select("status, tracking_no").eq("order_no", orderNo).maybeSingle();
    if (!prev) {
      results.push({ orderNo, ok: false, error: "존재하지 않는 주문입니다." });
      continue;
    }
    if (prev.status === "취소") {
      results.push({ orderNo, ok: false, error: "이미 취소된 주문은 일괄 처리로 되돌릴 수 없습니다 — 개별로 처리해 주세요." });
      continue;
    }

    const { data: saved, error } = await supabaseAdmin.from("orders").update(patch).eq("order_no", orderNo).select().single();
    if (error) {
      results.push({ orderNo, ok: false, error: "저장에 실패했습니다." });
      continue;
    }

    await notifyOrderStatusSideEffects(prev, saved, patch);
    results.push({ orderNo, ok: true });
  }

  const successCount = results.filter((r) => r.ok).length;
  logAdminAction(req, "order.bulk_update", "order", `${successCount}/${items.length}건`, { results });
  res.json({ ok: true, results });
});

/* status만 바꾸면 상태만, courier/trackingNo를 함께 보내면 배송정보도 같이 저장한다.
   status가 "입금확인"으로 바뀌는 순간에만 고객에게 입금 확인 메일을 보낸다(접수 메일은 /api/order에서 이미 발송됨).
   status가 (처음으로) "취소"가 되는 순간에는 미입금 자동취소·반품승인환불과 같은 원칙으로
   ① 재고 복원 ② 카드결제 건이면 포트원 환불 자동 시도 ③ 고객 안내 메일까지 한 번에 처리한다
   (cancelReason은 선택 — 입력하면 사유가 저장되고 고객 메일에도 그대로 노출됨). */
app.patch("/api/admin/orders/:no", requireAdmin, async (req, res) => {
  const { status, courier, trackingNo, cancelReason } = req.body || {};

  const patch = {};
  if (status !== undefined) {
    const statusStr = String(status).trim();
    if (!statusStr) return res.status(400).json({ error: "status가 비어 있습니다." });
    patch.status = statusStr;
  }
  if (courier !== undefined) {
    const courierStr = String(courier || "").trim();
    if (courierStr && !COURIERS.some((c) => c.key === courierStr)) {
      return res.status(400).json({ error: "존재하지 않는 택배사입니다." });
    }
    patch.courier = courierStr || null;
  }
  if (trackingNo !== undefined) {
    patch.tracking_no = String(trackingNo || "").trim().slice(0, 60) || null;
  }
  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: "변경할 값이 없습니다." });
  }

  /* 이번 변경으로 운송장번호가 "처음" 채워지는지, 취소 상태가 "처음" 되는지 판단하려면
     update 직전의 이전 상태가 필요하다. 존재하지 않는 주문번호(오타 등)를 여기서 걸러내지
     않으면 아래 update()가 0건 매칭으로 실패해 "저장에 실패했습니다"(500)라는 엉뚱한 에러가
     나간다 — 반품 라우트(PATCH /api/admin/returns/:id)와 같은 원칙으로 404를 먼저 확인한다
     (2026-09-01 코드 감사에서 발견). */
  const { data: prev, error: prevError } = await supabaseAdmin
    .from("orders")
    .select("status, tracking_no")
    .eq("order_no", req.params.no)
    .single();
  if (prevError || !prev) return res.status(404).json({ error: "존재하지 않는 주문입니다." });

  const cancelReasonStr = cancelReason ? String(cancelReason).trim().slice(0, 300) : "";
  const isNewCancel = patch.status === "취소" && prev.status !== "취소";
  /* 반대 방향(취소 → 다른 상태로 되돌림)도 대칭으로 처리해야 한다 — 안 하면 취소 시
     복원됐던 재고가 그대로 부풀려진 채 남는다(관리자가 실수로 취소했다가 바로 되돌리는
     경우 등). */
  const isUncancel = prev.status === "취소" && patch.status !== undefined && patch.status !== "취소";
  /* 취소 사유는 취소되는 그 순간 항상 명시적으로 반영하고(안 적었으면 null), 되돌릴 때는
     지운다 — 안 그러면 "취소(사유 있음) → 되돌리기 → 사유 없이 재취소"에서 첫 번째 취소
     사유가 stale로 그대로 남는 버그가 생긴다(2026-09-01 코드 감사에서 발견). 예전엔
     `isNewCancel && cancelReasonStr`일 때만 값을 넣어서, 두 번째 취소에서 사유를 안 적으면
     patch에 cancel_reason 자체가 안 들어가 DB에 예전 값이 그대로 남아 있었다. */
  if (isNewCancel) patch.cancel_reason = cancelReasonStr || null;
  if (isUncancel) patch.cancel_reason = null;

  const { data: saved, error } = await supabaseAdmin
    .from("orders")
    .update(patch)
    .eq("order_no", req.params.no)
    .select()
    .single();

  if (error) return res.status(500).json({ error: "저장에 실패했습니다." });

  await notifyOrderStatusSideEffects(prev, saved, patch);

  let cancelResult = null;
  if (isNewCancel) {
    const restoreItems = restoreItemsFromOrder(saved.items);
    if (restoreItems.length) {
      const { error: restoreError } = await supabaseAdmin.rpc("restore_inventory", { p_items: restoreItems });
      if (restoreError) {
        console.error("[admin/orders] 취소 시 재고 복원 실패:", saved.order_no, restoreError.message);
      } else {
        logInventoryChange(
          restoreItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: it.qty, reason: "admin_cancel", ref: saved.order_no }))
        );
      }
    }

    if (saved.payment_method === "card" && saved.payment_id) {
      try {
        await portone.cancelPayment(saved.payment_id, cancelReasonStr || "관리자 주문 취소");
        cancelResult = { refund: "card", ok: true };
      } catch (refundErr) {
        console.error("[admin/orders] ⚠️ 취소 시 환불 실패 — 수동 확인 필요:", saved.order_no, refundErr.message);
        sendAdminRefundFailed({ orderNo: saved.order_no, amount: saved.total, error: refundErr.message }).catch((err) =>
          console.error("[mailer] 환불 실패 긴급 알림 메일 발송 실패:", err.message)
        );
        logSystemError("refund_failed", { orderNo: saved.order_no, amount: saved.total, error: refundErr.message, source: "order_cancel" });
        cancelResult = { refund: "card", ok: false };
      }
    } else if (saved.payment_method === "bank_transfer") {
      cancelResult = { refund: "bank_manual", ok: false };
    }

    sendCustomerOrderCancelled(saved, cancelReasonStr).catch((err) =>
      console.error("[mailer] 주문취소 안내 메일 발송 실패:", err.message)
    );
    kakao.sendAlimtalk("ORDER_CANCELLED", saved.customer.tel, { name: saved.customer.name, orderNo: saved.order_no }).catch(() => {});
  }

  let uncancelResult = null;
  if (isUncancel) {
    const decrementItems = restoreItemsFromOrder(saved.items);
    if (decrementItems.length) {
      const { error: decError } = await supabaseAdmin.rpc("decrement_inventory", { p_items: decrementItems });
      if (decError) {
        /* 취소 때 복원된 재고가 그 사이 다른 주문에 이미 팔렸을 수 있다(품절) — 이 경우
           되돌리기 자체를 막지는 않는다(관리자가 이미 상태를 바꾸기로 결정한 것이므로),
           대신 재고가 마이너스로 안 꺾이게 막혔다는 걸 시스템 오류로 남겨 수동 확인을 유도한다. */
        console.error("[admin/orders] 취소 되돌리기 시 재고 재차감 실패 — 수동 확인 필요:", saved.order_no, decError.message);
        logSystemError("order_uncancel_inventory_conflict", { orderNo: saved.order_no, error: decError.message });
        uncancelResult = { inventoryRestored: false };
      } else {
        logInventoryChange(
          decrementItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: -it.qty, reason: "admin_uncancel", ref: saved.order_no }))
        );
        uncancelResult = { inventoryRestored: true };
      }
    }
    if (saved.payment_method === "card" && saved.payment_id) {
      /* 취소 시 이미 포트원 환불이 나갔다면, API로 자동 재청구(un-refund)는 할 수 없다 —
         결제를 되돌리려면 고객에게 새로 결제를 받아야 한다. 조용히 넘어가면 관리자가
         "상태만 되돌리면 결제도 같이 산다"고 착각할 수 있어 시스템 오류로 남긴다. */
      logSystemError("order_uncancelled_card_payment_not_restored", { orderNo: saved.order_no, paymentId: saved.payment_id });
      uncancelResult = { ...(uncancelResult || {}), paymentNote: "card_refund_not_reversible" };
    }
  }

  logAdminAction(req, "order.update", "order", req.params.no, patch);
  res.json({ ok: true, cancel: cancelResult, uncancel: uncancelResult });
});

/* 반품 신청 목록 필터 — orders와 같은 규칙(q는 주문번호·이름·연락처 부분 일치, dateFrom/dateTo는 KST 하루 범위). */
function applyReturnFilters(query, reqQuery) {
  const { q, status, dateFrom, dateTo } = reqQuery;
  if (q) {
    const v = String(q).trim().slice(0, 60).replace(/[%,()]/g, "");
    if (v) query = query.or(`order_no.ilike.%${v}%,contact_name.ilike.%${v}%,contact_tel.ilike.%${v}%`);
  }
  if (status) query = query.eq("status", status);
  query = applyKstDateRangeFilter(query, "created_at", dateFrom, dateTo);
  return query;
}

app.get("/api/admin/returns", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query);
  let query = supabaseAdmin
    .from("return_requests")
    .select("id, order_no, contact_name, contact_tel, reason, detail, status, restocked, refunded, created_at", { count: "exact" })
    .order("created_at", { ascending: false });
  query = applyReturnFilters(query, req.query);
  const { data, error, count } = await query.range(from, to);

  if (error) return res.status(500).json({ error: "반품 신청 목록을 불러오지 못했습니다." });

  res.json({
    items: data.map((r) => ({
      id: r.id,
      orderNo: r.order_no,
      contactName: r.contact_name,
      contactTel: r.contact_tel,
      reason: r.reason,
      detail: r.detail,
      status: r.status,
      restocked: r.restocked,
      refunded: r.refunded,
      at: r.created_at,
    })),
    page,
    pageSize,
    total: count ?? data.length,
  });
});

/* 반품 승인 시 카드결제 자동환불 — status가 (처음으로) "완료"가 되는 순간, 해당 주문이 카드결제
   건이면 포트원 환불을 자동으로 시도한다. 무통장입금은 계좌로 직접 돈을 보내야 해서 API로 할 수
   없다 — 그 경우 화면에 "직접 환불하라"고만 알려준다. 환불 시도 자체가 실패하면(카드 결제는 됐는데
   자동환불도 실패) 관리자가 놓치기 쉬운 상황이라 즉시 긴급 메일을 보낸다(카드결제 이중실패 알림과
   같은 원칙). refunded 플래그로 같은 반품을 두 번 환불 시도하지 않게 막는다. */
app.patch("/api/admin/returns/:id", requireAdmin, async (req, res) => {
  const statusStr = String((req.body || {}).status || "").trim();
  if (!statusStr) {
    return res.status(400).json({ error: "status가 필요합니다." });
  }

  const { data: prev, error: prevError } = await supabaseAdmin
    .from("return_requests")
    .select("id, order_no, status, refunded, contact_name, contact_tel")
    .eq("id", req.params.id)
    .single();
  if (prevError || !prev) return res.status(404).json({ error: "반품 신청을 찾을 수 없습니다." });

  const { error } = await supabaseAdmin.from("return_requests").update({ status: statusStr }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "상태 변경에 실패했습니다." });
  logAdminAction(req, "return.update", "return", req.params.id, { status: statusStr });

  let refund = null;
  if (statusStr === "완료" && prev.status !== "완료" && !prev.refunded) {
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("payment_method, payment_id, total")
      .eq("order_no", prev.order_no)
      .maybeSingle();

    if (order && order.payment_method === "card" && order.payment_id) {
      try {
        await portone.cancelPayment(order.payment_id, "반품 승인에 따른 환불");
        await supabaseAdmin.from("return_requests").update({ refunded: true }).eq("id", prev.id);
        logAdminAction(req, "return.refund", "return", req.params.id, { orderNo: prev.order_no, amount: order.total });
        kakao.sendAlimtalk("REFUND_COMPLETED", prev.contact_tel, { name: prev.contact_name, orderNo: prev.order_no, amount: order.total }).catch(() => {});
        refund = { method: "card", ok: true };
      } catch (refundErr) {
        console.error("[return] ⚠️ 반품 승인 환불 실패 — 수동 확인 필요:", prev.order_no, refundErr.message);
        sendAdminRefundFailed({ orderNo: prev.order_no, amount: order.total, error: refundErr.message }).catch((err) =>
          console.error("[mailer] 환불 실패 긴급 알림 메일 발송 실패:", err.message)
        );
        logSystemError("refund_failed", { orderNo: prev.order_no, amount: order.total, error: refundErr.message, source: "return_approval" });
        refund = { method: "card", ok: false };
      }
    } else if (order && order.payment_method === "bank_transfer") {
      refund = { method: "bank_manual", ok: false };
    }
  }

  res.json({ ok: true, refund });
});

/* 반품 승인 시 재고 복원 — return_requests는 주문번호만 갖고 있고 어떤 항목을 반품했는지는
   따로 기록하지 않으므로(전체 반품 전제), 해당 주문의 전체 항목을 복원한다. 부분 반품이면
   관리자가 이 버튼 대신 재고 탭에서 직접 수량을 조정해야 한다. 중복 복원(재고가 두 번 늘어나는
   사고)을 막기 위해 restocked 플래그로 한 번만 허용한다. */
app.post("/api/admin/returns/:id/restock", requireAdmin, async (req, res) => {
  const { data: ret, error: retError } = await supabaseAdmin
    .from("return_requests")
    .select("id, order_no, restocked")
    .eq("id", req.params.id)
    .single();
  if (retError || !ret) return res.status(404).json({ error: "반품 신청을 찾을 수 없습니다." });
  if (ret.restocked) return res.status(400).json({ error: "이미 재고를 복원한 반품입니다." });

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("order_no, items")
    .eq("order_no", ret.order_no)
    .single();
  if (orderError || !order) return res.status(404).json({ error: "연결된 주문을 찾을 수 없습니다." });

  const restoreItems = restoreItemsFromOrder(order.items);

  if (!restoreItems.length) {
    return res.status(400).json({ error: "이 주문에는 자동으로 복원할 재고 정보가 없습니다(이전 방식으로 만들어진 주문). 재고 탭에서 직접 조정해 주세요." });
  }

  const { error: restoreError } = await supabaseAdmin.rpc("restore_inventory", { p_items: restoreItems });
  if (restoreError) return res.status(500).json({ error: "재고 복원에 실패했습니다." });

  logInventoryChange(
    restoreItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: it.qty, reason: "return_restock", ref: ret.order_no }))
  );
  await supabaseAdmin.from("return_requests").update({ restocked: true }).eq("id", ret.id);
  logAdminAction(req, "return.restock", "return", req.params.id, { orderNo: ret.order_no, items: restoreItems });

  res.json({ ok: true });
});

app.get("/api/admin/inventory", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("inventory")
    .select("product_id, color, size, qty")
    .order("product_id", { ascending: true });

  if (error) return res.status(500).json({ error: "재고를 불러오지 못했습니다." });
  res.json(data.map((r) => ({ productId: r.product_id, color: r.color, size: r.size, qty: r.qty })));
});


/* 품절 알림 신청(routes/restock.js에서 접수)한 고객에게 재입고를 알린다 — 재고 수량이
   실제로 바뀌는 지점이 여기(관리자 재고 탭 저장)뿐이라 알림 발송도 여기서 처리한다.
   restockedItems: [{productId, color, size, qty}] (이미 0→양수 전환된 것만 걸러진 상태로 들어옴). */
async function notifyRestockSubscribers(restockedItems) {
  const orFilter = restockedItems
    .map((it) => `and(product_id.eq.${it.productId},color.eq.${it.color},size.eq.${it.size})`)
    .join(",");
  const { data: subs, error } = await supabaseAdmin
    .from("restock_subscriptions")
    .select("id, product_id, color, size, email")
    .is("notified_at", null)
    .or(orFilter);
  if (error) {
    if (isMissingSchemaError(error)) return; // 025 마이그레이션 미실행 — 조용히 건너뜀
    console.error("[restock] 신청 목록 조회 실패:", error.message);
    return;
  }
  if (!subs.length) return;

  const productIds = [...new Set(subs.map((s) => s.product_id))];
  const { data: products } = await supabaseAdmin.from("products").select("id, name_ko").in("id", productIds);
  const nameById = new Map((products || []).map((p) => [p.id, p.name_ko]));

  const notifiedIds = [];
  for (const sub of subs) {
    try {
      await sendCustomerRestockNotice({
        email: sub.email,
        productId: sub.product_id,
        productName: nameById.get(sub.product_id) || sub.product_id,
        color: sub.color,
        size: sub.size,
      });
      notifiedIds.push(sub.id);
    } catch (err) {
      console.error("[mailer] 품절 알림 메일 발송 실패:", err.message);
    }
  }
  if (notifiedIds.length) {
    await supabaseAdmin.from("restock_subscriptions").update({ notified_at: new Date().toISOString() }).in("id", notifiedIds);
  }
}

/* 재고 탭에서 칸마다 바로바로 저장하던 방식은 몇 칸만 고쳐도 토스트가 계속 뜨고 활동 로그도
   항목 수만큼 따로 쌓여 지저분했다 — Works가 "고치고 나서 저장 버튼 한 번"으로 통일되면서
   이 엔드포인트로 여러 항목을 한 번에 받아 한 번의 활동 로그로 남긴다(위 단일 항목용
   PATCH /api/admin/inventory는 다른 소비자가 없어 그대로 남겨두되 이 탭에서는 더 이상 쓰지 않는다). */
app.patch("/api/admin/inventory/bulk", requireAdmin, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "items가 필요합니다." });
  if (items.length > 500) return res.status(400).json({ error: "한 번에 저장할 수 있는 항목이 너무 많습니다." });

  const normalized = [];
  for (const it of items) {
    const productId = it && it.productId;
    const colorStr = String((it && it.color) || "");
    const size = it && it.size;
    const qtyNum = Math.floor(Number(it && it.qty));
    if (!productId || !colorStr || !size || !Number.isFinite(qtyNum) || qtyNum < 0) {
      return res.status(400).json({ error: "각 항목은 productId, color, size, qty(0 이상)가 필요합니다." });
    }
    normalized.push({ productId, color: colorStr, size, qty: qtyNum });
  }

  const productIds = [...new Set(normalized.map((it) => it.productId))];
  const { data: prevRows } = await supabaseAdmin
    .from("inventory")
    .select("product_id, color, size, qty")
    .in("product_id", productIds);
  const prevQty = new Map((prevRows || []).map((r) => [`${r.product_id}:${r.color}:${r.size}`, r.qty]));

  const { error } = await supabaseAdmin
    .from("inventory")
    .upsert(
      normalized.map((it) => ({ product_id: it.productId, color: it.color, size: it.size, qty: it.qty })),
      { onConflict: "product_id,color,size" }
    );
  if (error) return res.status(500).json({ error: "재고 저장에 실패했습니다." });

  const logRows = normalized
    .map((it) => ({
      productId: it.productId,
      color: it.color,
      size: it.size,
      delta: it.qty - (prevQty.get(`${it.productId}:${it.color}:${it.size}`) || 0),
      reason: "admin_adjust",
      adminEmail: req.user.email,
    }))
    .filter((r) => r.delta !== 0);
  if (logRows.length) logInventoryChange(logRows);

  /* 품절 알림 신청(025_restock_subscriptions.sql) — 이 조합이 방금 0 이하 → 양수로 바뀐
     경우에만 그 조합을 기다리던 신청자들에게 메일을 보낸다. 응답을 늦추면 안 되니 백그라운드로
     돌리고 실패해도 재고 저장 자체는 이미 끝난 뒤라 그대로 둔다. */
  const restocked = normalized.filter((it) => it.qty > 0 && (prevQty.get(`${it.productId}:${it.color}:${it.size}`) || 0) <= 0);
  if (restocked.length) notifyRestockSubscribers(restocked).catch((err) => console.error("[restock] 알림 처리 실패:", err.message));

  logAdminAction(req, "inventory.bulk_update", "inventory", `${normalized.length}건`, { count: normalized.length, productIds });
  res.json({ ok: true, count: normalized.length });
});

/* 재고 변동 이력 조회 — productId로 좁혀서 최근 변동부터 보여준다(전체 상품을 한 번에 보여주기엔
   너무 많다). 재고 탭의 상품 카드에서 "이력 보기"를 눌렀을 때 쓴다. */
app.get("/api/admin/inventory/log", requireAdmin, async (req, res) => {
  const { productId } = req.query;
  if (!productId) return res.status(400).json({ error: "productId가 필요합니다." });

  const { data, error } = await supabaseAdmin
    .from("inventory_log")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: "재고 이력을 불러오지 못했습니다." });
  res.json(
    data.map((r) => ({
      color: r.color,
      size: r.size,
      delta: r.delta,
      reason: r.reason,
      ref: r.ref,
      adminEmail: r.admin_email,
      at: r.created_at,
    }))
  );
});

/* 재고 내보내기 — inventory에는 상품명이 없어(product_id만 있음) products와 조인해 이름을 붙인다.
   화면(재고 탭)의 상품코드 순 정렬을 그대로 따른다. ?format=csv|xlsx */
const INVENTORY_EXPORT_COLUMNS = [
  { key: "productId", label: "상품 ID" },
  { key: "nameKo", label: "상품명" },
  { key: "color", label: "컬러" },
  { key: "size", label: "사이즈" },
  { key: "qty", label: "재고수량" },
];
app.get("/api/admin/inventory/export", requireAdmin, async (req, res) => {
  const format = String(req.query.format || "csv").toLowerCase();
  if (!["csv", "xlsx"].includes(format)) {
    return res.status(400).json({ error: "format은 csv, xlsx 중 하나여야 합니다." });
  }

  const [{ data: invRows, error: invError }, { data: productRows, error: prodError }] = await Promise.all([
    supabaseAdmin.from("inventory").select("product_id, color, size, qty").order("product_id", { ascending: true }),
    supabaseAdmin.from("products").select("id, name_ko"),
  ]);
  if (invError || prodError) return res.status(500).json({ error: "재고를 불러오지 못했습니다." });

  const nameById = new Map((productRows || []).map((p) => [p.id, p.name_ko]));
  const rows = invRows.map((r) => ({
    productId: r.product_id,
    nameKo: nameById.get(r.product_id) || r.product_id,
    color: r.color,
    size: r.size,
    qty: r.qty,
  }));

  const filename = `reiten-inventory-${new Date().toISOString().slice(0, 10)}`;
  try {
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
      res.send(toCsvGeneric([{ title: "재고", columns: INVENTORY_EXPORT_COLUMNS, rows }]));
    } else {
      const buf = await toXlsxBufferGeneric([{ name: "재고", columns: INVENTORY_EXPORT_COLUMNS, rows }]);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
      res.send(Buffer.from(buf));
    }
    logAdminAction(req, "inventory.export", "inventory", "export", { format, count: rows.length });
  } catch (e) {
    console.error("[admin/inventory/export] 생성 실패:", e.message);
    res.status(500).json({ error: "내보내기 파일 생성에 실패했습니다." });
  }
});

/* ---------- 쿠폰(할인코드) ----------
   할인 유무·적용 상품·기간·사용횟수 전부 관리자가 자유롭게 만들 수 있게 한다(013_coupons.sql).
   실제 유효성 검사·할인 계산은 resolveCoupon/couponDiscount(주문 생성 경로에서 재사용)가 맡고,
   여기는 순수 CRUD만 담당한다. */
function toCouponDto(c) {
  return {
    code: c.code,
    discountType: c.discount_type,
    discountValue: c.discount_value,
    scope: c.scope,
    productIds: c.product_ids || [],
    minSubtotal: c.min_subtotal,
    usageLimit: c.usage_limit,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    active: c.active,
    createdAt: c.created_at,
  };
}

function couponPatchFromBody(body, { forCreate, existingDiscountType }) {
  const patch = {};
  if (forCreate || body.discountType !== undefined) {
    if (!["percent", "amount"].includes(body.discountType)) {
      return { error: "discountType은 percent 또는 amount여야 합니다." };
    }
    patch.discount_type = body.discountType;
  }
  if (forCreate || body.discountValue !== undefined) {
    const v = Math.floor(Number(body.discountValue));
    if (!Number.isFinite(v) || v <= 0) return { error: "discountValue는 0보다 큰 숫자여야 합니다." };
    /* discountType을 이번 요청에 안 보내는 PATCH(예: discountValue만 수정)라도, 그 쿠폰이
       DB에 이미 percent로 저장돼 있으면 여전히 100을 넘으면 안 된다 — body.discountType만
       보면 이 경우를 놓쳐서 API를 직접 호출하면 상한 우회가 가능했다. */
    if ((body.discountType || patch.discount_type || existingDiscountType) === "percent" && v > 100) {
      return { error: "정률 할인은 100을 넘을 수 없습니다." };
    }
    patch.discount_value = v;
  }
  if (forCreate || body.scope !== undefined) {
    if (!["all", "products"].includes(body.scope)) return { error: "scope는 all 또는 products여야 합니다." };
    patch.scope = body.scope;
  }
  if (forCreate || body.productIds !== undefined) {
    patch.product_ids = Array.isArray(body.productIds) ? body.productIds.filter((id) => typeof id === "string") : [];
  }
  if (forCreate || body.minSubtotal !== undefined) {
    patch.min_subtotal = Math.max(0, Math.floor(Number(body.minSubtotal) || 0));
  }
  if (body.usageLimit !== undefined) {
    patch.usage_limit = body.usageLimit === null || body.usageLimit === "" ? null : Math.max(1, Math.floor(Number(body.usageLimit)));
  }
  if (body.startsAt !== undefined) patch.starts_at = body.startsAt || null;
  if (body.endsAt !== undefined) patch.ends_at = body.endsAt || null;
  if (body.active !== undefined) patch.active = Boolean(body.active);
  return { patch };
}

app.get("/api/admin/coupons", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("coupons").select("*").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: "쿠폰 목록을 불러오지 못했습니다." });
  res.json(data.map(toCouponDto));
});

app.post("/api/admin/coupons", requireAdmin, async (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase().slice(0, 40);
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    return res.status(400).json({ error: "코드는 영문 대문자·숫자·하이픈·언더바 3~40자여야 합니다." });
  }
  const { patch, error: patchError } = couponPatchFromBody(req.body || {}, { forCreate: true });
  if (patchError) return res.status(400).json({ error: patchError });

  const { data, error } = await supabaseAdmin.from("coupons").insert({ code, ...patch }).select().single();
  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "이미 존재하는 쿠폰 코드입니다." });
    return res.status(500).json({ error: "쿠폰 생성에 실패했습니다." });
  }
  logAdminAction(req, "coupon.create", "coupon", code, patch);
  res.json(toCouponDto(data));
});

app.patch("/api/admin/coupons/:code", requireAdmin, async (req, res) => {
  const { data: existing } = await supabaseAdmin
    .from("coupons")
    .select("discount_type")
    .eq("code", req.params.code.toUpperCase())
    .maybeSingle();
  const { patch, error: patchError } = couponPatchFromBody(req.body || {}, {
    forCreate: false,
    existingDiscountType: existing?.discount_type,
  });
  if (patchError) return res.status(400).json({ error: patchError });
  if (!Object.keys(patch).length) return res.status(400).json({ error: "변경할 값이 없습니다." });

  const { data, error } = await supabaseAdmin
    .from("coupons")
    .update(patch)
    .eq("code", req.params.code.toUpperCase())
    .select()
    .single();
  if (error) return res.status(500).json({ error: "쿠폰 수정에 실패했습니다." });
  logAdminAction(req, "coupon.update", "coupon", req.params.code, patch);
  res.json(toCouponDto(data));
});

app.delete("/api/admin/coupons/:code", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("coupons").delete().eq("code", req.params.code.toUpperCase());
  if (error) return res.status(500).json({ error: "쿠폰 삭제에 실패했습니다." });
  logAdminAction(req, "coupon.delete", "coupon", req.params.code);
  res.json({ ok: true });
});

/* 고객 화면(장바구니)에서 코드를 입력했을 때 실시간으로 할인액을 미리 보여주기 위한 공개 엔드포인트.
   실제 할인은 여기서 확정되는 게 아니라 /api/order·/api/payments/prepare가 다시 한번 resolveCoupon을
   불러 서버에서 재계산한다 — 이 엔드포인트는 순전히 미리보기용이라 위·변조돼도 결제 금액엔 영향 없다. */
app.post("/api/coupons/validate", writeLimiter, async (req, res) => {
  const { code, items: rawItems } = req.body || {};
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return res.status(400).json({ error: "장바구니 항목이 없습니다." });
  }
  const products = await getActiveProducts();
  const items = rawItems.map((raw) => priceItem(raw, products, PRICE_OPTS));
  if (items.some((it) => it === null)) {
    return res.status(400).json({ error: "존재하지 않는 상품 또는 잘못된 수량이 포함되어 있습니다." });
  }
  const subtotal = items.reduce((s, it) => s + it.sum, 0);

  try {
    const coupon = await resolveCoupon(supabaseAdmin, code, { rawItems, items, subtotal });
    res.json(coupon);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/* 상품 관리자 CRUD(GET/POST/PATCH/DELETE·일괄 처리·사진 업로드) — 결제·재고와 얽히지 않는
   부분만 routes/products.js로 분리했다(공개 목록 GET /api/products는 결제 가격 검증이 쓰는
   캐시를 공유해 여기 그대로 둔다 — 2026-09-01, 라우트 분리 다음 라운드). */
app.use(productsRoutes);


/* 색상 팔레트(colors) · 룩북(lookbook) · 정보 탭(settings) 라우트는 routes/*.js로 분리됐다
   (2026-09-01) — 돈·재고를 건드리지 않는 순수 CRUD라 여기서는 마운트만 한다. */
app.use(colorsRoutes);
app.use(lookbookRoutes);
app.use(settingsRoutes);

/* 상품 리뷰(공개 GET/POST·공감·관리자 GET/PATCH/bulk-approve/DELETE) — 돈이 걸려 있지 않은
   도메인이라 통째로 routes/reviews.js로 분리했다(2026-09-01, 라우트 분리 다음 라운드). */
app.use(reviewsRoutes);

/* 품절 알림 신청 접수(POST /api/restock-subscriptions) — 실제 알림 발송은 아래
   PATCH /api/admin/inventory/bulk 안에서 처리한다(재고 수량 변화를 아는 곳이 거기뿐이라). */
app.use(restockRoutes);

/* Works 브라우저 푸시 알림 구독 관리(GET public-key, POST/DELETE subscribe) — 실제 발송은
   새 주문 접수 시점(위 finalizeCardOrder·POST /api/order)에서 sendPushToAdmins()로 처리한다. */
app.use(pushRoutes);

/* 상품 Q&A + CS 빠른 답변 템플릿 라우트도 routes/qna.js로 분리됐다(2026-09-01) — 돈·재고를
   건드리지 않는 순수 CRUD라 여기서는 마운트만 한다. */
app.use(qnaRoutes);


/* ---------- 미입금 주문 자동취소 ----------
   고객 화면에는 "24시간 내 미입금 시 자동 취소됩니다"라고 안내한다(2026-08-14부터 3일→24시간
   으로 단축). 매시 정각에 24시간 넘게 "입금대기" 상태인 주문을 찾아 취소하고 재고를 되돌린다. */
const PENDING_CANCEL_HOURS = 24;

async function cancelStalePendingOrders() {
  const cutoff = new Date(Date.now() - PENDING_CANCEL_HOURS * 3600 * 1000).toISOString();
  const { data: stale, error } = await supabaseAdmin
    .from("orders")
    .select("id, order_no, items, customer, subtotal, shipping, total, created_at")
    .eq("status", "입금대기")
    .lt("created_at", cutoff);

  if (error) {
    console.error("[auto-cancel] 미입금 주문 조회 실패:", error.message);
    return;
  }
  if (!stale.length) return;

  for (const order of stale) {
    /* SELECT와 이 UPDATE 사이(메일 발송 등으로 시간이 걸림)에 관리자가 이미 "입금확인"으로
       바꿨을 수 있다 — update 조건에도 status="입금대기"를 다시 걸어서, 그 사이 상태가
       바뀐 주문은 여기서 건드리지 않는다(걸지 않으면 방금 정상 처리된 결제를 자동취소로
       덮어쓰는 경쟁 상태가 생김). .select()로 실제 몇 건이 갱신됐는지 확인한다. */
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("orders")
      .update({ status: "취소", cancel_reason: `미입금 ${PENDING_CANCEL_HOURS}시간 경과 자동 취소` })
      .eq("id", order.id)
      .eq("status", "입금대기")
      .select("id");
    if (updateError) {
      console.error("[auto-cancel] 주문 취소 실패:", order.order_no, updateError.message);
      continue;
    }
    if (!updated || !updated.length) {
      console.log(`[auto-cancel] ${order.order_no} — 그 사이 상태가 바뀌어 건너뜀(경쟁 상태 방지)`);
      continue;
    }

    const restoreItems = restoreItemsFromOrder(order.items);
    if (restoreItems.length) {
      const { error: restoreError } = await supabaseAdmin.rpc("restore_inventory", { p_items: restoreItems });
      if (restoreError) {
        console.error("[auto-cancel] 재고 복원 실패:", order.order_no, restoreError.message);
      } else {
        logInventoryChange(
          restoreItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: it.qty, reason: "auto_cancel", ref: order.order_no }))
        );
      }
    }

    sendCustomerAutoCancelled(order).catch((err) => console.error("[mailer] 자동취소 안내 메일 발송 실패:", err.message));
    kakao.sendAlimtalk("ORDER_CANCELLED", order.customer.tel, { name: order.customer.name, orderNo: order.order_no }).catch(() => {});
    console.log(`[auto-cancel] ${order.order_no} 미입금 자동 취소 처리 완료`);
  }
}

cron.schedule("0 * * * *", () => {
  cancelStalePendingOrders().catch((err) => console.error("[auto-cancel] 실행 실패:", err.message));
});

/* ---------- 재입고 발주 알림 ----------
   재고가 0이 되는 "순간"은 이미 sendAdminLowStock으로 즉시 알리고 있다. 하지만 그 상태가
   방치되는 경우(발주를 깜빡함)를 잡아주는 알림은 없었다. inventory_log(재고 변동 이력,
   012_inventory_log.sql)를 거꾸로 훑어서 재고가 마지막으로 "0 이하로 떨어진" 시점을 역산하고,
   그게 RESTOCK_ALERT_DAYS일 이상 지난 조합만 매주 한 번 모아서 알린다(매일 보내면 같은 품절
   건이 몇 주씩 반복 발송되어 스팸이 되므로 주간 다이제스트로 묶는다). */
const RESTOCK_ALERT_DAYS = 7;
/* 발주 추천 수량 계산에 쓰는 조회 기간 — "얼마나 발주해야 할지 모르겠다"는 피드백으로 추가.
   정교한 수요예측 모델이 아니라 "최근 이 정도 팔렸다"를 그대로 보여주는 참고치라 단순하게
   간다(과도한 엔지니어링 지양). */
const RESTOCK_SALES_LOOKBACK_DAYS = 30;

async function findOutOfStockSince(productId, color, size, currentQty) {
  const { data: logs, error } = await supabaseAdmin
    .from("inventory_log")
    .select("delta, created_at")
    .eq("product_id", productId)
    .eq("color", color)
    .eq("size", size)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !logs) return null; // 이력이 없으면 언제부터 품절인지 알 수 없어 건너뛴다
  return findOutOfStockSinceFromLogs(logs, currentQty);
}

/* 최근 RESTOCK_SALES_LOOKBACK_DAYS일간 이 조합이 "주문(order)"으로 얼마나 팔렸는지 합산 —
   발주 추천 수량의 기준치로 쓴다. 품절 기간이 이 창보다 길면 그동안은 못 판 것까지 포함되니
   실제 수요보다 적게 나올 수 있음(메일 문구에도 명시). */
async function recentSalesQty(productId, color, size) {
  const cutoff = new Date(Date.now() - RESTOCK_SALES_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("inventory_log")
    .select("delta")
    .eq("product_id", productId)
    .eq("color", color)
    .eq("size", size)
    .eq("reason", "order")
    .gte("created_at", cutoff);
  if (error || !data) return 0;
  return data.reduce((sum, r) => sum + Math.abs(r.delta), 0);
}

async function checkRestockNeeded() {
  const { data: rows, error } = await supabaseAdmin.from("inventory").select("product_id, color, size, qty").lte("qty", 0);
  if (error) {
    console.error("[restock-alert] 재고 조회 실패:", error.message);
    return;
  }
  if (!rows.length) return;

  const cutoff = Date.now() - RESTOCK_ALERT_DAYS * 24 * 3600 * 1000;
  const overdue = [];
  for (const row of rows) {
    const since = await findOutOfStockSince(row.product_id, row.color, row.size, row.qty);
    if (since && new Date(since).getTime() <= cutoff) overdue.push({ ...row, since });
  }
  if (!overdue.length) return;

  const ids = [...new Set(overdue.map((r) => r.product_id))];
  const { data: products } = await supabaseAdmin.from("products").select("id, name_ko").in("id", ids);
  const nameOf = (id) => products?.find((p) => p.id === id)?.name_ko || id;

  const items = [];
  for (const r of overdue) {
    items.push({
      name: nameOf(r.product_id),
      color: r.color,
      size: r.size,
      daysSince: Math.floor((Date.now() - new Date(r.since).getTime()) / (24 * 3600 * 1000)),
      recommendedQty: await recentSalesQty(r.product_id, r.color, r.size),
    });
  }

  sendAdminRestockAlert(items, RESTOCK_ALERT_DAYS).catch((err) => console.error("[mailer] 재입고 알림 메일 발송 실패:", err.message));
}

cron.schedule("0 9 * * 1", () => {
  checkRestockNeeded().catch((err) => console.error("[restock-alert] 실행 실패:", err.message));
});

/* ---------- 월간 정산 리포트 ----------
   매달 1일 09:00에 "지난달"(KST 기준) 주문·쿠폰·환불 내역을 모아 엑셀(요약/주문상세/쿠폰/환불
   4개 시트)로 정리해 관리자에게 첨부 메일로 보낸다. 세무사에게 그대로 전달하는 용도 —
   신고를 대신하지 않는 원본 데이터 정리이므로 메일 본문에도 그렇게 명시한다(mailer.js 참고). */
async function sendMonthlySettlement() {
  const { startISO: start, endISO: end, monthKey, monthLabel } = kstMonthRangeISO(1);

  const { data: orders, error: ordersError } = await supabaseAdmin
    .from("orders")
    .select("order_no, customer, items, subtotal, shipping, total, status, coupon_code, discount, created_at")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: true });
  if (ordersError) {
    console.error("[settlement] 주문 조회 실패:", ordersError.message);
    return;
  }

  const { data: returns, error: returnsError } = await supabaseAdmin
    .from("return_requests")
    .select("order_no, refunded, reason, created_at")
    .gte("created_at", start)
    .lt("created_at", end);
  if (returnsError) {
    console.error("[settlement] 반품 조회 실패:", returnsError.message);
    return;
  }

  const totalByOrderNo = new Map(orders.map((o) => [o.order_no, o.total]));
  const refunded = returns.filter((r) => r.refunded);
  const refundTotal = refunded.reduce((sum, r) => sum + (totalByOrderNo.get(r.order_no) || 0), 0);
  const revenue = orders.filter((o) => o.status !== "취소").reduce((sum, o) => sum + o.total, 0);
  const couponOrders = orders.filter((o) => o.coupon_code);
  const couponDiscount = couponOrders.reduce((sum, o) => sum + (o.discount || 0), 0);

  const summary = {
    monthKey,
    totalOrders: orders.length,
    revenue,
    couponOrders: couponOrders.length,
    couponDiscount,
    refundCount: refunded.length,
    refundTotal,
    netRevenue: revenue - refundTotal,
  };

  const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";
  const sheets = [
    {
      name: "요약",
      columns: [{ key: "label", label: "항목" }, { key: "value", label: "값" }],
      rows: [
        { label: "기간", value: monthLabel },
        { label: "총 주문 건수", value: `${summary.totalOrders}건` },
        { label: "매출(취소 제외)", value: won(summary.revenue) },
        { label: "쿠폰 사용 건수", value: `${summary.couponOrders}건` },
        { label: "쿠폰 할인 합계", value: won(summary.couponDiscount) },
        { label: "환불 건수", value: `${summary.refundCount}건` },
        { label: "환불 합계", value: won(summary.refundTotal) },
        { label: "순매출(매출-환불)", value: won(summary.netRevenue) },
      ],
    },
    {
      name: "주문상세",
      columns: [
        { key: "orderNo", label: "주문번호" }, { key: "at", label: "주문일시" }, { key: "name", label: "주문자" },
        { key: "itemsText", label: "주문상품" }, { key: "subtotal", label: "소계" }, { key: "shipping", label: "배송비" },
        { key: "couponCode", label: "쿠폰코드" }, { key: "discount", label: "할인액" }, { key: "total", label: "합계" },
        { key: "status", label: "상태" },
      ],
      rows: orders.map((o) => ({
        orderNo: o.order_no,
        at: fmtExportDate(o.created_at),
        name: (o.customer || {}).name || "",
        itemsText: (o.items || []).map((it) => `${it.name} x${it.qty}`).join(", "),
        subtotal: o.subtotal,
        shipping: o.shipping,
        couponCode: o.coupon_code || "",
        discount: o.discount || 0,
        total: o.total,
        status: o.status,
      })),
    },
    {
      name: "쿠폰 사용 내역",
      columns: [
        { key: "couponCode", label: "쿠폰코드" }, { key: "orderNo", label: "주문번호" },
        { key: "discount", label: "할인액" }, { key: "at", label: "주문일시" },
      ],
      rows: couponOrders.map((o) => ({ couponCode: o.coupon_code, orderNo: o.order_no, discount: o.discount || 0, at: fmtExportDate(o.created_at) })),
    },
    {
      name: "환불 내역",
      columns: [
        { key: "orderNo", label: "주문번호" }, { key: "refundAmount", label: "환불액" },
        { key: "reason", label: "사유" }, { key: "at", label: "처리일시" },
      ],
      rows: refunded.map((r) => ({
        orderNo: r.order_no,
        refundAmount: totalByOrderNo.get(r.order_no) || 0,
        reason: r.reason || "",
        at: fmtExportDate(r.created_at),
      })),
    },
  ];

  const buffer = await toXlsxBufferGeneric(sheets);
  sendAdminSettlementReport({ monthLabel, summary, buffer }).catch((err) =>
    console.error("[mailer] 정산 리포트 메일 발송 실패:", err.message)
  );
}

cron.schedule("0 9 1 * *", () => {
  sendMonthlySettlement().catch((err) => console.error("[settlement] 실행 실패:", err.message));
});

/* ---------- 라우트 등록 순서 검사 (재발 방지) ----------
   2026-09-01 코드 감사에서 발견된 버그 — Express는 라우트를 등록 순서대로 매칭하는데,
   `PATCH /api/admin/products/:id`처럼 파라미터가 있는 라우트가 `PATCH .../bulk-active`
   같은 리터럴 경로보다 먼저 등록되면 ":id"가 그 문자열 자체를 파라미터 값으로 오인해
   가로채 버린다. 이번에 세 곳(상품·주문·리뷰 일괄 처리)을 사람이 직접 찾아 고쳤지만,
   "주석으로 기억하기"에만 의존하면 다음에 새 라우트를 추가하는 세션이 또 똑같이 실수할 수
   있다 — 그래서 서버가 뜰 때마다 실제 등록된 모든 라우트(중첩된 라우터 포함)를 검사해서,
   이런 충돌이 하나라도 있으면 기동 자체를 막는다. 로컬에서 `npm start`만 해도 바로 드러나고,
   Render 배포도 크래시로 실패하니 "배포된 채로 몇 주간 조용히 죽어있던" 사고가 구조적으로
   불가능해진다. */
function assertNoRouteShadowing(expressApp) {
  const entries = [];
  let order = 0;

  function walk(stack) {
    for (const layer of stack) {
      if (layer.route) {
        const routePath = layer.route.path;
        const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
        const segments = String(routePath).split("/").filter(Boolean);
        for (const method of methods) entries.push({ method, segments, order: order++, path: routePath });
      } else if (layer.name === "router" && layer.handle && layer.handle.stack) {
        walk(layer.handle.stack);
      }
    }
  }
  walk(expressApp._router.stack);

  // earlier(파라미터 포함)가 later(전부 리터럴)와 세그먼트 개수가 같고, 파라미터 자리를 뺀
  // 나머지 리터럴 세그먼트가 전부 일치하면 later를 완전히 가릴 수 있다는 뜻이다.
  function paramShadowsLiteral(paramSegments, literalSegments) {
    if (paramSegments.length !== literalSegments.length) return false;
    for (let i = 0; i < paramSegments.length; i++) {
      const p = paramSegments[i];
      if (p.startsWith(":")) continue;
      if (p !== literalSegments[i]) return false;
    }
    return true;
  }

  const byMethod = new Map();
  for (const e of entries) {
    if (!byMethod.has(e.method)) byMethod.set(e.method, []);
    byMethod.get(e.method).push(e);
  }

  const problems = [];
  for (const list of byMethod.values()) {
    for (const earlier of list) {
      if (!earlier.segments.some((s) => s.startsWith(":"))) continue; // 파라미터가 없으면 아무것도 못 가림
      for (const later of list) {
        if (later.order <= earlier.order) continue;
        const laterIsLiteral = later.segments.every((s) => !s.startsWith(":"));
        if (laterIsLiteral && paramShadowsLiteral(earlier.segments, later.segments)) {
          problems.push(`${earlier.method.toUpperCase()} ${earlier.path} (먼저 등록됨)이 ${later.method.toUpperCase()} ${later.path} (나중에 등록됨)를 가립니다`);
        }
      }
    }
  }

  if (problems.length) {
    throw new Error("라우트 등록 순서 충돌 발견 — 리터럴 경로는 반드시 :param 라우트보다 먼저 등록해야 합니다:\n" + problems.join("\n"));
  }
}
assertNoRouteShadowing(app);

if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.listen(PORT, () => {
  console.log(`REITEN server running at http://localhost:${PORT}`);
});
