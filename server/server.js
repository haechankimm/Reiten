require("dotenv").config();
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const { SITE, PRODUCTS: STATIC_PRODUCTS, LOOKBOOK: STATIC_LOOKBOOK, CHARM_PRICE, EXTRA_PRICE, EXTRAS, COURIERS } = require("../소스 코드/assets/js/data.js");
const { supabaseAdmin } = require("./lib/supabase");
const { requireAuth, optionalAuth, requireAdmin } = require("./lib/auth");
const { sendOrderNotification, sendCustomerOrderReceived, sendCustomerPaymentConfirmed } = require("./lib/mailer");
const { uploadReviewPhoto, uploadProductPhoto, uploadLookbookPhoto } = require("./lib/cloudinary");
const { orderNo, priceItem, shippingFor } = require("./lib/pricing");
const { toProductDto, productPatchFromBody } = require("./lib/products");
const { toLookbookDto, lookbookPatchFromBody } = require("./lib/lookbook");
const { paginationParams } = require("./lib/pagination");

const PORT = process.env.PORT || 3000;
const SITE_DIR = path.join(__dirname, "..", "소스 코드");

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

app.use(express.json());
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
  return data.map(toProductDto);
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

app.post("/api/order", writeLimiter, optionalAuth, async (req, res) => {
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
    sent: true,
  });
});

/* 브라우저가 Supabase 클라이언트를 초기화하기 위한 공개 설정값 — anon key는 비밀이 아니다
   (Supabase의 RLS가 실제 접근 권한을 결정하며, service role key만 비밀로 취급한다). */
app.get("/api/config", (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
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
  res.json(toLookbookDto(data));
});

app.delete("/api/admin/lookbook/:id", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("lookbook").delete().eq("id", req.params.id);
  if (error) {
    console.error("[admin/lookbook] 삭제 실패:", error.message);
    return res.status(500).json({ error: "삭제에 실패했습니다." });
  }
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
  res.json({ ok: true });
});

app.delete("/api/admin/reviews/:id", requireAdmin, async (req, res) => {
  const { error } = await supabaseAdmin.from("reviews").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "삭제에 실패했습니다." });
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
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`REITEN server running at http://localhost:${PORT}`);
});
