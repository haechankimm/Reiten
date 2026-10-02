/* 고객 셀프 회원탈퇴 — 계정 페이지에서 "탈퇴"를 입력해 확인한 뒤 호출한다.
   관리자 계정은 여기서 탈퇴할 수 없고(Works에서 권한 해제 먼저), 진행 중인 주문이 있으면 막는다. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAuth } = require("../lib/auth");
const { writeLimiter } = require("../lib/rateLimiters");
const { deleteCustomerAccount, hasActiveOrders } = require("../lib/accountDeletion");

const router = express.Router();

router.delete("/api/my/account", writeLimiter, requireAuth, async (req, res) => {
  if ((req.body || {}).confirm !== "탈퇴") return res.status(400).json({ error: "확인 문구가 올바르지 않습니다." });

  const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", req.user.id).maybeSingle();
  if (profile && profile.role === "admin") {
    return res.status(400).json({ error: "관리자 계정은 탈퇴할 수 없습니다. 마스터 관리자에게 권한 해제를 먼저 요청해 주세요." });
  }
  if (await hasActiveOrders(req.user.id)) {
    return res.status(409).json({ error: "진행 중인 주문(입금대기·입금확인·배송중)이 있어 지금은 탈퇴할 수 없습니다. 배송이 끝난 뒤 다시 시도하거나 고객센터로 문의해 주세요.", code: "ACTIVE_ORDERS" });
  }

  const result = await deleteCustomerAccount(req.user.id);
  if (!result.ok) {
    console.error("[account] 탈퇴 실패:", req.user.id, result.error);
    return res.status(500).json({ error: "탈퇴 처리에 실패했습니다. 잠시 후 다시 시도하거나 고객센터로 문의해 주세요." });
  }
  res.json({ ok: true });
});

module.exports = router;
