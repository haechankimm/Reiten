/* ---------- AI 승인함 — 작업 종류 목록 (2026-11-11, 마이그레이션 054) ----------
   실시간 에이전트 AI(피클)가 "제안"할 수 있는 작업은 이 표에 있는 것뿐이다. 새 작업을 추가할 땐 여기 한 칸 + Works 문구 + pickle-handoff.md.
   각 작업:
   - area: 승인하려면 승인자에게 필요한 권한 영역(lib/adminGuard.js AREAS) — 없으면 승인 버튼이 막힌다
   - prepare(params): 제안 시점·승인 시점에 두 번 검사(그 사이 상태가 바뀌었을 수 있음). 통과하면 정리된 params·대상·바뀔 내용(preview)
   - execute(params, ctx): 기존 관리자 API를 승인자 신분으로 호출(lib/internalDispatch.js) — 메일·재고·적립금·로그가 사람이 누른 것과 똑같이 처리됨
   - undo(record, ctx): 되돌릴 수 있는 작업만(고객에게 메일이 나간 작업은 되돌리기 없음 — 해당 화면에서 사람이 처리)
   - autoAllowed: "조건부 자동 승인"을 켤 수 있는 작업인지(고객에게 글이 나가거나 돈이 나가는 작업은 자동 불가)
   - defaultEnabled: AI 권한 설정의 기본값(리뷰 승인은 사람이 하는 게 기본 — 꺼짐)
   금지(이 표에 절대 넣지 말 것): 환불·주문 취소, 가격 변경, 상품·회원 삭제, 직원 권한, 동업자 정산·송금. */
const { supabaseAdmin } = require("./supabase");
const { dispatch } = require("./internalDispatch");
const { COURIERS } = require("../../소스 코드/assets/js/data.js");
const { maskText } = require("./diagnostics");

const won = (n) => `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}원`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ok = (r) => r.status >= 200 && r.status < 300;
const errOf = (r) => (r.body && r.body.error) || `HTTP ${r.status}`;

async function loadOrder(orderNo) {
  const { data } = await supabaseAdmin.from("orders").select("order_no, status, total, payment_method, courier, tracking_no, customer").eq("order_no", orderNo).maybeSingle();
  return data;
}

const ACTIONS = {
  /* ① 운송장 입력 → 배송중(고객에게 출고 안내 메일) */
  tracking_input: {
    label: "운송장 입력", area: "orders", autoAllowed: true, defaultEnabled: true, undoable: false,
    async prepare(p) {
      const orderNo = String(p.orderNo || "").trim();
      const courier = String(p.courier || "").trim();
      const trackingNo = String(p.trackingNo || "").replace(/[^0-9A-Za-z]/g, "");
      if (!orderNo) return { error: "orderNo가 필요합니다" };
      if (!COURIERS.some((c) => c.key === courier)) return { error: `courier는 ${COURIERS.map((c) => c.key).join(", ")} 중 하나여야 합니다` };
      if (trackingNo.length < 8 || trackingNo.length > 20) return { error: "운송장번호 형식이 올바르지 않습니다(8~20자)" };
      const o = await loadOrder(orderNo);
      if (!o) return { error: "존재하지 않는 주문입니다" };
      if (o.status !== "입금확인") return { error: `입금확인 상태 주문만 가능합니다(지금: ${o.status})` };
      if (o.tracking_no) return { error: "이미 운송장이 입력된 주문입니다" };
      const courierLabel = (COURIERS.find((c) => c.key === courier) || {}).label;
      return {
        params: { orderNo, courier, trackingNo, prevStatus: o.status },
        target: orderNo,
        dedupeKey: `tracking_input:${orderNo}`,
        preview: { lines: [{ label: "주문 상태", before: o.status, after: "배송중" }, { label: "운송장", before: "-", after: `${courierLabel} ${trackingNo}` }], note: "고객에게 출고 안내 메일이 나갑니다", amount: o.total },
      };
    },
    async execute(p, ctx) {
      const r = await dispatch({ ...ctx, method: "PATCH", path: `/api/admin/orders/${encodeURIComponent(p.orderNo)}`, body: { status: "배송중", courier: p.courier, trackingNo: p.trackingNo, expected: { status: p.prevStatus, trackingNo: "" } } });
      return ok(r) ? { ok: true } : { error: errOf(r) };
    },
  },

  /* ② 입금 확인(무통장) — 주문 금액과 입금액이 정확히 같을 때만 */
  deposit_confirm: {
    label: "입금 확인", area: "orders", autoAllowed: true, defaultEnabled: true, undoable: false, amountBased: true,
    async prepare(p) {
      const orderNo = String(p.orderNo || "").trim();
      const amount = Math.round(Number(String(p.amount ?? "").replace(/[^0-9.-]/g, "")));
      if (!orderNo || !Number.isFinite(amount)) return { error: "orderNo와 amount(입금액)가 필요합니다" };
      const o = await loadOrder(orderNo);
      if (!o) return { error: "존재하지 않는 주문입니다" };
      if (o.status !== "입금대기") return { error: `입금대기 주문만 가능합니다(지금: ${o.status})` };
      if (o.payment_method === "card" || o.payment_method === "virtual_account") return { error: "무통장입금 주문만 가능합니다(카드·가상계좌는 결제사가 자동 처리)" };
      if (amount !== o.total) return { error: `금액이 다릅니다(주문 ${won(o.total)}, 입금 ${won(amount)})` };
      const depositor = String(p.depositor || "").trim().slice(0, 30);
      return {
        params: { orderNo, amount },
        target: orderNo,
        dedupeKey: `deposit_confirm:${orderNo}`,
        preview: { lines: [{ label: "주문 상태", before: "입금대기", after: "입금확인" }, { label: "입금액", before: won(o.total), after: `${won(amount)}${depositor ? ` (${maskText(depositor).slice(0, 1)}**)` : ""}` }], note: "고객에게 입금 확인 메일이 나가고 출고 준비 단계로 넘어갑니다", amount },
      };
    },
    async execute(p, ctx) {
      const r = await dispatch({ ...ctx, method: "PATCH", path: `/api/admin/orders/${encodeURIComponent(p.orderNo)}`, body: { status: "입금확인", expected: { status: "입금대기" } } });
      return ok(r) ? { ok: true } : { error: errOf(r) };
    },
  },

  /* ③ 공급처 입고 처리 — AI가 만든 입고 품목(상품·색상·사이즈가 모두 매칭된 것)으로 재고 반영 */
  supplier_receive: {
    label: "공급처 입고 처리", area: "inventory", autoAllowed: true, defaultEnabled: true, undoable: true,
    async prepare(p) {
      const id = String(p.shipmentId || "");
      if (!UUID_RE.test(id)) return { error: "shipmentId가 올바르지 않습니다" };
      const { data: s } = await supabaseAdmin.from("supplier_shipments").select("*").eq("id", id).maybeSingle();
      if (!s) return { error: "공급처 송장을 찾을 수 없습니다" };
      if (s.status === "RECEIVED" || s.status === "CANCELED") return { error: "이미 입고 완료(또는 취소)된 송장입니다" };
      const items = Array.isArray(p.items) && p.items.length ? p.items : s.receipt_items || [];
      if (!items.length) return { error: "입고 품목이 없습니다(송장에 receiptItems를 먼저 기록)" };
      if (items.some((it) => !it || !it.productId || !it.color || !it.size || !(Number(it.qty) > 0))) return { error: "상품·색상·사이즈가 모두 매칭된 품목만 자동으로 입고할 수 있습니다(사람이 Works에서 처리)" };
      const clean = items.map((it) => ({ productId: String(it.productId), color: String(it.color), size: String(it.size), qty: Math.floor(Number(it.qty)) }));
      return {
        params: { shipmentId: id, items: clean },
        target: `${s.supplier_label || s.supplier_name} ${s.tracking_number}`,
        dedupeKey: `supplier_receive:${id}`,
        preview: { lines: clean.map((it) => ({ label: `${it.productId} ${it.color} ${it.size}`, before: "재고", after: `+${it.qty}` })), note: "재고가 늘고 입고 완료로 바뀝니다(품절 알림 신청자에게 재입고 메일)" },
      };
    },
    async execute(p, ctx) {
      const r = await dispatch({ ...ctx, method: "POST", path: `/api/admin/supplier-shipments/${p.shipmentId}/receive`, body: { items: p.items } });
      return ok(r) ? { ok: true } : { error: errOf(r) };
    },
    async undo(rec, ctx) {
      const r = await dispatch({ ...ctx, method: "POST", path: `/api/admin/supplier-shipments/${rec.params.shipmentId}/receive/undo` });
      return ok(r) ? { ok: true } : { error: errOf(r) };
    },
  },

  /* ④ 문의 답변 등록 — AI 초안(또는 제안한 문장)을 실제 답변으로(고객에게 안내 메일) */
  qna_answer: {
    label: "문의 답변 등록", area: "qna", autoAllowed: false, defaultEnabled: true, undoable: false,
    async prepare(p) {
      const id = String(p.qnaId || "");
      if (!UUID_RE.test(id)) return { error: "qnaId가 올바르지 않습니다" };
      const { data: q } = await supabaseAdmin.from("qna").select("id, question, status, ai_draft").eq("id", id).maybeSingle();
      if (!q) return { error: "문의를 찾을 수 없습니다" };
      if (q.status !== "답변대기") return { error: "이미 답변된 문의입니다" };
      const answer = String(p.answer || q.ai_draft || "").trim().slice(0, 2000);
      if (!answer) return { error: "답변 내용이 없습니다(answer 또는 초안 필요)" };
      return {
        params: { qnaId: id, answer },
        target: `문의 ${maskText(String(q.question || "")).slice(0, 30)}…`,
        dedupeKey: `qna_answer:${id}`,
        preview: { lines: [{ label: "문의", before: maskText(String(q.question || "")).slice(0, 200), after: "" }, { label: "답변", before: "", after: answer }], note: "승인하면 고객에게 답변 안내 메일이 나갑니다 — 문장을 꼭 읽어 보세요" },
      };
    },
    async execute(p, ctx) {
      const r = await dispatch({ ...ctx, method: "PATCH", path: `/api/admin/qna/${p.qnaId}`, body: { answer: p.answer } });
      return ok(r) ? { ok: true } : { error: errOf(r) };
    },
  },

  /* ⑤ 지출 확인(분류 정정 포함) */
  expense_confirm: {
    label: "지출 확인", area: "expenses", autoAllowed: true, defaultEnabled: true, undoable: true, amountBased: true,
    async prepare(p) {
      const id = String(p.expenseId || "");
      if (!UUID_RE.test(id)) return { error: "expenseId가 올바르지 않습니다" };
      const { data: e } = await supabaseAdmin.from("supplier_invoices").select("*").eq("id", id).maybeSingle();
      if (!e) return { error: "지출을 찾을 수 없습니다" };
      if (e.status !== "RECORDED") return { error: "확인 대기 상태가 아닙니다" };
      const { CATEGORIES } = require("./expenses");
      const category = p.category ? String(p.category) : null;
      if (category && !CATEGORIES[category]) return { error: "분류가 올바르지 않습니다" };
      const lines = [{ label: "상태", before: "확인 대기", after: "확인" }, { label: "금액", before: won(e.total_amount), after: won(e.total_amount) }];
      if (category && category !== e.category) lines.push({ label: "분류", before: (CATEGORIES[e.category] || {}).label || e.category, after: CATEGORIES[category].label });
      return {
        params: { expenseId: id, category: category || undefined, prev: { status: e.status, category: e.category } },
        target: `${e.supplier_label || e.supplier_name} ${e.issued_on}`,
        dedupeKey: `expense_confirm:${id}`,
        preview: { lines, amount: e.total_amount },
      };
    },
    async execute(p, ctx) {
      const r = await dispatch({ ...ctx, method: "PATCH", path: `/api/admin/supplier-invoices/${p.expenseId}`, body: { status: "CONFIRMED", ...(p.category ? { category: p.category } : {}) } });
      return ok(r) ? { ok: true } : { error: errOf(r) };
    },
    async undo(rec, ctx) {
      const r = await dispatch({ ...ctx, method: "PATCH", path: `/api/admin/supplier-invoices/${rec.params.expenseId}`, body: { status: "RECORDED", ...(rec.params.category ? { category: rec.params.prev.category } : {}) } });
      return ok(r) ? { ok: true } : { error: errOf(r) };
    },
  },

  /* ⑥ 상품 판매 중지·재개(공개·비공개) */
  product_active: {
    label: "상품 판매 중지·재개", area: "products", autoAllowed: false, defaultEnabled: true, undoable: true,
    async prepare(p) {
      const id = String(p.productId || "");
      const active = p.active === true || p.active === "true";
      const { data: pr } = await supabaseAdmin.from("products").select("id, name_ko, active").eq("id", id).maybeSingle();
      if (!pr) return { error: "상품을 찾을 수 없습니다" };
      if (!!pr.active === active) return { error: `이미 ${active ? "판매 중" : "비공개"}입니다` };
      return {
        params: { productId: id, active },
        target: pr.name_ko || id,
        dedupeKey: `product_active:${id}`,
        preview: { lines: [{ label: "사이트 노출", before: pr.active ? "판매 중" : "비공개", after: active ? "판매 중" : "비공개" }] },
      };
    },
    async execute(p, ctx) {
      const r = await dispatch({ ...ctx, method: "PATCH", path: "/api/admin/products/bulk-active", body: { ids: [p.productId], active: p.active } });
      return ok(r) ? { ok: true } : { error: errOf(r) };
    },
    async undo(rec, ctx) {
      const r = await dispatch({ ...ctx, method: "PATCH", path: "/api/admin/products/bulk-active", body: { ids: [rec.params.productId], active: !rec.params.active } });
      return ok(r) ? { ok: true } : { error: errOf(r) };
    },
  },

  /* ⑦ 재고 수량 조정(실사·파손 등) — 바뀔 수량을 그대로 지정 */
  inventory_adjust: {
    label: "재고 수량 조정", area: "inventory", autoAllowed: false, defaultEnabled: true, undoable: true,
    async prepare(p) {
      const productId = String(p.productId || "");
      const color = String(p.color || "");
      const size = String(p.size || "");
      const qty = Math.floor(Number(p.qty));
      if (!Number.isFinite(qty) || qty < 0 || qty > 100000) return { error: "qty는 0~100000 정수입니다" };
      const { data: pr } = await supabaseAdmin.from("products").select("id, name_ko, colors, sizes").eq("id", productId).maybeSingle();
      if (!pr || !(pr.colors || []).includes(color) || !(pr.sizes || []).includes(size)) return { error: "상품·색상·사이즈 조합이 올바르지 않습니다" };
      const { data: inv } = await supabaseAdmin.from("inventory").select("qty").eq("product_id", productId).eq("color", color).eq("size", size).maybeSingle();
      const before = inv ? inv.qty : 0;
      if (before === qty) return { error: "지금 수량과 같습니다" };
      return {
        params: { productId, color, size, qty, before },
        target: `${pr.name_ko || productId} ${color} ${size}`,
        dedupeKey: `inventory_adjust:${productId}:${color}:${size}`,
        preview: { lines: [{ label: "재고", before: String(before), after: String(qty) }], note: String(p.note || "").slice(0, 120) || undefined },
      };
    },
    async execute(p, ctx) {
      const r = await dispatch({ ...ctx, method: "PATCH", path: "/api/admin/inventory/bulk", body: { items: [{ productId: p.productId, color: p.color, size: p.size, qty: p.qty }] } });
      return ok(r) ? { ok: true } : { error: errOf(r) };
    },
    async undo(rec, ctx) {
      const p = rec.params;
      const r = await dispatch({ ...ctx, method: "PATCH", path: "/api/admin/inventory/bulk", body: { items: [{ productId: p.productId, color: p.color, size: p.size, qty: p.before }] } });
      return ok(r) ? { ok: true } : { error: errOf(r) };
    },
  },

  /* ⑧ 사진 리뷰 승인(적립금 지급) — 기본 꺼짐(사람이 하는 게 기본, 사용자 결정 2026-11-11) */
  review_approve: {
    label: "리뷰 승인", area: "reviews", autoAllowed: false, defaultEnabled: false, undoable: true,
    async prepare(p) {
      const id = String(p.reviewId || "");
      const { data: rv } = await supabaseAdmin.from("reviews").select("id, product_id, comment, rating, approved, photo_url").eq("id", id).maybeSingle();
      if (!rv) return { error: "리뷰를 찾을 수 없습니다" };
      if (rv.approved) return { error: "이미 승인된 리뷰입니다" };
      return {
        params: { reviewId: id },
        target: `${rv.product_id} ★${rv.rating || ""}`,
        dedupeKey: `review_approve:${id}`,
        preview: { lines: [{ label: "리뷰", before: maskText(String(rv.comment || "")).slice(0, 200), after: "공개" }], note: "사진 리뷰면 적립금이 지급됩니다(되돌려도 적립금은 회수되지 않음)" },
      };
    },
    async execute(p, ctx) {
      const r = await dispatch({ ...ctx, method: "PATCH", path: `/api/admin/reviews/${encodeURIComponent(p.reviewId)}`, body: { approved: true } });
      return ok(r) ? { ok: true } : { error: errOf(r) };
    },
    async undo(rec, ctx) {
      const r = await dispatch({ ...ctx, method: "PATCH", path: `/api/admin/reviews/${encodeURIComponent(rec.params.reviewId)}`, body: { approved: false } });
      return ok(r) ? { ok: true } : { error: errOf(r) };
    },
  },
};

/* ---------- AI 권한 설정(agent_policy) ---------- */
function defaultPolicy() {
  return {
    enabled: true,
    actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { enabled: a.defaultEnabled, autoApprove: false, autoDailyLimit: 20, autoMaxAmount: a.amountBased ? 50000 : null }])),
  };
}

function normalizePolicy(raw) {
  const def = defaultPolicy();
  const p = raw && typeof raw === "object" ? raw : {};
  const out = { enabled: p.enabled === undefined ? def.enabled : !!p.enabled, actions: {} };
  for (const [k, a] of Object.entries(ACTIONS)) {
    const cur = (p.actions && p.actions[k]) || {};
    const d = def.actions[k];
    out.actions[k] = {
      enabled: cur.enabled === undefined ? d.enabled : !!cur.enabled,
      autoApprove: a.autoAllowed ? !!cur.autoApprove : false,
      autoDailyLimit: Math.max(0, Math.min(500, Math.floor(Number(cur.autoDailyLimit ?? d.autoDailyLimit)) || 0)),
      autoMaxAmount: a.amountBased ? Math.max(0, Math.floor(Number(cur.autoMaxAmount ?? d.autoMaxAmount)) || 0) : null,
    };
  }
  return out;
}

async function loadPolicy(db = supabaseAdmin) {
  const { data, error } = await db.from("agent_policy").select("*").eq("id", 1).maybeSingle();
  if (error) return { error };
  return { policy: normalizePolicy(data && data.policy), updatedBy: data && data.updated_by, updatedAt: data && data.updated_at };
}

function catalog() {
  return Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { label: a.label, area: a.area, autoAllowed: !!a.autoAllowed, undoable: !!a.undoable, amountBased: !!a.amountBased, defaultEnabled: a.defaultEnabled }]));
}

module.exports = { ACTIONS, defaultPolicy, normalizePolicy, loadPolicy, catalog };
