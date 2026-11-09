/* 고객 주문 흐름: 공개 상품 목록, 카드결제 준비, 주문 접수(무통장·카드·가상계좌 확인), 공개 설정 —
   server.js에서 분리(2026-11-09, 동작 변경 없음). */
const express = require("express");
const crypto = require("crypto");
const { supabaseAdmin } = require("../lib/supabase");
const { optionalAuth } = require("../lib/auth");
const { sendOrderNotification, sendCustomerOrderReceived } = require("../lib/mailer");
const kakao = require("../lib/kakao");
const { orderNo } = require("../lib/pricing");
const { claimCouponUsage, releaseCouponUsage } = require("../lib/coupons");
const { claimPointsUsage, reversePointsForOrder } = require("../lib/loyaltyPoints");
const portone = require("../lib/portone");
const { logInventoryChange, logSystemError, logPaymentAttempt } = require("../lib/adminLog");
const { orderLimiter } = require("../lib/rateLimiters");
const { getReviewPhotoPoints } = require("../lib/reviewRewards");
const { sendPushToAdmins } = require("../lib/push");
const { getActiveProducts } = require("../lib/catalog");
const { validateAndPriceOrder } = require("../lib/orderPricing");
const { notifyOrderStatusSideEffects } = require("../lib/orderNotify");
const { insertOrderRow, nextOrderSeq, decrementInventoryForItems, finalizeCardOrder, finalizeVirtualAccountOrder, paidMethodOf } = require("../lib/orderFinalize");

const router = express.Router();

router.get("/api/products", async (req, res) => {
  res.json(await getActiveProducts());
});

/* ---------- 카드결제(포트원) ----------
   결제창을 열기 전에 서버가 먼저 금액을 계산해서 pending_payments에 저장해두고, 그 값 그대로
   결제창에 넘긴다(사전검증) — 브라우저에서 금액을 조작해도 결제창에 표시되는 금액 자체가
   서버 계산값이라 소용없다. 결제가 끝나면 /api/order가 paymentId로 다시 포트원에 물어봐서
   실제로 그 금액만큼 결제됐는지 확인한 뒤에만 주문을 만든다(사후검증, 009_card_payments.sql 참고). */
router.post("/api/payments/prepare", optionalAuth, orderLimiter, async (req, res) => {
  if (!portone.isConfigured()) {
    return res.status(503).json({ error: "카드결제가 아직 준비되지 않았습니다." });
  }

  const products = await getActiveProducts();
  const priced = await validateAndPriceOrder(req.body, products, req.user ? req.user.id : null, { banned: req.userBanned });
  if (priced.error) return res.status(priced.error.status).json(priced.error.body);
  // 결제할 금액이 0원이면 결제창을 열 수 없다 — 화면이 무통장 경로(/api/order)로 바로 접수한다(cart.html)
  if (priced.zeroTotal) return res.status(400).json({ error: "결제할 금액이 없는 주문입니다. 다시 시도해 주세요.", code: "ZERO_TOTAL" });
  const { rawItems, items, subtotal, shipping, coupon, pointsUsed, total, device } = priced;
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
    user_id: req.user ? req.user.id : null,
    customer: normalizedCustomer,
    raw_items: rawItems,
    items,
    subtotal,
    shipping,
    total,
    coupon_code: coupon.code,
    discount: coupon.discount,
    points_used: pointsUsed,
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
    pointsUsed,
    storeId: process.env.PORTONE_STORE_ID,
    channelKey: process.env.PORTONE_CHANNEL_KEY,
    customer: { fullName: normalizedCustomer.name, phoneNumber: normalizedCustomer.tel, email: normalizedCustomer.email },
  });
});

router.post("/api/order", optionalAuth, orderLimiter, async (req, res) => {
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
          discount: already.discount, couponCode: already.coupon_code, pointsUsed: already.points_used || 0,
          paymentMethod: already.payment_method, status: already.status, sent: true,
          virtualAccount: already.payment_method === "virtual_account" ? {
            bank: already.virtual_account_bank, accountNumber: already.virtual_account_number,
            holder: already.virtual_account_holder, dueAt: already.virtual_account_due_at,
          } : null,
        });
      }
      return res.status(400).json({ error: "결제 정보를 찾을 수 없습니다. 처음부터 다시 시도해 주세요." });
    }

    let verified;
    try {
      verified = await portone.getVerifiedPayment(paymentId);
    } catch (e) {
      console.error("[order] 결제 조회 실패:", e.message);
      logPaymentAttempt({ paymentId, status: "error", amount: pending.total, reason: e.message });
      return res.status(502).json({ error: "결제 확인 중 오류가 발생했습니다." });
    }
    if (verified.amount.total !== pending.total) {
      console.error("[order] 결제 금액 불일치:", paymentId, "amount=", verified.amount && verified.amount.total, "expected=", pending.total);
      logPaymentAttempt({ paymentId, status: "mismatch", amount: pending.total, reason: `amount mismatch, status=${verified.status}` });
      return res.status(402).json({ error: "결제가 확인되지 않았습니다." });
    }

    /* 카드는 결제창을 닫는 순간 이미 PAID, 가상계좌는 이 시점엔 계좌만 발급된 상태
       (VIRTUAL_ACCOUNT_ISSUED) — 서로 다른 함수로 주문을 만든다(finalizeVirtualAccountOrder
       주석 참고, 위 웹훅 핸들러와 완전히 같은 분기). */
    let result;
    if (verified.status === "PAID") {
      /* 회원은 "결제를 준비한 계정"(pending.user_id) 기준으로 정한다 — 웹훅·가상계좌 경로와 같은 기준.
         예전엔 이 확인 요청의 로그인 토큰(req.user)을 썼는데, 토큰 없이 확인 요청만 따로 보내면
         적립금 할인을 받고도 차감이 건너뛰어져(finalizeCardOrder의 `pointsUsed && userId`) 같은
         적립금을 계속 다시 쓸 수 있었고, 주문도 회원 계정에 안 붙었다(2026-10-02 점검에서 발견). */
      result = await finalizeCardOrder({ pending, paymentId, userId: pending.user_id || null, paymentMethod: paidMethodOf(verified) });
    } else if (verified.status === "VIRTUAL_ACCOUNT_ISSUED") {
      result = await finalizeVirtualAccountOrder({ pending, paymentId, verified });
    } else {
      console.error("[order] 결제 검증 실패:", paymentId, "status=", verified.status);
      logPaymentAttempt({ paymentId, status: "mismatch", amount: pending.total, reason: `status=${verified.status}` });
      return res.status(402).json({ error: "결제가 확인되지 않았습니다." });
    }
    if (!result.ok) return res.status(result.status).json(result.body);
    return res.json({
      no: result.saved.order_no, at: result.saved.created_at, customer: result.saved.customer, items: result.saved.items,
      subtotal: result.saved.subtotal, shipping: result.saved.shipping, total: result.saved.total,
      discount: result.saved.discount, couponCode: result.saved.coupon_code, pointsUsed: result.saved.points_used || 0,
      paymentMethod: result.saved.payment_method, status: result.saved.status, sent: true,
      virtualAccount: result.saved.payment_method === "virtual_account" ? {
        bank: result.saved.virtual_account_bank, accountNumber: result.saved.virtual_account_number,
        holder: result.saved.virtual_account_holder, dueAt: result.saved.virtual_account_due_at,
      } : null,
    });
  }

  /* 쿠폰이 유효하지 않으면 재고를 건드리기 전에(아래 decrement_inventory 호출 전에) 먼저 실패시킨다 —
     재고만 축나고 주문은 안 만들어지는 상황을 피하기 위해서다. */
  const products = await getActiveProducts();
  const userId = req.user ? req.user.id : null;
  const priced = await validateAndPriceOrder(req.body, products, userId, { banned: req.userBanned });
  if (priced.error) return res.status(priced.error.status).json(priced.error.body);
  const { rawItems, items, subtotal, shipping, coupon, pointsUsed, total, device } = priced;
  const { customer } = req.body;

  /* 쿠폰 사용 횟수 원자적 차감(032_coupon_usage_lock.sql) — 무통장입금은 아직 돈을 받기 전이라
     여기서 소진됐다고 판정되면 재고를 건드리기 전에 바로 실패시킨다(카드결제 쪽은 이미 결제가
     끝난 뒤라 finalizeCardOrder에서 다르게 처리 — 위 claimCouponUsage 참고). */
  if (coupon.code) {
    const claimed = await claimCouponUsage(supabaseAdmin, coupon.code);
    if (!claimed) return res.status(400).json({ error: "쿠폰 사용 횟수가 모두 소진되었습니다." });
  }

  const orderNumber = orderNo(await nextOrderSeq());

  /* 포인트 사용 원자적 차감(034_loyalty_points.sql) — 쿠폰과 같은 자리, 같은 이유. 무통장입금은
     아직 "입금대기"일 뿐 실제로 돈을 받은 게 아니라서(24시간 내 미입금 시 자동취소, 아래
     PENDING_CANCEL_HOURS 크론 참고), 이 주문이 나중에 취소되면 reversePointsForOrder로 돌려준다. */
  if (pointsUsed) {
    const claimed = await claimPointsUsage(supabaseAdmin, userId, pointsUsed, orderNumber);
    if (!claimed) {
      // 포인트가 부족해 주문을 못 만든다면, 방금 위에서 먼저 차감한 쿠폰 사용 횟수를 되돌려야 한다.
      if (coupon.code) await releaseCouponUsage(supabaseAdmin, coupon.code);
      return res.status(400).json({ error: "포인트 잔액이 부족합니다." });
    }
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
      inventoryItems.push({ productId: raw.productId, color: raw.color || "", size: raw.size, qty: items[i].qty });
    }
  });

  if (inventoryItems.length) {
    const decResult = await decrementInventoryForItems(inventoryItems, products, orderNumber);
    if (!decResult.ok) {
      if (coupon.code) await releaseCouponUsage(supabaseAdmin, coupon.code);
      if (pointsUsed) await reversePointsForOrder(supabaseAdmin, orderNumber);
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
      user_id: userId,
      customer: normalizedCustomer,
      items: itemsForStorage,
      device,
      subtotal,
      shipping,
      total,
      coupon_code: coupon.code,
      discount: coupon.discount,
      points_used: pointsUsed,
      // 쿠폰·적립금으로 0원이 된 주문은 입금할 돈이 없으므로 바로 "입금확인"(2026-10-28 정기 감사)
      ...(total <= 0 ? { status: "입금확인" } : {}),
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
    if (coupon.code) await releaseCouponUsage(supabaseAdmin, coupon.code);
    if (pointsUsed) await reversePointsForOrder(supabaseAdmin, orderNumber);
    logSystemError("bank_order_finalize_failed", { orderNo: orderNumber, error: saveError.message });
    return res.status(500).json({ error: "주문 저장에 실패했습니다." });
  }

  if (saved.status === "입금확인") {
    // 0원 주문 — 관리자가 입금 확인을 누른 것과 같은 후속 처리(입금 확인 메일·감사 쿠폰·적립 예정액)
    await notifyOrderStatusSideEffects({ status: "입금대기" }, saved, { status: "입금확인" });
  }
  sendOrderNotification(saved).catch((err) => {
    console.error("[mailer] 주문 알림 메일 발송 실패:", err.message);
  });
  if (saved.status !== "입금확인") sendCustomerOrderReceived(saved).catch((err) => {
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
    pointsUsed: saved.points_used || 0,
    paymentMethod: "bank_transfer",
    paid: saved.status === "입금확인",
    sent: true,
  });
});

// 가상계좌 입금 기한 기본값 — 무통장입금 자동취소(PENDING_CANCEL_HOURS)와 맞춰 24시간.
// 관리자가 PORTONE_VIRTUAL_ACCOUNT_VALID_HOURS로 다르게 정할 수 있다.
const VIRTUAL_ACCOUNT_DEFAULT_VALID_HOURS = 24;

/* 브라우저가 Supabase 클라이언트를 초기화하기 위한 공개 설정값 — anon key는 비밀이 아니다
   (Supabase의 RLS가 실제 접근 권한을 결정하며, service role key만 비밀로 취급한다). */
let reviewPhotoPointsCache = { value: null, at: 0 };
router.get("/api/config", async (req, res) => {
  // 사진 리뷰 적립금 안내(reviews.html)용 — 설정값을 5분 캐시(lib/reviewRewards.js)
  if (reviewPhotoPointsCache.value === null || Date.now() - reviewPhotoPointsCache.at > 5 * 60 * 1000) {
    reviewPhotoPointsCache = { value: await getReviewPhotoPoints(supabaseAdmin).catch(() => 0), at: Date.now() };
  }
  res.json({
    reviewPhotoPoints: reviewPhotoPointsCache.value,
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    // storeId/channelKey는 포트원 결제창을 여는 데 필요한 공개 식별자다(비밀 아님) —
    // 실제 인증은 서버의 PORTONE_API_SECRET으로만 이뤄지므로 브라우저에 노출돼도 안전하다.
    cardPaymentEnabled: portone.isConfigured(),
    portoneStoreId: process.env.PORTONE_STORE_ID || null,
    portoneChannelKey: process.env.PORTONE_CHANNEL_KEY || null,
    // 가상계좌는 PG사 결제수단 별도 심사가 필요해(README 참고) 관리자가 은행을 직접 정해
    // 넣기 전까지는(PORTONE_VIRTUAL_ACCOUNT_BANK) 꺼진 채로 있다 — lib/portone.js 참고.
    virtualAccountEnabled: portone.isVirtualAccountConfigured(),
    virtualAccountBank: process.env.PORTONE_VIRTUAL_ACCOUNT_BANK || null,
    virtualAccountBankLabel: portone.bankLabel(process.env.PORTONE_VIRTUAL_ACCOUNT_BANK),
    virtualAccountValidHours: Number(process.env.PORTONE_VIRTUAL_ACCOUNT_VALID_HOURS) || VIRTUAL_ACCOUNT_DEFAULT_VALID_HOURS,
  });
});

module.exports = router;
