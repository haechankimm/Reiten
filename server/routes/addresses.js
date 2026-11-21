/* 회원 배송지 주소록(/api/my/addresses, 로그인 필요) + 출고 전 고객 셀프 배송지 변경(POST /api/orders/address) — 2026-11-21, 056.
   배송지 변경: 회원은 로그인으로, 비회원은 주문번호+연락처로 본인 확인. 입금대기·입금확인이고 운송장이 아직 없을 때만.
   바뀌면 관리자에게 폰 푸시(주문 권한 있는 사람)·메일, Works 주문 상세에 "고객이 배송지 변경 + 이전 주소"가 보인다. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAuth, optionalAuth } = require("../lib/auth");
const { writeLimiter } = require("../lib/rateLimiters");
const { isMissingSchemaError } = require("../lib/pgErrors");
const { normalizeTel } = require("../lib/phone");
const { serializeByOrder } = require("../lib/orderLock");
const { MAX_ADDRESSES, shipFields, addressFromBody, toAddressDto, sameAddress, canEditAddress, applyAddressChange } = require("../lib/addresses");

const router = express.Router();
const TABLE = "customer_addresses";
const MIGRATION_MISSING = "주소록 기능이 아직 준비 중입니다.";

/* ---------- 주소록 ---------- */
router.get("/api/my/addresses", requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("user_id", req.user.id).order("is_default", { ascending: false }).order("updated_at", { ascending: false });
  if (error) return res.json({ items: [], unavailable: isMissingSchemaError(error) || undefined });
  res.json({ items: data.map(toAddressDto), max: MAX_ADDRESSES });
});

router.post("/api/my/addresses", writeLimiter, requireAuth, async (req, res) => {
  const { row, error: bad } = addressFromBody(req.body);
  if (bad) return res.status(400).json({ error: bad });
  const { data: existing, error: listErr } = await supabaseAdmin.from(TABLE).select("*").eq("user_id", req.user.id);
  if (listErr) return res.status(isMissingSchemaError(listErr) ? 503 : 500).json({ error: isMissingSchemaError(listErr) ? MIGRATION_MISSING : "주소록을 불러오지 못했습니다." });
  const now = new Date().toISOString();
  const dup = (existing || []).find((a) => sameAddress(a, row));
  if (dup) {
    // 같은 배송지면 새로 만들지 않고 최근 사용으로 올린다(연락처가 바뀌었으면 갱신)
    const { data } = await supabaseAdmin.from(TABLE).update({ tel: row.tel, label: row.label || dup.label, updated_at: now }).eq("id", dup.id).select().maybeSingle();
    return res.json({ ...toAddressDto(data || dup), duplicate: true });
  }
  if ((existing || []).length >= MAX_ADDRESSES) return res.status(400).json({ error: `배송지는 ${MAX_ADDRESSES}개까지 저장할 수 있습니다. 안 쓰는 배송지를 지워 주세요.`, code: "ADDRESS_LIMIT" });
  const first = !(existing || []).length;
  const wantDefault = first || !!(req.body && req.body.isDefault);
  if (wantDefault && !first) await supabaseAdmin.from(TABLE).update({ is_default: false }).eq("user_id", req.user.id);
  const { data, error } = await supabaseAdmin.from(TABLE).insert({ ...row, user_id: req.user.id, is_default: wantDefault }).select().single();
  if (error) return res.status(500).json({ error: "배송지 저장에 실패했습니다." });
  res.json(toAddressDto(data));
});

router.patch("/api/my/addresses/:id", writeLimiter, requireAuth, async (req, res) => {
  const { data: cur } = await supabaseAdmin.from(TABLE).select("*").eq("id", req.params.id).eq("user_id", req.user.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: "배송지를 찾을 수 없습니다." });
  const patch = { updated_at: new Date().toISOString() };
  if (req.body && req.body.label !== undefined) patch.label = String(req.body.label || "").trim().slice(0, 30) || null;
  if (req.body && req.body.isDefault) {
    await supabaseAdmin.from(TABLE).update({ is_default: false }).eq("user_id", req.user.id);
    patch.is_default = true;
  }
  const { data, error } = await supabaseAdmin.from(TABLE).update(patch).eq("id", cur.id).eq("user_id", req.user.id).select().maybeSingle();
  if (error || !data) return res.status(500).json({ error: "저장에 실패했습니다." });
  res.json(toAddressDto(data));
});

router.delete("/api/my/addresses/:id", writeLimiter, requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin.from(TABLE).delete().eq("id", req.params.id).eq("user_id", req.user.id).select("id, is_default");
  if (error) return res.status(500).json({ error: "삭제에 실패했습니다." });
  if (!data || !data.length) return res.status(404).json({ error: "배송지를 찾을 수 없습니다." });
  // 기본 배송지를 지웠으면 가장 최근 것을 기본으로
  if (data[0].is_default) {
    const { data: next } = await supabaseAdmin.from(TABLE).select("id").eq("user_id", req.user.id).order("updated_at", { ascending: false }).limit(1);
    if (next && next.length) await supabaseAdmin.from(TABLE).update({ is_default: true }).eq("id", next[0].id);
  }
  res.json({ ok: true });
});

/* ---------- 출고 전 셀프 배송지 변경 ---------- */
router.post("/api/orders/address", writeLimiter, optionalAuth, serializeByOrder((req) => String((req.body && req.body.orderNo) || "").trim(), async (req, res) => {
  const b = req.body || {};
  const orderNo = String(b.orderNo || "").trim();
  if (!orderNo) return res.status(400).json({ error: "주문번호가 필요합니다." });
  const ship = shipFields(b);
  if (ship.error) return res.status(400).json({ error: ship.error });
  const memo = b.memo !== undefined ? String(b.memo || "").replace(/\s+/g, " ").trim().slice(0, 200) : undefined;

  const { data: order, error } = await supabaseAdmin.from("orders").select("*").eq("order_no", orderNo).maybeSingle();
  if (error) return res.status(500).json({ error: "주문을 불러오지 못했습니다." });
  // 본인 확인: 로그인 회원의 주문이거나, 연락처가 일치. 어느 쪽이 틀렸는지는 알려주지 않는다(주문 조회와 같은 원칙).
  const ownByLogin = !!(order && req.user && order.user_id && order.user_id === req.user.id);
  const ownByTel = !!(order && b.tel && normalizeTel(b.tel) && normalizeTel(order.customer && order.customer.tel) === normalizeTel(b.tel));
  if (!order || !(ownByLogin || ownByTel)) return res.status(404).json({ error: "일치하는 주문을 찾을 수 없습니다." });
  if (!canEditAddress(order)) {
    return res.status(409).json({ error: "이미 출고 준비가 끝났거나 취소된 주문이라 배송지를 바꿀 수 없습니다. 고객센터(채널톡)로 문의해 주세요.", code: "NOT_EDITABLE" });
  }

  const prev = { zip: order.customer.zip, addr: order.customer.addr, addr2: order.customer.addr2 };
  const customer = applyAddressChange(order.customer, { ...ship, memo });
  // 그 사이 관리자가 운송장을 넣었으면 덮어쓰지 않는다
  const { data: saved, error: upErr } = await supabaseAdmin
    .from("orders")
    .update({ customer })
    .eq("order_no", orderNo)
    .in("status", ["입금대기", "입금확인"])
    .is("tracking_no", null)
    .select()
    .maybeSingle();
  if (upErr) return res.status(500).json({ error: "배송지 변경에 실패했습니다." });
  if (!saved) return res.status(409).json({ error: "방금 출고 준비가 시작돼 배송지를 바꿀 수 없습니다. 고객센터로 문의해 주세요.", code: "NOT_EDITABLE" });

  require("../lib/mailer").sendAdminAddressChanged(saved, prev).catch((e) => console.error("[mailer] 배송지 변경 알림 실패:", e.message));
  (async () => {
    const { sendPushToAdmins, pushRecipientsForAreas } = require("../lib/push");
    const ids = await pushRecipientsForAreas(["orders"], "view");
    if (ids.length) await sendPushToAdmins({ title: "고객 배송지 변경", body: `${saved.order_no} · ${saved.status}`, tab: "orders" }, { adminIds: ids });
  })().catch((e) => console.error("[push] 배송지 변경 알림 실패:", e.message));
  res.json({ ok: true, shipTo: { zip: saved.customer.zip, addr: saved.customer.addr } });
}));

module.exports = router;
