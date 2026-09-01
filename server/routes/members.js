/* ---------- 회원 계정 관리 ----------
   가입은 됐지만 이상한 상태인 고객 계정을 관리자가 직접 조회·차단·삭제할 수 있게 한다
   (2026-09-01, README "다음 세션이 가장 먼저 할 일" 19번 참고). admins.js의 "관리자 계정
   관리"와 짝을 이루지만 대상이 반대다 — 이쪽은 role='customer'만 다루고, 관리자 계정은
   여기서 절대 건드릴 수 없게 막는다(관리자 초대/해제는 admins.js가 이미 전담).

   삭제 정책: auth.users를 실제로 지우면 orders.user_id/return_requests.user_id/qna.user_id가
   그 행을 참조하는 외래키라(on delete cascade 없음) 주문 이력이 하나라도 있는 계정은 삭제
   자체가 그냥 실패한다. 그렇다고 주문·문의 기록을 통째로 지우면 세무 기록(주문)과 CS 이력이
   같이 사라진다 — orders.customer에 이름·연락처가 이미 JSON으로 복사돼 있어 레코드 자체는
   계정 없이도 의미가 있으므로, 계정을 지우기 전에 그 세 테이블의 user_id만 null로 끊어
   "회원 정보 없는 과거 기록"으로 남기고, 그 다음에 auth 계정을 지운다(profiles는 on delete
   cascade라 자동으로 같이 없어짐). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { paginationParams } = require("../lib/pagination");

const router = express.Router();

// 영구 차단은 GoTrue가 "언제까지" 형태로만 받아서 값이 필요하다 — 100년을 사실상 영구로 쓴다(Supabase 공식 예시와 동일).
const PERMANENT_BAN = "876000h";

router.get("/api/admin/members", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query, { defaultSize: 20 });
  const q = String(req.query.q || "").trim().toLowerCase();

  const { data: profiles, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, name, created_at")
    .eq("role", "customer");
  if (profileError) return res.status(500).json({ error: "회원 목록을 불러오지 못했습니다." });

  /* admins.js와 같은 이유로 listUsers 한 번(최대 1000명)으로 이메일·인증 여부·마지막 로그인·
     차단 상태까지 가져와 id로 매칭한다 — 가입자가 이 수를 넘어서면 이메일 등을 profiles에
     비정규화해 저장하는 방식으로 바꿔야 한다(admins.js 주석 참고, 지금 매장 규모에선 충분함). */
  const { data: userList } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const userById = new Map((userList?.users || []).map((u) => [u.id, u]));

  let items = profiles.map((p) => {
    const u = userById.get(p.id);
    return {
      id: p.id,
      name: p.name || "",
      email: (u && u.email) || "",
      createdAt: p.created_at,
      emailConfirmed: !!(u && u.email_confirmed_at),
      lastSignInAt: (u && u.last_sign_in_at) || null,
      banned: !!(u && u.banned_until && new Date(u.banned_until) > new Date()),
    };
  });

  if (q) items = items.filter((it) => it.email.toLowerCase().includes(q) || it.name.toLowerCase().includes(q));
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = items.length;
  items = items.slice(from, to + 1);

  res.json({ items, page, pageSize, total });
});

/* role이 customer인 계정만 통과시킨다 — profiles 행이 없거나(가입 트리거 미실행 등) admin이면
   여기서 막아, 관리자 계정 초대/해제 기능과 겹치는 사고를 구조적으로 막는다. */
async function requireCustomerTarget(id, res) {
  const { data: profile, error } = await supabaseAdmin.from("profiles").select("role").eq("id", id).maybeSingle();
  if (error) {
    res.status(500).json({ error: "계정 확인에 실패했습니다." });
    return false;
  }
  if (!profile || profile.role !== "customer") {
    res.status(400).json({ error: "일반 회원 계정만 처리할 수 있습니다." });
    return false;
  }
  return true;
}

router.patch("/api/admin/members/:id/ban", requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (!(await requireCustomerTarget(id, res))) return;

  const banned = !!(req.body && req.body.banned);
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
    ban_duration: banned ? PERMANENT_BAN : "none",
  });
  if (error) return res.status(500).json({ error: banned ? "차단에 실패했습니다." : "차단 해제에 실패했습니다." });

  logAdminAction(req, banned ? "member.ban" : "member.unban", "member", id);
  res.json({ ok: true, banned });
});

router.delete("/api/admin/members/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (!(await requireCustomerTarget(id, res))) return;

  const [{ error: ordersError }, { error: returnsError }, { error: qnaError }] = await Promise.all([
    supabaseAdmin.from("orders").update({ user_id: null }).eq("user_id", id),
    supabaseAdmin.from("return_requests").update({ user_id: null }).eq("user_id", id),
    supabaseAdmin.from("qna").update({ user_id: null }).eq("user_id", id),
  ]);
  if (ordersError || returnsError || qnaError) {
    console.error("[members] 삭제 전 연결 해제 실패:", ordersError?.message, returnsError?.message, qnaError?.message);
    return res.status(500).json({ error: "연결된 주문·문의 기록 정리에 실패해 삭제를 중단했습니다." });
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) return res.status(500).json({ error: "계정 삭제에 실패했습니다." });

  logAdminAction(req, "member.delete", "member", id);
  res.json({ ok: true });
});

module.exports = router;
