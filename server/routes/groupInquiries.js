/* 라이딩 크루·동호회 단체 주문 문의(2026-11-21, 056) — 고객 공개 POST /api/group-inquiries(writeLimiter) +
   Works 관리(/api/admin/group-inquiries, 권한 영역 "groups"). 접수되면 관리자 메일·폰 푸시(권한 있는 사람만), 고객 접수 확인 메일.
   견적·결제는 사람이 직접(전화·메일) — 여기서는 문의를 모으고 상태·메모만 관리한다. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { writeLimiter } = require("../lib/rateLimiters");
const { isMissingSchemaError } = require("../lib/pgErrors");
const { paginationParams } = require("../lib/pagination");
const { inquiryFromBody, toInquiryDto, inquiryPatchFromBody, STATUSES } = require("../lib/groupInquiries");

const router = express.Router();
const TABLE = "group_inquiries";
const MIGRATION_MISSING = "DB 마이그레이션 056을 먼저 실행해 주세요(단체 주문 문의).";

router.post("/api/group-inquiries", writeLimiter, async (req, res) => {
  // 봇 차단용 숨은 칸 — 사람은 비워 둔다. 채워져 있으면 접수한 척만 한다.
  if (req.body && req.body.website) return res.json({ ok: true });
  const { row, error: bad } = inquiryFromBody(req.body);
  if (bad) return res.status(400).json({ error: bad });
  const { data, error } = await supabaseAdmin.from(TABLE).insert(row).select().single();
  if (error) {
    console.error("[group-inquiries] 저장 실패:", error.message);
    return res.status(isMissingSchemaError(error) ? 503 : 500).json({ error: "접수에 실패했습니다. 잠시 후 다시 시도하거나 메일로 문의해 주세요." });
  }
  const mailer = require("../lib/mailer");
  mailer.sendAdminGroupInquiry(data).catch((e) => console.error("[mailer] 단체 문의 관리자 메일 실패:", e.message));
  mailer.sendCustomerGroupInquiryReceived(data).catch((e) => console.error("[mailer] 단체 문의 접수 메일 실패:", e.message));
  (async () => {
    const { sendPushToAdmins, pushRecipientsForAreas } = require("../lib/push");
    const ids = await pushRecipientsForAreas(["groups"], "view");
    if (ids.length) await sendPushToAdmins({ title: "단체 주문 문의", body: `${data.team_name} · ${data.quantity}벌`, tab: "groups" }, { adminIds: ids });
  })().catch((e) => console.error("[push] 단체 문의 알림 실패:", e.message));
  res.json({ ok: true });
});

router.get("/api/admin/group-inquiries", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query, { defaultSize: 30 });
  let q = supabaseAdmin.from(TABLE).select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (STATUSES.includes(req.query.status)) q = q.eq("status", req.query.status);
  else if (req.query.status === "open") q = q.in("status", ["접수", "상담중", "견적발송"]);
  const { data, error, count } = await q.range(from, to);
  if (error) {
    if (isMissingSchemaError(error)) return res.json({ items: [], page, pageSize, total: 0, migrationMissing: true });
    return res.status(500).json({ error: "단체 문의를 불러오지 못했습니다." });
  }
  res.json({ items: data.map(toInquiryDto), page, pageSize, total: count ?? data.length, statuses: STATUSES });
});

router.patch("/api/admin/group-inquiries/:id", requireAdmin, async (req, res) => {
  const { patch, error: bad } = inquiryPatchFromBody(req.body);
  if (bad) return res.status(400).json({ error: bad });
  if (!Object.keys(patch).length) return res.status(400).json({ error: "변경할 값이 없습니다." });
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from(TABLE).update(patch).eq("id", req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: "저장에 실패했습니다." });
  if (!data) return res.status(404).json({ error: "존재하지 않는 문의입니다." });
  logAdminAction(req, "group_inquiry.update", "group_inquiry", data.id, { team: data.team_name, ...patch });
  res.json(toInquiryDto(data));
});

module.exports = router;
