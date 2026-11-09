/* ---------- Works 브라우저 푸시 알림 구독 관리 ----------
   실제 발송(lib/push.js의 sendPushToAdmins)은 새 주문 접수 시점에 server.js에서 호출한다 —
   여기는 관리자 브라우저의 구독 등록/해제만 담당하는, 돈·재고를 건드리지 않는 순수 CRUD라
   별도 파일로 분리했다(2026-09-01). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { configured } = require("../lib/push");
const { isMissingSchemaError } = require("../lib/pgErrors");

const router = express.Router();

router.get("/api/admin/push/public-key", requireAdmin, (req, res) => {
  res.json({ publicKey: configured ? process.env.VAPID_PUBLIC_KEY : null });
});

/* 실제 브라우저 푸시 서비스 주소만 받는다 — 아무 주소나 저장되면 서버가 새 주문·긴급 오류 때마다 그 주소로 요청을
   보내게 돼(내부망 주소 포함) 직원 계정으로 서버를 엉뚱한 곳에 접속시킬 수 있었다(2026-10-28 정기 감사). */
const PUSH_HOST_PATTERNS = [
  /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /^web\.push\.apple\.com$/,
];
function isPushEndpoint(endpoint) {
  try {
    const u = new URL(String(endpoint));
    return u.protocol === "https:" && PUSH_HOST_PATTERNS.some((re) => re.test(u.hostname));
  } catch (e) {
    return false;
  }
}

router.post("/api/admin/push/subscribe", requireAdmin, async (req, res) => {
  const sub = req.body && req.body.subscription;
  if (!sub || !sub.endpoint || !sub.keys || typeof sub.keys !== "object" || !isPushEndpoint(sub.endpoint)) {
    return res.status(400).json({ error: "구독 정보가 올바르지 않습니다." });
  }

  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .upsert({ endpoint: sub.endpoint, admin_id: req.user.id, keys: sub.keys }, { onConflict: "endpoint" });
  if (error) {
    if (isMissingSchemaError(error)) {
      return res.status(503).json({ error: "지금은 브라우저 알림을 켤 수 없습니다(관리자에게 문의해 주세요)." });
    }
    console.error("[admin/push] 구독 저장 실패:", error.message);
    return res.status(500).json({ error: "구독 저장에 실패했습니다." });
  }
  res.json({ ok: true });
});

router.delete("/api/admin/push/subscribe", requireAdmin, async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint) return res.status(400).json({ error: "endpoint가 필요합니다." });

  const { error } = await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error && !isMissingSchemaError(error)) {
    console.error("[admin/push] 구독 해제 실패:", error.message);
    return res.status(500).json({ error: "구독 해제에 실패했습니다." });
  }
  res.json({ ok: true });
});

module.exports = router;
