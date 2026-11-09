/* 주문 저장·재고 차감·카드/가상계좌 결제 확정 — server.js에서 분리(2026-11-09, 동작 변경 없음).
   결제별 잠금(withPaymentLock)은 이 프로세스 메모리 + DB 잠금(lib/dbLock.js) 두 겹이다. */
const { supabaseAdmin } = require("./supabase");
const {
  sendAdminLowStock,
  sendAdminCardPaid,
  sendCustomerCardPaid,
  sendCustomerVirtualAccountIssued,
  sendAdminCardCancelFailed,
  sendAdminOrderFinalizeFailed,
} = require("./mailer");
const kakao = require("./kakao");
const { orderNo } = require("./pricing");
const { claimCouponUsage, releaseCouponUsage } = require("./coupons");
const { claimPointsUsage, previewEarnedPoints, creditPoints, reversePointsForOrder } = require("./loyaltyPoints");
const portone = require("./portone");
const { logInventoryChange, logSystemError, logPaymentAttempt } = require("./adminLog");
const { isMissingColumnError, extractMissingColumnName } = require("./pgErrors");
const { confirmationEnabled } = require("./purchaseConfirm");
const { sendPushToAdmins } = require("./push");
const { getActiveProducts } = require("./catalog");
const { issueThanksCouponsIfEligible } = require("./thanksCouponIssue");
const { notifyOrderStatusSideEffects } = require("./orderNotify");

/* orders/pending_payments에 device(기기 종류, 022_order_device.sql)를 넣어 insert하되,
   마이그레이션이 아직 안 돌아서 컬럼이 없으면(PGRST204) device 없이 한 번 더 시도한다.
   기기 정보는 부가 통계용일 뿐이라 이것 때문에 주문·결제 생성 자체(핵심 기능)가 막히면
   절대 안 된다 — reviews.order_no와 같은 원칙(위 리뷰 실구매 인증 참고). */
/* device(022_order_device.sql)에 이어 points_used(034_loyalty_points.sql)도 나중에 추가된
   선택 컬럼이라 같은 폴백이 필요해졌다 — 컬럼 하나가 없을 때마다 매번 이 함수를 새로 고치지
   않도록, "있으면 넣고 없으면 빼고 재시도"할 선택 컬럼 목록을 하나로 관리한다. PostgREST가
   어떤 컬럼이 없는지까지는 구조화해서 안 알려줘서(PGRST204/42703 코드만 옴), 하나씩 빼보며
   재시도한다(선택 컬럼이 실무에서 한 번에 여러 개 밀려있는 경우는 드물어 이 정도로 충분하다). */
const OPTIONAL_ORDER_COLUMNS = [
  "device", "points_used", "points_earned", "user_id",
  "virtual_account_bank", "virtual_account_number", "virtual_account_holder", "virtual_account_due_at",
];

async function insertOrderRow(table, row, { returning = false } = {}) {
  const run = (r) => {
    const q = supabaseAdmin.from(table).insert(r);
    return returning ? q.select().single() : q;
  };
  let result = await run(row);
  let current = row;
  /* 에러 메시지에서 실제 없는 컬럼 이름을 뽑아 그것만 정확히 뺀다(lib/pgErrors.js 참고) —
     이름을 못 뽑으면(포맷이 예상과 다른 극히 드문 경우) 예전처럼 OPTIONAL_ORDER_COLUMNS
     순서대로 하나씩 찍어 넘기는 걸로 폴백한다. 둘 다 최대 OPTIONAL_ORDER_COLUMNS.length번
     안에는 반드시 끝나야 하므로(선택 컬럼이 그보다 많이 없을 수는 없음) 그만큼만 반복한다. */
  for (let i = 0; i < OPTIONAL_ORDER_COLUMNS.length && isMissingColumnError(result.error); i++) {
    const named = extractMissingColumnName(result.error);
    const col = named && named in current ? named : OPTIONAL_ORDER_COLUMNS.find((c) => c in current);
    if (!col) break;
    console.warn(`[${table}] '${col}' 컬럼 없음(마이그레이션 미실행) — ${col} 없이 재시도`);
    const { [col]: _omit, ...rest } = current;
    current = rest;
    result = await run(current);
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
/* 같은 결제(paymentId)의 주문 확정을 한 번에 하나씩만 돌린다(2026-10-28 정기 감사).
   포트원 웹훅과 결제 직후 브라우저 확인 요청이 거의 동시에 오면 둘 다 재고를 빼러 들어가는데, 재고가
   주문 수량의 2배보다 적으면 나중 쪽이 "재고 부족"으로 판정돼 **먼저 만들어진 정상 주문의 결제를 취소**
   (가상계좌는 계좌 폐쇄)해버렸다. 서버는 한 대(Render 단일 인스턴스 — 크론도 이 전제로 돎)라 프로세스
   안의 잠금으로 순서를 세우고, 잠금을 얻은 뒤 이미 만들어진 주문이 있으면 그 주문을 그대로 돌려준다. */
const finalizeLocks = new Map();
async function withPaymentLock(paymentId, fn) {
  const prev = finalizeLocks.get(paymentId) || Promise.resolve();
  let release;
  const mine = new Promise((r) => (release = r));
  const chain = prev.then(() => mine);
  finalizeLocks.set(paymentId, chain);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (finalizeLocks.get(paymentId) === chain) finalizeLocks.delete(paymentId);
  }
}

async function existingOrderForPayment(paymentId) {
  const { data } = await supabaseAdmin.from("orders").select("*").eq("payment_id", paymentId).maybeSingle();
  return data || null;
}

async function finalizeCardOrder(args) {
  return withPaymentLock(args.paymentId, async () => {
    const existing = await existingOrderForPayment(args.paymentId);
    /* 가상계좌 "발급" 처리가 잠금을 쥔 사이 "입금 완료"가 도착하면, 잠금을 얻었을 때 이미 입금대기 주문이 있다 — 이 결제는
       PAID이므로 입금 완료로 넘긴다(예전엔 그대로 돌려줘 입금이 영영 반영되지 않을 수 있었다, 2026-10-28 정기 감사). */
    if (existing && existing.payment_method === "virtual_account" && existing.status === "입금대기") {
      await markVirtualAccountPaid(args.paymentId);
      return { ok: true, saved: (await existingOrderForPayment(args.paymentId)) || existing };
    }
    if (existing) return { ok: true, saved: existing };
    return finalizeCardOrderUnlocked(args);
  });
}

async function finalizeVirtualAccountOrder(args) {
  return withPaymentLock(args.paymentId, async () => {
    const existing = await existingOrderForPayment(args.paymentId);
    if (existing) return { ok: true, saved: existing };
    return finalizeVirtualAccountOrderUnlocked(args);
  });
}

/* 가상계좌 "발급" 웹훅이 실패한 채 "입금 완료"가 먼저 오면 결제 상태가 PAID라 카드 주문으로 만들어졌다 — 결제수단은
   결제 정보에서 정한다(2026-10-28 정기 감사). 취소 때 환불 경로가 결제수단을 보고 갈라지기 때문. */
function paidMethodOf(verified) {
  const type = verified && verified.method && verified.method.type;
  return type && /VirtualAccount/i.test(type) ? "virtual_account" : "card";
}

async function finalizeCardOrderUnlocked({ pending, paymentId, userId, paymentMethod = "card" }) {
  const products = await getActiveProducts();
  const { customer, items, raw_items: rawItems, subtotal, shipping, total, coupon_code: couponCode, discount, device } = pending;
  const pointsUsed = pending.points_used || 0;
  const orderNumber = orderNo(await nextOrderSeq());

  /* 쿠폰 사용 횟수 원자적 차감(032_coupon_usage_lock.sql) — 카드결제는 이 시점에 이미 결제가
     끝난 뒤라(돈을 이미 받음) 여기서 소진됐다고 판정돼도 주문 생성 자체를 막지는 않는다(그러면
     "결제는 됐는데 주문은 없는" 사고가 남). 극히 드문 경합으로 usage_limit을 1건 넘기는 것보다
     낫다고 판단 — 대신 시스템 오류 로그로 남겨 관리자가 알 수 있게 한다. */
  /* 이번 실행이 실제로 사용 횟수를 올렸을 때만 실패 시 되돌린다 — 못 올렸는데 되돌리면 used_count가
     실제보다 줄어 사용 한도 쿠폰을 또 쓸 수 있게 된다(2026-10-28 정기 감사). */
  let couponClaimed = false;
  if (couponCode) {
    const claimed = await claimCouponUsage(supabaseAdmin, couponCode);
    couponClaimed = !!claimed;
    if (!claimed) {
      console.warn("[order] 쿠폰 사용 횟수 소진 후 카드결제 확정 — 결제가 이미 끝나 주문은 그대로 생성:", couponCode, paymentId);
      logSystemError("coupon_usage_exceeded", { couponCode, paymentId, stage: "finalize_card_order" });
    }
  }

  /* 포인트 사용 원자적 차감(034_loyalty_points.sql) — 쿠폰과 같은 원칙: 카드결제는 이미 결제가
     끝난 뒤라 잔액 부족으로 판정돼도 주문 생성 자체를 막지 않는다. pending.points_used는
     /api/payments/prepare 시점에 그때 로그인해 있던 사용자 기준으로 계산된 값이라, 결제 확인
     요청(userId) 사이에 로그아웃했다면 차감 대상 계정이 없어 조용히 건너뛴다(적립도 같은 문제). */
  if (pointsUsed && userId) {
    const claimed = await claimPointsUsage(supabaseAdmin, userId, pointsUsed, orderNumber);
    if (!claimed) {
      console.warn("[order] 포인트 잔액 소진 후 카드결제 확정 — 결제가 이미 끝나 주문은 그대로 생성:", userId, paymentId);
      logSystemError("points_balance_exceeded", { userId, pointsUsed, paymentId, stage: "finalize_card_order" });
    }
  }

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
        if (couponClaimed) await releaseCouponUsage(supabaseAdmin, couponCode);
        if (pointsUsed) await reversePointsForOrder(supabaseAdmin, orderNumber);
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
      if (couponClaimed) await releaseCouponUsage(supabaseAdmin, couponCode);
      if (pointsUsed) await reversePointsForOrder(supabaseAdmin, orderNumber);
      return { ok: false, status: 500, body: { error: "재고 확인 중 오류가 발생했습니다." } };
    }
  }

  /* 반품 시 재고를 복원하려면 어떤 상품·사이즈·컬러를 얼마나 샀는지가 주문 레코드 자체에 남아있어야
     한다 — items(name/options/qty/unit/sum)에는 원래 productId가 없어서 나중엔 알 수 없었다.
     rawItems와 순서가 그대로 대응되므로 그대로 붙여서 저장한다. */
  const itemsForStorage = items.map((it, i) => ({ ...it, productId: rawItems[i].productId, size: rawItems[i].size || null, color: rawItems[i].color || null }));

  const pointsEarned = await previewEarnedPoints(supabaseAdmin, userId, total);

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
      points_used: pointsUsed,
      points_earned: pointsEarned,
      payment_method: paymentMethod,
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
      // 재고와 같은 이유로, 이 중복 실행분이 방금 차감한 쿠폰 사용 횟수·포인트도 되돌린다(위 claimCouponUsage 참고).
      if (couponClaimed) await releaseCouponUsage(supabaseAdmin, couponCode);
      if (pointsUsed) await reversePointsForOrder(supabaseAdmin, orderNumber);
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
    if (couponClaimed) await releaseCouponUsage(supabaseAdmin, couponCode);
    if (pointsUsed) await reversePointsForOrder(supabaseAdmin, orderNumber);
    return { ok: false, status: 500, body: { error: "주문 저장에 실패했습니다." } };
  }

  await supabaseAdmin.from("pending_payments").delete().eq("payment_id", paymentId);
  logPaymentAttempt({ paymentId, orderNo: saved.order_no, status: "paid", amount: saved.total });

  sendAdminCardPaid(saved).catch((err) => console.error("[mailer] 카드결제 관리자 알림 메일 발송 실패:", err.message));
  sendCustomerCardPaid(saved).catch((err) => console.error("[mailer] 카드결제 완료 메일 발송 실패:", err.message));
  kakao.sendAlimtalk("CARD_PAID", customer.tel, { name: customer.name, orderNo: saved.order_no }).catch(() => {});
  sendPushToAdmins({ title: "새 주문 접수", body: `${saved.order_no} · 카드결제 완료`, tab: "orders" }).catch((err) =>
    console.error("[push] 알림 발송 실패:", err.message)
  );
  issueThanksCouponsIfEligible(saved).catch((err) => console.error("[thanks-coupon] 처리 실패:", err.message));
  /* 적립은 구매확정 때(lib/purchaseConfirm.js) — 043 마이그레이션 전이라 구매확정 기능이 꺼져 있으면 예전처럼 즉시 적립. */
  confirmationEnabled()
    .then((deferred) => (deferred ? null : creditPoints(supabaseAdmin, userId, pointsEarned, orderNumber)))
    .catch((err) => console.error("[points] 적립 실패:", err.message));

  return { ok: true, saved };
}

/* ---------- 가상계좌 결제 ----------
   카드결제(finalizeCardOrder)와 거의 같은 구조지만 결정적으로 다른 점 하나 — 이 시점엔 아직
   "계좌가 발급됐을 뿐" 돈은 안 들어왔다(status: VIRTUAL_ACCOUNT_ISSUED). 그래서:
   ① 주문을 "입금확인"이 아니라 "입금대기"로 만든다(재고는 무통장입금처럼 미리 잡아둠 —
      특정 계좌+입금기한을 이미 이 주문에 걸어준 상태라 다른 손님에게 같은 재고를 또 파는
      사고를 막아야 함) ② 실패 시 "결제 취소(환불)"가 아니라 "계좌 폐쇄"다(아직 오간 돈이
      없음) ③ 감사쿠폰·적립금은 여기서 안 주고, 실제 입금이 확인돼 "입금확인"이 되는 순간
      (markVirtualAccountPaid, 무통장입금 관리자 확인과 같은 지점)에 준다.
   verified.method는 PaymentMethodVirtualAccount 형태(bank/accountNumber/remitteeName/
   expiredAt) — 실제 발급된 계좌 정보를 고객에게 보여주기 위해 주문에 그대로 저장한다. */
async function finalizeVirtualAccountOrderUnlocked({ pending, paymentId, verified }) {
  const products = await getActiveProducts();
  const { customer, items, raw_items: rawItems, subtotal, shipping, total, coupon_code: couponCode, discount, device } = pending;
  const pointsUsed = pending.points_used || 0;
  const orderNumber = orderNo(await nextOrderSeq());

  let couponClaimed = false;
  if (couponCode) {
    const claimed = await claimCouponUsage(supabaseAdmin, couponCode);
    couponClaimed = !!claimed;
    if (!claimed) {
      console.warn("[order] 쿠폰 사용 횟수 소진 후 가상계좌 발급 확정 — 계좌는 이미 발급돼 주문은 그대로 생성:", couponCode, paymentId);
      logSystemError("coupon_usage_exceeded", { couponCode, paymentId, stage: "finalize_virtual_account_order" });
    }
  }
  if (pointsUsed) {
    const claimed = await claimPointsUsage(supabaseAdmin, pending.user_id, pointsUsed, orderNumber);
    if (!claimed) {
      console.warn("[order] 포인트 잔액 소진 후 가상계좌 발급 확정 — 계좌는 이미 발급돼 주문은 그대로 생성:", pending.user_id, paymentId);
      logSystemError("points_balance_exceeded", { userId: pending.user_id, pointsUsed, paymentId, stage: "finalize_virtual_account_order" });
    }
  }

  const inventoryItems = [];
  rawItems.forEach((raw, i) => {
    if (typeof raw.productId === "string" && !raw.productId.startsWith("charm-") && typeof raw.size === "string" && raw.size) {
      inventoryItems.push({ productId: raw.productId, color: raw.color || "", size: raw.size, qty: items[i].qty });
    }
  });

  async function closeAndRelease() {
    try {
      await portone.closeVirtualAccount(paymentId);
    } catch (closeErr) {
      console.error("[order] ⚠️ 가상계좌 폐쇄 실패 — 수동 확인 필요:", paymentId, closeErr.message);
      logSystemError("virtual_account_close_failed", { paymentId, error: closeErr.message, source: "finalize" });
    }
    if (couponClaimed) await releaseCouponUsage(supabaseAdmin, couponCode);
    if (pointsUsed) await reversePointsForOrder(supabaseAdmin, orderNumber);
  }

  if (inventoryItems.length) {
    const decResult = await decrementInventoryForItems(inventoryItems, products, orderNumber);
    if (!decResult.ok) {
      await closeAndRelease();
      if (decResult.outOfStock) {
        const { productId, color, size, name } = decResult.outOfStock;
        return { ok: false, status: 409, body: { error: "OUT_OF_STOCK", productId, color, size, name } };
      }
      console.error("[order] 재고 차감 실패:", decResult.dbError);
      logSystemError("order_finalize_failed", { paymentId, stage: "inventory_decrement", error: decResult.dbError });
      return { ok: false, status: 500, body: { error: "재고 확인 중 오류가 발생했습니다." } };
    }
  }

  const itemsForStorage = items.map((it, i) => ({ ...it, productId: rawItems[i].productId, size: rawItems[i].size || null, color: rawItems[i].color || null }));
  const vaMethod = verified.method || {};

  const { data: saved, error: saveError } = await insertOrderRow(
    "orders",
    {
      order_no: orderNumber,
      user_id: pending.user_id || null,
      customer,
      items: itemsForStorage,
      device: device || "unknown",
      subtotal,
      shipping,
      total,
      coupon_code: couponCode || null,
      discount: discount || 0,
      points_used: pointsUsed,
      points_earned: 0,
      payment_method: "virtual_account",
      payment_id: paymentId,
      status: "입금대기",
      virtual_account_bank: portone.bankLabel(vaMethod.bank),
      virtual_account_number: vaMethod.accountNumber || null,
      virtual_account_holder: vaMethod.remitteeName || null,
      virtual_account_due_at: vaMethod.expiredAt || null,
    },
    { returning: true }
  );

  if (saveError) {
    if (saveError.code === "23505") {
      // 웹훅(Transaction.VirtualAccountIssued)과 프론트 확인 요청이 겹친 경쟁 상태 — finalizeCardOrder와 같은 처리.
      console.warn("[order] 가상계좌 주문 저장 중복(경쟁 상태) — 기존 주문으로 대체:", paymentId);
      if (inventoryItems.length) {
        const { error: restoreError } = await supabaseAdmin.rpc("restore_inventory", { p_items: inventoryItems });
        if (restoreError) console.error("[order] ⚠️ 중복 저장 정리 중 재고 복원 실패 — 수동 확인 필요:", paymentId, restoreError.message);
        else logInventoryChange(inventoryItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: it.qty, reason: "order_finalize_duplicate", ref: paymentId })));
      }
      if (couponClaimed) await releaseCouponUsage(supabaseAdmin, couponCode);
      if (pointsUsed) await reversePointsForOrder(supabaseAdmin, orderNumber);
      const { data: existing } = await supabaseAdmin.from("orders").select("*").eq("payment_id", paymentId).maybeSingle();
      if (existing) return { ok: true, saved: existing };
      logSystemError("order_finalize_duplicate_not_found", { paymentId });
      return { ok: false, status: 500, body: { error: "주문 처리 중입니다. 잠시 후 주문 조회에서 확인해 주세요." } };
    }

    console.error("[order] 가상계좌 주문 저장 실패:", saveError.message);
    if (inventoryItems.length) {
      const { error: restoreError } = await supabaseAdmin.rpc("restore_inventory", { p_items: inventoryItems });
      if (restoreError) console.error("[order] ⚠️ 주문 저장 실패 후 재고 복원도 실패 — 수동 확인 필요:", paymentId, restoreError.message);
      else logInventoryChange(inventoryItems.map((it) => ({ productId: it.productId, color: it.color, size: it.size, delta: it.qty, reason: "order_finalize_failed", ref: paymentId })));
    }
    if (couponClaimed) await releaseCouponUsage(supabaseAdmin, couponCode);
    if (pointsUsed) await reversePointsForOrder(supabaseAdmin, orderNumber);
    try {
      await portone.closeVirtualAccount(paymentId);
    } catch (closeErr) {
      console.error("[order] ⚠️ 주문 저장 실패 후 가상계좌 폐쇄도 실패 — 수동 확인 필요:", paymentId, closeErr.message);
      logSystemError("virtual_account_close_failed", { paymentId, error: closeErr.message, source: "finalize_save" });
    }
    logSystemError("order_finalize_failed", { paymentId, stage: "order_save", error: saveError.message });
    return { ok: false, status: 500, body: { error: "주문 저장에 실패했습니다." } };
  }

  await supabaseAdmin.from("pending_payments").delete().eq("payment_id", paymentId);
  sendCustomerVirtualAccountIssued(saved).catch((err) => console.error("[mailer] 가상계좌 발급 안내 메일 발송 실패:", err.message));
  sendPushToAdmins({ title: "가상계좌 발급", body: `${saved.order_no} · 입금 대기`, tab: "orders" }).catch((err) =>
    console.error("[push] 알림 발송 실패:", err.message)
  );

  return { ok: true, saved };
}

/* 가상계좌에 실제로 입금이 확인되면(웹훅 Transaction.Paid) 부른다 — 무통장입금을 관리자가
   수동으로 "입금확인" 처리하는 것과 같은 부수효과(입금확인 메일·감사쿠폰·적립금)를 재사용한다
   (notifyOrderStatusSideEffects). 관리자가 개입할 필요 없이 자동으로 일어나는 게 무통장입금과의
   핵심 차이 — README의 "무통장입금은 진짜 실시간 자동 알림이 아님" 제약을 해결하는 지점. */
async function markVirtualAccountPaid(paymentId) {
  const { data: prev, error: prevError } = await supabaseAdmin.from("orders").select("*").eq("payment_id", paymentId).maybeSingle();
  if (prevError || !prev) return { ok: false, notFound: true };
  if (prev.status !== "입금대기") return { ok: true }; // 이미 처리됨(웹훅 재전송 등) — 멱등하게 통과

  const { data: saved, error } = await supabaseAdmin
    .from("orders")
    .update({ status: "입금확인" })
    .eq("order_no", prev.order_no)
    .eq("status", "입금대기")
    .select()
    .maybeSingle();
  if (error || !saved) {
    console.error("[order] 가상계좌 입금확인 처리 실패:", paymentId, error && error.message);
    return { ok: false };
  }
  await notifyOrderStatusSideEffects(prev, saved, { status: "입금확인" });
  sendPushToAdmins({ title: "입금 완료", body: `${saved.order_no} · 가상계좌 입금 확인`, tab: "orders" }).catch((err) =>
    console.error("[push] 알림 발송 실패:", err.message)
  );
  return { ok: true };
}

module.exports = { OPTIONAL_ORDER_COLUMNS, insertOrderRow, tryCancelCardPayment, nextOrderSeq, decrementInventoryForItems, withPaymentLock, existingOrderForPayment, finalizeCardOrder, finalizeVirtualAccountOrder, paidMethodOf, markVirtualAccountPaid };
