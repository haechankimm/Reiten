require("dotenv").config();
const crypto = require("crypto");
const Sentry = require("@sentry/node");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const { SITE, PRODUCTS: STATIC_PRODUCTS, LOOKBOOK: STATIC_LOOKBOOK, CHARM_PRICE, EXTRA_PRICE, EXTRAS, COURIERS } = require("../소스 코드/assets/js/data.js");
const { supabaseAdmin } = require("./lib/supabase");
const { requireAuth, optionalAuth, requireAdmin } = require("./lib/auth");
const {
  sendOrderNotification,
  sendCustomerOrderReceived,
  sendCustomerPaymentConfirmed,
  sendCustomerShipped,
  sendAdminLowStock,
  sendAdminCardPaid,
  sendCustomerCardPaid,
} = require("./lib/mailer");
const { uploadReviewPhoto, uploadProductPhoto, uploadLookbookPhoto } = require("./lib/cloudinary");
const { orderNo, priceItem, shippingFor } = require("./lib/pricing");
const { toProductDto, productPatchFromBody } = require("./lib/products");
const { toLookbookDto, lookbookPatchFromBody } = require("./lib/lookbook");
const { paginationParams } = require("./lib/pagination");
const portone = require("./lib/portone");

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

/* 정적 페이지가 인라인 <script>와 jsDelivr(Pretendard 폰트, Supabase JS)에 의존하므로
   CSP는 켜지 않는다 — 나머지 보안 헤더(X-Frame-Options, X-Content-Type-Options 등)만 적용 */
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// 전체 API 남용 방지 (기본): IP당 15분에 300회
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

// 주문/리뷰/문의/반품/조회처럼 쓰기·조회 남용 여지가 큰 엔드포인트는 더 엄격하게: IP당 15분에 20회
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
});

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
   (사이트별로 중복 보관하지 않음). API·인증·DB는 완전히 동일한 이 서버 인스턴스를 쓴다. */
app.use((req, res, next) => {
  if (req.hostname === "works.reiten.kr") {
    return express.static(WORKS_DIR)(req, res, next);
  }
  next();
});

/* works.reiten.kr DNS/Custom Domain 연결 전에도 먼저 써볼 수 있도록 임시로 열어둔 경로.
   works/index.html이 절대경로(/assets/...)로 자산을 불러오므로 이 프리픽스 아래에서도 정상 동작한다.
   works.reiten.kr가 실제로 연결되면 이 라우트는 지워도 된다. */
app.use("/__works-preview", express.static(WORKS_DIR));

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
async function getActiveProducts() {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[products] DB 조회 실패, 정적 목록으로 폴백:", error.message);
    return STATIC_PRODUCTS;
  }
  return withRealSoldOut(data.map(toProductDto));
}

/* 관리자가 손으로 체크하는 soldOut 배열과 실제 결제 시 차감되는 inventory 테이블이 서로 다른
   값을 가질 수 있다(주문으로 실재고가 0이 돼도 관리자가 체크박스를 갱신하기 전까지는 반영 안 됨,
   또는 사이즈 행 자체가 아직 없어 항상 재고 0으로 취급됨 — 001_init.sql 참고). 고객 화면에 내려줄
   때는 관리자가 체크한 soldOut과 실재고 0(또는 행 없음)인 사이즈를 합쳐서, 실제로는 주문이 막히는
   사이즈가 "구매 가능"으로 보이는 일이 없게 한다. */
async function withRealSoldOut(products) {
  if (!products.length) return products;
  const ids = products.map((p) => p.id);
  const { data, error } = await supabaseAdmin.from("inventory").select("product_id, size, qty").in("product_id", ids);
  if (error) {
    console.error("[products] 재고 조회 실패, 관리자가 입력한 품절 정보만 사용:", error.message);
    return products;
  }
  const qtyByProduct = new Map();
  for (const row of data) {
    if (!qtyByProduct.has(row.product_id)) qtyByProduct.set(row.product_id, new Map());
    qtyByProduct.get(row.product_id).set(row.size, row.qty);
  }
  return products.map((p) => {
    const qtyBySize = qtyByProduct.get(p.id);
    const outOfStock = (p.sizes || []).filter((size) => !qtyBySize || (qtyBySize.get(size) ?? 0) <= 0);
    if (!outOfStock.length) return p;
    return { ...p, soldOut: [...new Set([...(p.soldOut || []), ...outOfStock])] };
  });
}

async function getAllProductIds() {
  const { data, error } = await supabaseAdmin.from("products").select("id");
  if (error) return STATIC_PRODUCTS.map((p) => p.id);
  return data.map((r) => r.id);
}

app.get("/api/products", async (req, res) => {
  res.json(await getActiveProducts());
});

const REQUIRED_CUSTOMER_FIELDS = ["name", "tel", "email", "zip", "addr", "payer"];
const PRICE_OPTS = { extras: EXTRAS, charmPrice: CHARM_PRICE, extraPrice: EXTRA_PRICE };

/* ---------- 카드결제(포트원) ----------
   결제창을 열기 전에 서버가 먼저 금액을 계산해서 pending_payments에 저장해두고, 그 값 그대로
   결제창에 넘긴다(사전검증) — 브라우저에서 금액을 조작해도 결제창에 표시되는 금액 자체가
   서버 계산값이라 소용없다. 결제가 끝나면 /api/order가 paymentId로 다시 포트원에 물어봐서
   실제로 그 금액만큼 결제됐는지 확인한 뒤에만 주문을 만든다(사후검증, 009_card_payments.sql 참고). */
app.post("/api/payments/prepare", writeLimiter, async (req, res) => {
  if (!portone.isConfigured()) {
    return res.status(503).json({ error: "카드결제가 아직 준비되지 않았습니다." });
  }

  const { customer, items: rawItems } = req.body || {};
  if (!customer || typeof customer !== "object") {
    return res.status(400).json({ error: "customer 정보가 없습니다." });
  }
  const missing = REQUIRED_CUSTOMER_FIELDS.filter((f) => !String(customer[f] || "").trim());
  if (missing.length) {
    return res.status(400).json({ error: `필수 항목이 비었습니다: ${missing.join(", ")}` });
  }
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return res.status(400).json({ error: "장바구니 항목이 없습니다." });
  }

  const products = await getActiveProducts();
  const items = rawItems.map((raw) => priceItem(raw, products, PRICE_OPTS));
  if (items.some((it) => it === null)) {
    return res.status(400).json({ error: "존재하지 않는 상품 또는 참(charm)이 포함되어 있습니다." });
  }

  const subtotal = items.reduce((s, it) => s + it.sum, 0);
  const shipping = shippingFor(subtotal, SITE.shipping);
  const total = subtotal + shipping;
  const paymentId = "reiten-" + crypto.randomUUID();
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

  const { error } = await supabaseAdmin.from("pending_payments").insert({
    payment_id: paymentId,
    customer: normalizedCustomer,
    raw_items: rawItems,
    items,
    subtotal,
    shipping,
    total,
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

/* /api/order(카드결제 분기)와 웹훅(/api/payments/webhook) 양쪽에서 똑같이 필요한 "결제 확인 후
   주문 확정" 로직 — 재고 차감, 주문 저장, 알림 메일까지 한 번에 처리한다. 두 곳에 각각 복붙하면
   나중에 한쪽만 고치고 다른 쪽을 놓치기 쉬운, 돈이 걸린 로직이라 함수로 묶어 하나만 유지한다.
   실패해도 예외를 던지지 않고 { ok:false, status, body }로 반환한다(호출부가 그대로 res에 흘려보냄). */
async function finalizeCardOrder({ pending, paymentId, userId }) {
  const products = await getActiveProducts();
  const { customer, items, raw_items: rawItems, subtotal, shipping, total } = pending;

  const inventoryItems = [];
  rawItems.forEach((raw, i) => {
    if (
      typeof raw.productId === "string" &&
      !raw.productId.startsWith("charm-") &&
      typeof raw.size === "string" &&
      raw.size
    ) {
      inventoryItems.push({ productId: raw.productId, size: raw.size, qty: items[i].qty });
    }
  });

  if (inventoryItems.length) {
    const { error: invError } = await supabaseAdmin.rpc("decrement_inventory", {
      p_items: inventoryItems,
    });
    if (invError) {
      const m = /OUT_OF_STOCK:([^:]+):(.+)/.exec(invError.message || "");
      if (m) {
        /* 카드결제는 이 시점에 이미 돈을 받은 상태다 — 재고가 없어 주문을 못 만든다면
           반드시 결제를 취소해서 "결제는 됐는데 주문은 없는" 상태를 만들지 않는다. */
        try {
          await portone.cancelPayment(paymentId, "재고 부족으로 자동 취소");
        } catch (cancelErr) {
          console.error("[order] ⚠️ 재고 부족으로 인한 결제 자동 취소 실패 — 수동 확인 필요:", paymentId, cancelErr.message);
        }
        const [, productId, size] = m;
        const product = products.find((p) => p.id === productId);
        return { ok: false, status: 409, body: { error: "OUT_OF_STOCK", productId, size, name: product ? product.nameKo : productId } };
      }
      console.error("[order] 재고 차감 실패:", invError.message);
      return { ok: false, status: 500, body: { error: "재고 확인 중 오류가 발생했습니다." } };
    }

    const productIds = [...new Set(inventoryItems.map((it) => it.productId))];
    const sizes = [...new Set(inventoryItems.map((it) => it.size))];
    const { data: stockRows } = await supabaseAdmin
      .from("inventory")
      .select("product_id, size, qty")
      .in("product_id", productIds)
      .in("size", sizes);
    const zeroed = (stockRows || [])
      .filter((row) => row.qty <= 0 && inventoryItems.some((it) => it.productId === row.product_id && it.size === row.size))
      .map((row) => ({ name: products.find((p) => p.id === row.product_id)?.nameKo || row.product_id, size: row.size }));
    if (zeroed.length) {
      sendAdminLowStock(zeroed).catch((err) => console.error("[mailer] 재고 소진 알림 메일 발송 실패:", err.message));
    }
  }

  const { data: saved, error: saveError } = await supabaseAdmin
    .from("orders")
    .insert({
      order_no: orderNo(),
      user_id: userId,
      customer,
      items,
      subtotal,
      shipping,
      total,
      payment_method: "card",
      payment_id: paymentId,
      status: "입금확인",
    })
    .select()
    .single();

  if (saveError) {
    console.error("[order] 주문 저장 실패:", saveError.message);
    return { ok: false, status: 500, body: { error: "주문 저장에 실패했습니다." } };
  }

  await supabaseAdmin.from("pending_payments").delete().eq("payment_id", paymentId);

  sendAdminCardPaid(saved).catch((err) => console.error("[mailer] 카드결제 관리자 알림 메일 발송 실패:", err.message));
  sendCustomerCardPaid(saved).catch((err) => console.error("[mailer] 카드결제 완료 메일 발송 실패:", err.message));

  return { ok: true, saved };
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
      paymentMethod: result.saved.payment_method, sent: true,
    });
  }

  const { customer, items: rawItems } = req.body || {};

  if (!customer || typeof customer !== "object") {
    return res.status(400).json({ error: "customer 정보가 없습니다." });
  }
  const missing = REQUIRED_CUSTOMER_FIELDS.filter((f) => !String(customer[f] || "").trim());
  if (missing.length) {
    return res.status(400).json({ error: `필수 항목이 비었습니다: ${missing.join(", ")}` });
  }

  if (!Array.isArray(rawItems) || !rawItems.length) {
    return res.status(400).json({ error: "장바구니 항목이 없습니다." });
  }

  const products = await getActiveProducts();
  const items = rawItems.map((raw) => priceItem(raw, products, PRICE_OPTS));
  if (items.some((it) => it === null)) {
    return res.status(400).json({ error: "존재하지 않는 상품 또는 참(charm)이 포함되어 있습니다." });
  }

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
      inventoryItems.push({ productId: raw.productId, size: raw.size, qty: items[i].qty });
    }
  });

  if (inventoryItems.length) {
    const { error: invError } = await supabaseAdmin.rpc("decrement_inventory", {
      p_items: inventoryItems,
    });
    if (invError) {
      const m = /OUT_OF_STOCK:([^:]+):(.+)/.exec(invError.message || "");
      if (m) {
        const [, productId, size] = m;
        const product = products.find((p) => p.id === productId);
        return res.status(409).json({
          error: "OUT_OF_STOCK",
          productId,
          size,
          name: product ? product.nameKo : productId,
        });
      }
      console.error("[order] 재고 차감 실패:", invError.message);
      return res.status(500).json({ error: "재고 확인 중 오류가 발생했습니다." });
    }

    /* 방금 차감한 조합 중 재고가 0이 된 게 있으면 관리자에게 알린다.
       inventoryItems에 없는 다른 사이즈까지 걸리지 않도록 정확히 같은 (productId, size) 쌍만 추린다. */
    const productIds = [...new Set(inventoryItems.map((it) => it.productId))];
    const sizes = [...new Set(inventoryItems.map((it) => it.size))];
    const { data: stockRows } = await supabaseAdmin
      .from("inventory")
      .select("product_id, size, qty")
      .in("product_id", productIds)
      .in("size", sizes);

    const zeroed = (stockRows || [])
      .filter(
        (row) =>
          row.qty <= 0 &&
          inventoryItems.some((it) => it.productId === row.product_id && it.size === row.size)
      )
      .map((row) => ({
        name: products.find((p) => p.id === row.product_id)?.nameKo || row.product_id,
        size: row.size,
      }));

    if (zeroed.length) {
      sendAdminLowStock(zeroed).catch((err) => {
        console.error("[mailer] 재고 소진 알림 메일 발송 실패:", err.message);
      });
    }
  }

  const subtotal = items.reduce((s, it) => s + it.sum, 0);
  const shipping = shippingFor(subtotal, SITE.shipping);
  const total = subtotal + shipping;

  const { data: saved, error: saveError } = await supabaseAdmin
    .from("orders")
    .insert({
      order_no: orderNo(),
      user_id: req.user ? req.user.id : null,
      customer: {
        name: String(customer.name).trim(),
        tel: String(customer.tel).trim(),
        email: String(customer.email).trim(),
        zip: String(customer.zip).trim(),
        addr: String(customer.addr).trim(),
        addr2: String(customer.addr2 || "").trim(),
        memo: String(customer.memo || "").trim(),
        payer: String(customer.payer).trim(),
      },
      items,
      subtotal,
      shipping,
      total,
    })
    .select()
    .single();

  if (saveError) {
    console.error("[order] 주문 저장 실패:", saveError.message);
    return res.status(500).json({ error: "주문 저장에 실패했습니다." });
  }

  sendOrderNotification(saved).catch((err) => {
    console.error("[mailer] 주문 알림 메일 발송 실패:", err.message);
  });
  sendCustomerOrderReceived(saved).catch((err) => {
    console.error("[mailer] 주문 접수 확인 메일 발송 실패:", err.message);
  });

  res.json({
    no: saved.order_no,
    at: saved.created_at,
    customer: saved.customer,
    items: saved.items,
    subtotal: saved.subtotal,
    shipping: saved.shipping,
    total: saved.total,
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

function normalizeTel(s) {
  return String(s || "").replace(/\D/g, "");
}

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

/* ---------- 관리자 감사 로그 ----------
   관리자가 2명 이상이 되면 "누가 언제 무엇을 바꿨는지"를 추적할 방법이 필요해진다.
   메일 발송과 같은 패턴으로 요청을 막지 않고(fire-and-forget) 실패해도 본작업은 성공 처리한다 —
   로그 적재 실패가 실제 관리 작업을 막아서는 안 되기 때문. 008_admin_audit_log.sql 미실행 시에도
   본작업에는 지장이 없도록 에러를 조용히 삼킨다. */
function logAdminAction(req, action, targetType, targetId, detail) {
  supabaseAdmin
    .from("admin_audit_log")
    .insert({
      admin_id: req.user.id,
      admin_email: req.user.email || "",
      action,
      target_type: targetType,
      target_id: String(targetId),
      detail: detail || null,
    })
    .then(({ error }) => {
      if (error) console.error("[audit-log] 적재 실패:", error.message);
    });
}

app.get("/api/admin/audit-log", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query);
  const { data, error, count } = await supabaseAdmin
    .from("admin_audit_log")
    .select("*", { count: "exact" })
    .order("at", { ascending: false })
    .range(from, to);

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

/* ---------- 관리자 대시보드 ----------
   orders 테이블만으로 계산 가능해서 새 테이블 없이 집계만 한다. 취소된 주문은 매출에서 뺀다.
   상품별 판매량은 orders.items(주문 시점 스냅샷, productId 없이 name만 있음)를 이름으로 묶어 집계한다 —
   상품이 삭제·개명돼도 과거 주문 내역 자체는 그대로 남아있기 때문. */
app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("items, total, status, created_at")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) return res.status(500).json({ error: "집계에 실패했습니다." });

  const isCancelled = (o) => o.status === "취소";
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const monthKey = now.toISOString().slice(0, 7);

  let todayRevenue = 0;
  let monthRevenue = 0;
  let pendingCount = 0;
  const revenueByDay = new Map();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    revenueByDay.set(d.toISOString().slice(0, 10), 0);
  }

  const qtyByName = new Map();
  for (const o of data) {
    if (o.status === "입금대기") pendingCount++;
    if (!isCancelled(o)) {
      const dayKey = String(o.created_at).slice(0, 10);
      if (dayKey === todayKey) todayRevenue += o.total;
      if (dayKey.slice(0, 7) === monthKey) monthRevenue += o.total;
      if (revenueByDay.has(dayKey)) revenueByDay.set(dayKey, revenueByDay.get(dayKey) + o.total);

      for (const item of o.items || []) {
        qtyByName.set(item.name, (qtyByName.get(item.name) || 0) + (item.qty || 0));
      }
    }
  }

  const bestsellers = [...qtyByName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qty]) => ({ name, qty }));

  res.json({
    todayRevenue,
    monthRevenue,
    totalOrders: data.length,
    pendingCount,
    dailyRevenue: [...revenueByDay.entries()].map(([date, total]) => ({ date, total })),
    bestsellers,
  });
});

/* ---------- 관리자 ---------- */
app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query);
  const { data, error, count } = await supabaseAdmin
    .from("orders")
    .select("order_no, customer, items, subtotal, shipping, total, status, courier, tracking_no, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

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

/* status만 바꾸면 상태만, courier/trackingNo를 함께 보내면 배송정보도 같이 저장한다.
   status가 "입금확인"으로 바뀌는 순간에만 고객에게 입금 확인 메일을 보낸다(접수 메일은 /api/order에서 이미 발송됨). */
app.patch("/api/admin/orders/:no", requireAdmin, async (req, res) => {
  const { status, courier, trackingNo } = req.body || {};

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

  /* 이번 변경으로 운송장번호가 "처음" 채워지는 건지 알아야 배송 시작 메일을 중복 없이 보낼 수 있어
     update 직전에 이전 값을 한 번 조회해둔다. */
  const { data: prev } = await supabaseAdmin
    .from("orders")
    .select("tracking_no")
    .eq("order_no", req.params.no)
    .single();

  const { data: saved, error } = await supabaseAdmin
    .from("orders")
    .update(patch)
    .eq("order_no", req.params.no)
    .select()
    .single();

  if (error) return res.status(500).json({ error: "저장에 실패했습니다." });

  if (patch.status === "입금확인") {
    sendCustomerPaymentConfirmed(saved).catch((err) => {
      console.error("[mailer] 입금 확인 메일 발송 실패:", err.message);
    });
  }
  if (!prev?.tracking_no && saved.tracking_no) {
    sendCustomerShipped(saved).catch((err) => {
      console.error("[mailer] 배송 시작 메일 발송 실패:", err.message);
    });
  }

  logAdminAction(req, "order.update", "order", req.params.no, patch);
  res.json({ ok: true });
});

app.get("/api/admin/returns", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query);
  const { data, error, count } = await supabaseAdmin
    .from("return_requests")
    .select("id, order_no, contact_name, contact_tel, reason, detail, status, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

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
      at: r.created_at,
    })),
    page,
    pageSize,
    total: count ?? data.length,
  });
});

app.patch("/api/admin/returns/:id", requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!String(status || "").trim()) {
    return res.status(400).json({ error: "status가 필요합니다." });
  }
  const { error } = await supabaseAdmin
    .from("return_requests")
    .update({ status: String(status).trim() })
    .eq("id", req.params.id);

  if (error) return res.status(500).json({ error: "상태 변경에 실패했습니다." });
  logAdminAction(req, "return.update", "return", req.params.id, { status: String(status).trim() });
  res.json({ ok: true });
});

app.get("/api/admin/inventory", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("inventory")
    .select("product_id, size, qty")
    .order("product_id", { ascending: true });

  if (error) return res.status(500).json({ error: "재고를 불러오지 못했습니다." });
  res.json(data.map((r) => ({ productId: r.product_id, size: r.size, qty: r.qty })));
});

app.patch("/api/admin/inventory", requireAdmin, async (req, res) => {
  const { productId, size, qty } = req.body || {};
  const qtyNum = Math.floor(Number(qty));
  if (!productId || !size || !Number.isFinite(qtyNum) || qtyNum < 0) {
    return res.status(400).json({ error: "productId, size, qty(0 이상)가 필요합니다." });
  }
  const { error } = await supabaseAdmin
    .from("inventory")
    .upsert({ product_id: productId, size, qty: qtyNum }, { onConflict: "product_id,size" });

  if (error) return res.status(500).json({ error: "재고 저장에 실패했습니다." });
  logAdminAction(req, "inventory.update", "inventory", `${productId}:${size}`, { qty: qtyNum });
  res.json({ ok: true });
});

/* ---------- 상품 관리 (관리자만) ----------
   목록(GET)은 active 여부와 무관하게 전부 보여주고, 생성·수정·삭제는 관리자 인증을 거친다.
   공개 목록(/api/products)은 active=true인 것만 노출한다. */
app.get("/api/admin/products", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query, { defaultSize: 50 });
  const { data, error, count } = await supabaseAdmin
    .from("products")
    .select("*", { count: "exact" })
    .order("sort_order", { ascending: true })
    .range(from, to);

  if (error) return res.status(500).json({ error: "상품 목록을 불러오지 못했습니다." });
  res.json({ items: data.map(toProductDto), page, pageSize, total: count ?? data.length });
});

app.post("/api/admin/products", requireAdmin, async (req, res) => {
  const b = req.body || {};
  const id = String(b.id || "").trim();
  if (!/^[a-z0-9-]{2,60}$/.test(id)) {
    return res.status(400).json({ error: "상품 ID는 영문 소문자·숫자·하이픈만 2~60자로 입력해 주세요." });
  }

  const { patch, error: patchError } = productPatchFromBody(b, { forCreate: true });
  if (patchError) return res.status(400).json({ error: patchError });

  const { data, error } = await supabaseAdmin
    .from("products")
    .insert({ id, ...patch })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "이미 존재하는 상품 ID입니다." });
    console.error("[admin/products] 생성 실패:", error.message);
    return res.status(500).json({ error: "상품 생성에 실패했습니다." });
  }
  logAdminAction(req, "product.create", "product", data.id, { name: data.name_ko });
  res.json(toProductDto(data));
});

app.patch("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const { patch, error: patchError } = productPatchFromBody(req.body || {}, { forCreate: false });
  if (patchError) return res.status(400).json({ error: patchError });
  if (!Object.keys(patch).length) return res.status(400).json({ error: "변경할 값이 없습니다." });
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("products")
    .update(patch)
    .eq("id", req.params.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("[admin/products] 수정 실패:", error.message);
    return res.status(500).json({ error: "상품 수정에 실패했습니다." });
  }
  if (!data) return res.status(404).json({ error: "존재하지 않는 상품입니다." });
  logAdminAction(req, "product.update", "product", req.params.id, patch);
  res.json(toProductDto(data));
});

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("products").delete().eq("id", req.params.id);
  if (error) {
    console.error("[admin/products] 삭제 실패:", error.message);
    return res.status(500).json({ error: "상품 삭제에 실패했습니다." });
  }
  // 삭제된 상품에 딸린 재고 행도 함께 정리한다(없어도 동작에는 지장 없지만 관리자 재고 탭이 지저분해짐).
  await supabaseAdmin.from("inventory").delete().eq("product_id", req.params.id);
  logAdminAction(req, "product.delete", "product", req.params.id);
  res.json({ ok: true });
});

const productUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
}).single("photo");

app.post("/api/admin/products/photo", requireAdmin, (req, res) => {
  productUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: "사진 업로드에 실패했습니다(5MB 이하 이미지만 가능)." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "사진 파일이 없습니다." });
    }
    try {
      const url = await uploadProductPhoto(req.file.buffer);
      res.json({ url });
    } catch (e) {
      console.error("[admin/products] 사진 업로드 실패:", e.message);
      res.status(500).json({ error: "사진 업로드에 실패했습니다." });
    }
  });
});

/* ---------- 룩북 (lookbook 테이블 — 관리자 패널에서 추가·수정·삭제) ----------
   data.js의 정적 LOOKBOOK은 마이그레이션 006을 실행하지 않은 서버나 조회 실패 시의 폴백으로만 쓰인다. */
async function getActiveLookbook() {
  const { data, error } = await supabaseAdmin
    .from("lookbook")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[lookbook] DB 조회 실패, 정적 목록으로 폴백:", error.message);
    return STATIC_LOOKBOOK;
  }
  return data.map(toLookbookDto);
}

app.get("/api/lookbook", async (req, res) => {
  res.json(await getActiveLookbook());
});

app.get("/api/admin/lookbook", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query, { defaultSize: 50 });
  const { data, error, count } = await supabaseAdmin
    .from("lookbook")
    .select("*", { count: "exact" })
    .order("sort_order", { ascending: true })
    .range(from, to);

  if (error) return res.status(500).json({ error: "룩북 목록을 불러오지 못했습니다." });
  res.json({ items: data.map(toLookbookDto), page, pageSize, total: count ?? data.length });
});

app.post("/api/admin/lookbook", requireAdmin, async (req, res) => {
  const { patch, error: patchError } = lookbookPatchFromBody(req.body || {}, { forCreate: true });
  if (patchError) return res.status(400).json({ error: patchError });

  const { data, error } = await supabaseAdmin.from("lookbook").insert(patch).select().single();
  if (error) {
    console.error("[admin/lookbook] 생성 실패:", error.message);
    return res.status(500).json({ error: "룩북 항목 생성에 실패했습니다." });
  }
  logAdminAction(req, "lookbook.create", "lookbook", data.id, { label: data.label });
  res.json(toLookbookDto(data));
});

app.patch("/api/admin/lookbook/:id", requireAdmin, async (req, res) => {
  const { patch, error: patchError } = lookbookPatchFromBody(req.body || {}, { forCreate: false });
  if (patchError) return res.status(400).json({ error: patchError });
  if (!Object.keys(patch).length) return res.status(400).json({ error: "변경할 값이 없습니다." });
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("lookbook")
    .update(patch)
    .eq("id", req.params.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("[admin/lookbook] 수정 실패:", error.message);
    return res.status(500).json({ error: "수정에 실패했습니다." });
  }
  if (!data) return res.status(404).json({ error: "존재하지 않는 항목입니다." });
  logAdminAction(req, "lookbook.update", "lookbook", req.params.id, patch);
  res.json(toLookbookDto(data));
});

app.delete("/api/admin/lookbook/:id", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("lookbook").delete().eq("id", req.params.id);
  if (error) {
    console.error("[admin/lookbook] 삭제 실패:", error.message);
    return res.status(500).json({ error: "삭제에 실패했습니다." });
  }
  logAdminAction(req, "lookbook.delete", "lookbook", req.params.id);
  res.json({ ok: true });
});

const lookbookUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
}).single("photo");

app.post("/api/admin/lookbook/photo", requireAdmin, (req, res) => {
  lookbookUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: "사진 업로드에 실패했습니다(5MB 이하 이미지만 가능)." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "사진 파일이 없습니다." });
    }
    try {
      const url = await uploadLookbookPhoto(req.file.buffer);
      res.json({ url });
    } catch (e) {
      console.error("[admin/lookbook] 사진 업로드 실패:", e.message);
      res.status(500).json({ error: "사진 업로드에 실패했습니다." });
    }
  });
});

/* ---------- 관리자 참고정보(정보 탭) ----------
   Works 관리자 패널에서 사업자 정보 요약이나 Supabase·Render 같은 운영 사이트 링크를
   직접 적어두고 보는 용도. 비밀번호·API 키 등 민감정보는 여기 넣지 않는다(관리자 전원 열람 가능). */
function toSettingDto(row) {
  return {
    id: row.id,
    label: row.label,
    value: row.value || "",
    note: row.note || "",
    sortOrder: row.sort_order,
  };
}

app.get("/api/admin/settings", requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("admin_settings").select("*").order("sort_order", { ascending: true });
  if (error) return res.status(500).json({ error: "정보를 불러오지 못했습니다." });
  res.json(data.map(toSettingDto));
});

app.post("/api/admin/settings", requireAdmin, async (req, res) => {
  const { label, value, note, sortOrder } = req.body || {};
  const labelStr = String(label || "").trim().slice(0, 80);
  if (!labelStr) return res.status(400).json({ error: "이름을 입력해 주세요." });

  const { data, error } = await supabaseAdmin
    .from("admin_settings")
    .insert({
      label: labelStr,
      value: String(value || "").trim().slice(0, 500),
      note: String(note || "").trim().slice(0, 300),
      sort_order: Number.isFinite(Number(sortOrder)) ? Math.floor(Number(sortOrder)) : 0,
    })
    .select()
    .single();

  if (error) {
    console.error("[admin/settings] 생성 실패:", error.message);
    return res.status(500).json({ error: "생성에 실패했습니다." });
  }
  logAdminAction(req, "setting.create", "setting", data.id, { label: data.label });
  res.json(toSettingDto(data));
});

app.patch("/api/admin/settings/:id", requireAdmin, async (req, res) => {
  const { label, value, note, sortOrder } = req.body || {};
  const patch = { updated_at: new Date().toISOString() };
  if (label !== undefined) {
    const v = String(label || "").trim().slice(0, 80);
    if (!v) return res.status(400).json({ error: "이름을 입력해 주세요." });
    patch.label = v;
  }
  if (value !== undefined) patch.value = String(value || "").trim().slice(0, 500);
  if (note !== undefined) patch.note = String(note || "").trim().slice(0, 300);
  if (sortOrder !== undefined) patch.sort_order = Number.isFinite(Number(sortOrder)) ? Math.floor(Number(sortOrder)) : 0;

  const { data, error } = await supabaseAdmin.from("admin_settings").update(patch).eq("id", req.params.id).select().maybeSingle();
  if (error) {
    console.error("[admin/settings] 수정 실패:", error.message);
    return res.status(500).json({ error: "수정에 실패했습니다." });
  }
  if (!data) return res.status(404).json({ error: "존재하지 않는 항목입니다." });
  logAdminAction(req, "setting.update", "setting", req.params.id, patch);
  res.json(toSettingDto(data));
});

app.delete("/api/admin/settings/:id", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("admin_settings").delete().eq("id", req.params.id);
  if (error) {
    console.error("[admin/settings] 삭제 실패:", error.message);
    return res.status(500).json({ error: "삭제에 실패했습니다." });
  }
  logAdminAction(req, "setting.delete", "setting", req.params.id);
  res.json({ ok: true });
});

/* ---------- 상품 리뷰 ---------- */
const reviewUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
}).single("photo");

function toReviewDto(r) {
  return {
    id: r.id,
    productId: r.product_id,
    name: r.name,
    rating: r.rating,
    comment: r.comment,
    photoUrl: r.photo_url,
    instagramHandle: r.instagram_handle,
    helpfulCount: r.helpful_count || 0,
    approved: r.approved !== false,
    at: r.created_at,
  };
}

/* 승인된(approved=true) 리뷰만 공개 노출한다. 새로 등록된 리뷰는 관리자가 승인하기 전까지
   /api/admin/reviews에서만 보인다(스팸·부적절한 사진 방지, 005_reviews_approval.sql 참고). */
app.get("/api/reviews", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("reviews")
    .select("*")
    .eq("approved", true)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: "리뷰를 불러오지 못했습니다." });
  res.json(data.map(toReviewDto));
});

app.post("/api/reviews", writeLimiter, (req, res) => {
  reviewUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: "사진 업로드에 실패했습니다(5MB 이하 이미지만 가능)." });
    }

    const { productId, name, rating, comment, instagram } = req.body || {};

    const validProduct = productId === "general" || (await getAllProductIds()).includes(productId);
    if (!validProduct) {
      return res.status(400).json({ error: "존재하지 않는 상품입니다." });
    }

    const ratingNum = Math.round(Number(rating));
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: "별점은 1~5 사이여야 합니다." });
    }

    const nameStr = String(name || "").trim().slice(0, 40);
    const commentStr = String(comment || "").trim().slice(0, 1000);
    if (!nameStr || !commentStr) {
      return res.status(400).json({ error: "이름과 리뷰 내용을 입력해 주세요." });
    }

    // 인스타그램 아이디는 @ 없이 영문·숫자·마침표·밑줄만 허용
    const instaStr = String(instagram || "").trim().replace(/^@/, "");
    const instaValid = !instaStr || /^[a-zA-Z0-9._]{1,30}$/.test(instaStr);
    if (!instaValid) {
      return res.status(400).json({ error: "인스타그램 아이디 형식을 확인해 주세요." });
    }

    let photoUrl = null;
    if (req.file) {
      try {
        photoUrl = await uploadReviewPhoto(req.file.buffer);
      } catch (e) {
        console.error("[reviews] 사진 업로드 실패:", e.message);
        return res.status(500).json({ error: "사진 업로드에 실패했습니다." });
      }
    }

    const { data, error } = await supabaseAdmin
      .from("reviews")
      .insert({
        product_id: productId,
        name: nameStr,
        rating: ratingNum,
        comment: commentStr,
        photo_url: photoUrl,
        instagram_handle: instaStr || null,
        approved: false,
      })
      .select()
      .single();

    if (error) {
      console.error("[reviews] 저장 실패:", error.message);
      return res.status(500).json({ error: "리뷰 저장에 실패했습니다." });
    }

    res.json(toReviewDto(data));
  });
});

app.post("/api/reviews/:id/helpful", writeLimiter, async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc("increment_helpful", { p_id: req.params.id });
  if (error) {
    console.error("[reviews] 공감 처리 실패:", error.message);
    return res.status(500).json({ error: "처리에 실패했습니다." });
  }
  res.json({ helpfulCount: data });
});

/* ---------- 리뷰 승인 (관리자만) ----------
   승인 대기(approved=false)인 리뷰가 먼저 오도록 정렬해 관리자가 검수할 목록을 바로 볼 수 있게 한다. */
app.get("/api/admin/reviews", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query);
  const { data, error, count } = await supabaseAdmin
    .from("reviews")
    .select("*", { count: "exact" })
    .order("approved", { ascending: true })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return res.status(500).json({ error: "리뷰 목록을 불러오지 못했습니다." });
  res.json({ items: data.map(toReviewDto), page, pageSize, total: count ?? data.length });
});

app.patch("/api/admin/reviews/:id", requireAdmin, async (req, res) => {
  const { approved } = req.body || {};
  if (typeof approved !== "boolean") {
    return res.status(400).json({ error: "approved(true/false)가 필요합니다." });
  }
  const { error } = await supabaseAdmin.from("reviews").update({ approved }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "승인 처리에 실패했습니다." });
  logAdminAction(req, "review.update", "review", req.params.id, { approved });
  res.json({ ok: true });
});

app.delete("/api/admin/reviews/:id", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("reviews").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "삭제에 실패했습니다." });
  logAdminAction(req, "review.delete", "review", req.params.id);
  res.json({ ok: true });
});

/* ---------- 상품 Q&A ---------- */
function toQnaDto(q, { redact } = {}) {
  const hide = redact && q.secret;
  return {
    id: q.id,
    productId: q.product_id,
    name: q.name,
    question: hide ? null : q.question,
    secret: q.secret,
    answer: hide ? null : q.answer,
    status: q.status,
    at: q.created_at,
    answeredAt: q.answered_at,
  };
}

app.get("/api/qna", optionalAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("qna")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: "문의 목록을 불러오지 못했습니다." });

  res.json(
    data.map((q) => toQnaDto(q, { redact: !(req.user && req.user.id === q.user_id) }))
  );
});

app.post("/api/qna", writeLimiter, optionalAuth, async (req, res) => {
  const { productId, name, question, secret } = req.body || {};

  const validProduct = productId === "general" || (await getAllProductIds()).includes(productId);
  if (!validProduct) {
    return res.status(400).json({ error: "존재하지 않는 상품입니다." });
  }

  const nameStr = String(name || "").trim().slice(0, 40);
  const questionStr = String(question || "").trim().slice(0, 1000);
  if (!nameStr || !questionStr) {
    return res.status(400).json({ error: "이름과 문의 내용을 입력해 주세요." });
  }

  const { data, error } = await supabaseAdmin
    .from("qna")
    .insert({
      product_id: productId,
      user_id: req.user ? req.user.id : null,
      name: nameStr,
      question: questionStr,
      secret: !!secret,
    })
    .select()
    .single();

  if (error) {
    console.error("[qna] 저장 실패:", error.message);
    return res.status(500).json({ error: "문의 등록에 실패했습니다." });
  }

  res.json(toQnaDto(data, { redact: false }));
});

app.get("/api/admin/qna", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query);
  const { data, error, count } = await supabaseAdmin
    .from("qna")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return res.status(500).json({ error: "문의 목록을 불러오지 못했습니다." });
  res.json({ items: data.map((q) => toQnaDto(q, { redact: false })), page, pageSize, total: count ?? data.length });
});

app.patch("/api/admin/qna/:id", requireAdmin, async (req, res) => {
  const { answer } = req.body || {};
  const answerStr = String(answer || "").trim().slice(0, 2000);
  if (!answerStr) {
    return res.status(400).json({ error: "답변 내용을 입력해 주세요." });
  }

  const { error } = await supabaseAdmin
    .from("qna")
    .update({ answer: answerStr, status: "답변완료", answered_at: new Date().toISOString() })
    .eq("id", req.params.id);

  if (error) return res.status(500).json({ error: "답변 저장에 실패했습니다." });
  logAdminAction(req, "qna.answer", "qna", req.params.id);
  res.json({ ok: true });
});

if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.listen(PORT, () => {
  console.log(`REITEN server running at http://localhost:${PORT}`);
});
