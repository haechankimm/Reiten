/* ---------- 공급처 출고 송장 기록 (2026-11-10, 마이그레이션 048) ----------
   프린트캔버스·나염 공장·원단 도매 등 "우리가 물건을 받는 쪽" 배송을 모은다. 고객 주문(orders)·환불과는 전혀 연결되지 않는다.
   ① POST /api/bot/supplier-shipments — 비서 에이전트(피클)가 출고 메일에서 뽑은 값을 보낸다(헤더 X-REITEN-BOT-KEY, lib/botAuth.js).
      같은 공급처+송장번호면 새 줄을 만들지 않고 갱신한다. 상태는 앞으로만 간다(배송완료 뒤 "출고" 메일이 다시 와도 되돌리지 않음),
      metadata는 덮어쓰지 않고 합친다. 메일 본문은 외부에서 온 글이므로 길이·형식을 서버가 다시 자르고 검사한다.
   ② GET /api/admin/supplier-shipments, PATCH /api/admin/supplier-shipments/:id — Works "재고" 탭 "공급처 입고·배송" 목록과
      "입고 완료" 처리(권한 영역 inventory, lib/adminGuard.js).
   에이전트 쓰기는 이 표 하나로만 한정한다 — 여기서 orders·refunds 등 다른 표를 건드리지 말 것(README 0번 피클 원칙). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { isMissingSchemaError } = require("../lib/pgErrors");
const { botWriteLimiter } = require("../lib/rateLimiters");
const { requireBotKey, BOT_ACTOR_ID } = require("../lib/botAuth");
const { COURIERS } = require("../../소스 코드/assets/js/data.js");

const router = express.Router();
const TABLE = "supplier_shipments";

/* 상태 순서 — 봇 갱신은 앞으로만 간다. RECEIVED(입고 완료)·CANCELED(취소)는 관리자가 Works에서만 정한다. */
const STATUS_RANK = { SHIPPED: 1, IN_TRANSIT: 2, DELIVERED: 3, RECEIVED: 4 };
const BOT_STATUSES = ["SHIPPED", "IN_TRANSIT", "DELIVERED"];
const ADMIN_STATUSES = ["SHIPPED", "IN_TRANSIT", "DELIVERED", "RECEIVED", "CANCELED"];
const METADATA_MAX_CHARS = 4000;
const MIGRATION_MISSING = "공급처 송장 표가 아직 없습니다(마이그레이션 048 미실행)";

/* 택배사 코드(tracker.delivery 방식 'kr.cjlogistics' 또는 짧은 이름) → data.js COURIERS key. 모르면 배송조회 링크 없이 송장번호만 보인다. */
const CARRIER_ALIASES = {
  "kr.cjlogistics": "cj", cj: "cj", cjlogistics: "cj",
  "kr.hanjin": "hanjin", hanjin: "hanjin",
  "kr.lotte": "lotte", lotte: "lotte",
  "kr.logen": "logen", logen: "logen",
  "kr.epost": "epost", epost: "epost",
};

function trackingUrl(carrierCode, trackingNumber) {
  const courier = COURIERS.find((c) => c.key === CARRIER_ALIASES[String(carrierCode || "").toLowerCase()]);
  if (!courier || !trackingNumber) return null;
  return courier.urlTemplate.replace("{tracking}", encodeURIComponent(trackingNumber));
}

/* 메일에서 온 글 — 제어문자를 지우고 길이를 자른다. 빈 값은 undefined(= 이번 요청에서 안 바꿈). */
function cleanText(v, max) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
}

function parseDate(v) {
  if (v === undefined || v === null || v === "") return { value: undefined };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { error: true };
  return { value: d.toISOString() };
}

/* 봇 요청 본문 → 저장할 값(snake_case). 순수 함수(테스트용). { fields } 또는 { error } */
function normalizeBotShipment(body) {
  const b = body && typeof body === "object" ? body : {};
  const supplierName = cleanText(b.supplierName, 50);
  const carrierCode = cleanText(b.carrierCode, 50);
  const trackingNumber = String(b.trackingNumber || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (!supplierName || !carrierCode || !trackingNumber) return { error: "필수 정보(공급처, 택배사, 송장번호) 누락" };
  if (trackingNumber.length < 6 || trackingNumber.length > 40) return { error: "송장번호 형식이 올바르지 않습니다(숫자·영문 6~40자)" };
  if (!/^[a-z0-9._-]+$/i.test(carrierCode)) return { error: "택배사 코드 형식이 올바르지 않습니다(예: kr.cjlogistics)" };

  let status;
  if (b.status !== undefined && b.status !== null && b.status !== "") {
    status = String(b.status).toUpperCase();
    if (!BOT_STATUSES.includes(status)) return { error: `status는 ${BOT_STATUSES.join(", ")} 중 하나여야 합니다` };
  }
  const shipped = parseDate(b.shippedAt);
  const delivered = parseDate(b.deliveredAt);
  if (shipped.error || delivered.error) return { error: "날짜 형식이 올바르지 않습니다(ISO 8601)" };

  let metadata;
  if (b.metadata !== undefined && b.metadata !== null) {
    if (typeof b.metadata !== "object" || Array.isArray(b.metadata)) return { error: "metadata는 객체여야 합니다" };
    if (JSON.stringify(b.metadata).length > METADATA_MAX_CHARS) return { error: `metadata가 너무 깁니다(${METADATA_MAX_CHARS}자 이하)` };
    metadata = b.metadata;
  }

  return {
    fields: {
      supplier_name: supplierName.toLowerCase(),
      carrier_code: carrierCode.toLowerCase(),
      tracking_number: trackingNumber,
      supplier_order_id: cleanText(b.supplierOrderId, 100),
      carrier_name: cleanText(b.carrierName, 50),
      items_summary: cleanText(b.itemsSummary, 1000),
      recipient_name: cleanText(b.recipientName, 50),
      status,
      shipped_at: shipped.value,
      delivered_at: delivered.value,
      metadata,
    },
  };
}

function dropUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/* 기존 행 + 새 값 → 갱신할 열만. 상태는 뒤로 가지 않고(관리자가 정한 입고 완료·취소도 유지), metadata는 합친다. */
function buildUpdate(existing, fields, nowIso) {
  const patch = dropUndefined({ ...fields, status: undefined, metadata: undefined, shipped_at: existing.shipped_at ? undefined : fields.shipped_at });
  const cur = existing.status;
  if (fields.status && cur !== "CANCELED" && (STATUS_RANK[fields.status] || 0) > (STATUS_RANK[cur] || 0)) patch.status = fields.status;
  if (fields.metadata) patch.metadata = { ...(existing.metadata || {}), ...fields.metadata };
  if ((patch.status || cur) === "DELIVERED" && !existing.delivered_at && !patch.delivered_at) patch.delivered_at = nowIso;
  patch.updated_at = nowIso;
  return patch;
}

function buildInsert(fields, nowIso) {
  const row = dropUndefined({ ...fields, status: fields.status || "SHIPPED", metadata: fields.metadata || {} });
  if (!row.shipped_at) row.shipped_at = nowIso;
  if (row.status === "DELIVERED" && !row.delivered_at) row.delivered_at = nowIso;
  row.updated_at = nowIso;
  return row;
}

function toApi(r) {
  return {
    id: r.id,
    supplierName: r.supplier_name,
    supplierOrderId: r.supplier_order_id || null,
    carrierCode: r.carrier_code,
    carrierName: r.carrier_name || null,
    trackingNumber: r.tracking_number,
    trackingUrl: trackingUrl(r.carrier_code, r.tracking_number),
    itemsSummary: r.items_summary || null,
    recipientName: r.recipient_name || null,
    status: r.status,
    shippedAt: r.shipped_at || null,
    deliveredAt: r.delivered_at || null,
    metadata: r.metadata || {},
    createdAt: r.created_at || null,
    updatedAt: r.updated_at || null,
  };
}

async function findExisting(supplierName, trackingNumber) {
  return supabaseAdmin.from(TABLE).select("*").eq("supplier_name", supplierName).eq("tracking_number", trackingNumber).maybeSingle();
}

router.post("/api/bot/supplier-shipments", botWriteLimiter, requireBotKey, async (req, res) => {
  const { fields, error: invalid } = normalizeBotShipment(req.body);
  if (invalid) return res.status(400).json({ ok: false, error: invalid });
  const nowIso = new Date().toISOString();

  try {
    let { data: existing, error } = await findExisting(fields.supplier_name, fields.tracking_number);
    if (error) throw error;
    let created = false;
    let row;
    if (!existing) {
      const ins = await supabaseAdmin.from(TABLE).insert(buildInsert(fields, nowIso)).select().single();
      if (ins.error && ins.error.code === "23505") {
        // 같은 메일을 거의 동시에 두 번 보낸 경우 — 먼저 들어간 행을 갱신한다.
        ({ data: existing, error } = await findExisting(fields.supplier_name, fields.tracking_number));
        if (error || !existing) throw error || ins.error;
      } else if (ins.error) {
        throw ins.error;
      } else {
        row = ins.data;
        created = true;
      }
    }
    if (!row) {
      const upd = await supabaseAdmin.from(TABLE).update(buildUpdate(existing, fields, nowIso)).eq("id", existing.id).select().single();
      if (upd.error) throw upd.error;
      row = upd.data;
    }

    supabaseAdmin
      .from("admin_audit_log")
      .insert({
        admin_id: BOT_ACTOR_ID,
        admin_email: "bot:pickle",
        action: created ? "bot.supplier_shipment_create" : "bot.supplier_shipment_update",
        target_type: "supplier_shipment",
        target_id: String(row.id),
        detail: { supplier: row.supplier_name, tracking: row.tracking_number, status: row.status, ip: req.ip },
      })
      .then(({ error: logErr }) => { if (logErr) console.error("[bot] 활동 로그 적재 실패:", logErr.message); });

    res.json({ ok: true, created, shipment: toApi(row) });
  } catch (err) {
    if (isMissingSchemaError(err)) return res.status(503).json({ ok: false, error: MIGRATION_MISSING });
    console.error("[botSupplierShipments]", err && err.message);
    res.status(500).json({ ok: false, error: "송장 동기화 실패" });
  }
});

router.get("/api/admin/supplier-shipments", requireAdmin, async (req, res) => {
  const filter = String(req.query.status || "open");
  let q = supabaseAdmin.from(TABLE).select("*").order("created_at", { ascending: false }).limit(200);
  if (filter === "open") q = q.in("status", ["SHIPPED", "IN_TRANSIT", "DELIVERED"]);
  else if (ADMIN_STATUSES.includes(filter)) q = q.eq("status", filter);
  const { data, error } = await q;
  if (error) {
    if (isMissingSchemaError(error)) return res.json({ items: [], migrationMissing: true });
    console.error("[supplier-shipments] 목록 조회 실패:", error.message);
    return res.status(500).json({ error: "공급처 배송 목록을 불러오지 못했습니다." });
  }
  res.json({ items: (data || []).map(toApi) });
});

router.patch("/api/admin/supplier-shipments/:id", requireAdmin, async (req, res) => {
  const status = String((req.body || {}).status || "").toUpperCase();
  if (!ADMIN_STATUSES.includes(status)) return res.status(400).json({ error: "상태 값이 올바르지 않습니다." });
  const nowIso = new Date().toISOString();
  const patch = { status, updated_at: nowIso };
  if ((status === "DELIVERED" || status === "RECEIVED")) {
    const { data: cur } = await supabaseAdmin.from(TABLE).select("delivered_at").eq("id", req.params.id).maybeSingle();
    if (cur && !cur.delivered_at) patch.delivered_at = nowIso;
  }
  const { data, error } = await supabaseAdmin.from(TABLE).update(patch).eq("id", req.params.id).select().maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) return res.status(503).json({ error: MIGRATION_MISSING });
    console.error("[supplier-shipments] 상태 변경 실패:", error.message);
    return res.status(500).json({ error: "상태를 바꾸지 못했습니다." });
  }
  if (!data) return res.status(404).json({ error: "해당 송장을 찾을 수 없습니다." });
  logAdminAction(req, "supplier_shipment.status", "supplier_shipment", data.id, { status, tracking: data.tracking_number });
  res.json({ ok: true, shipment: toApi(data) });
});

module.exports = router;
module.exports.normalizeBotShipment = normalizeBotShipment;
module.exports.buildUpdate = buildUpdate;
module.exports.buildInsert = buildInsert;
module.exports.trackingUrl = trackingUrl;
