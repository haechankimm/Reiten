/* ---------- 회원 계정 관리 ----------
   가입은 됐지만 이상한 상태인 고객 계정을 관리자가 직접 조회·관리할 수 있게 한다(2026-09-01,
   README "다음 세션이 가장 먼저 할 일" 19번 참고). 조회·검색·CSV 내보내기, 관리자로 승격,
   인증 메일 재발송·수동 인증 처리, 차단·해제, 삭제까지 — 이메일 회원 관리에 보통 있는
   기능들을 한데 모았다(2026-09-01 사용자 요청으로 승격·재발송·수동인증·CSV 추가). admins.js의
   "관리자 계정 관리"와 짝을 이루지만 대상이 반대다 — 이쪽은 role='customer'만 다루고, 이미
   관리자인 계정은 여기서 절대 건드릴 수 없게 막는다(관리자 → 고객 강등은 admins.js "권한
   해제"가 이미 전담하므로 여기서 다시 만들지 않음).

   삭제 정책: auth.users를 실제로 지우면 orders.user_id/return_requests.user_id/qna.user_id가
   그 행을 참조하는 외래키라(on delete cascade 없음) 주문 이력이 하나라도 있는 계정은 삭제
   자체가 그냥 실패한다. 그렇다고 주문·문의 기록을 통째로 지우면 세무 기록(주문)과 CS 이력이
   같이 사라진다 — orders.customer에 이름·연락처가 이미 JSON으로 복사돼 있어 레코드 자체는
   계정 없이도 의미가 있으므로, 계정을 지우기 전에 그 세 테이블의 user_id만 null로 끊어
   "회원 정보 없는 과거 기록"으로 남기고, 그 다음에 auth 계정을 지운다(profiles는 on delete
   cascade라 자동으로 같이 없어짐). */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin, requireMasterAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");
const { paginationParams } = require("../lib/pagination");
const { toCsvGeneric } = require("../lib/orderExport");

const router = express.Router();

const MEMBER_EXPORT_COLUMNS = [
  { key: "email", label: "이메일" },
  { key: "name", label: "이름" },
  { key: "phone", label: "연락처" },
  { key: "createdAt", label: "가입일" },
  { key: "emailConfirmed", label: "이메일 인증" },
  { key: "lastSignInAt", label: "마지막 로그인" },
  { key: "banned", label: "차단 여부" },
];

// 영구 차단은 GoTrue가 "언제까지" 형태로만 받아서 값이 필요하다 — 100년을 사실상 영구로 쓴다(Supabase 공식 예시와 동일).
const PERMANENT_BAN = "876000h";

/* GET 목록과 CSV 내보내기가 "customer 프로필 + auth 사용자 정보 합치고 검색어로 거르기"를
   똑같이 해야 해서 한 곳으로 뺐다(운영 규칙 2 — 같은 로직 두 곳에 복붙하지 않기). */
async function loadFilteredMembers(q) {
  const { data: profiles, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, name, phone, created_at")
    .eq("role", "customer");
  if (profileError) return { error: profileError };

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
      phone: p.phone || "",
      email: (u && u.email) || "",
      createdAt: p.created_at,
      emailConfirmed: !!(u && u.email_confirmed_at),
      lastSignInAt: (u && u.last_sign_in_at) || null,
      banned: !!(u && u.banned_until && new Date(u.banned_until) > new Date()),
    };
  });

  const needle = String(q || "").trim().toLowerCase();
  if (needle) items = items.filter((it) => it.email.toLowerCase().includes(needle) || it.name.toLowerCase().includes(needle));
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { items };
}

router.get("/api/admin/members", requireAdmin, async (req, res) => {
  const { page, pageSize, from, to } = paginationParams(req.query, { defaultSize: 20 });
  const { items: allItems, error } = await loadFilteredMembers(req.query.q);
  if (error) return res.status(500).json({ error: "회원 목록을 불러오지 못했습니다." });

  const total = allItems.length;
  const items = allItems.slice(from, to + 1);
  res.json({ items, page, pageSize, total });
});

router.get("/api/admin/members/export", requireAdmin, async (req, res) => {
  const { items, error } = await loadFilteredMembers(req.query.q);
  if (error) return res.status(500).json({ error: "회원 목록을 불러오지 못했습니다." });

  const rows = items.map((it) => ({
    email: it.email,
    name: it.name,
    phone: it.phone,
    createdAt: it.createdAt ? it.createdAt.slice(0, 10) : "",
    emailConfirmed: it.emailConfirmed ? "인증됨" : "미인증",
    lastSignInAt: it.lastSignInAt ? it.lastSignInAt.slice(0, 10) : "없음",
    banned: it.banned ? "차단됨" : "정상",
  }));

  const filename = `reiten-members-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(toCsvGeneric([{ title: "회원", columns: MEMBER_EXPORT_COLUMNS, rows }]));
  logAdminAction(req, "member.export", "member", "export", { count: rows.length, q: req.query.q || null });
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

/* 관리자로 승격 — 기존에는 "정보" 탭의 이메일 초대(admins.js)로 새 관리자 계정을 만드는
   길밖에 없어서, 이미 가입된 고객을 관리자로 올리려면 그 사람이 다시 초대 메일을 받아 새
   비밀번호를 정하는 번거로운 과정을 거쳐야 했다 — 있는 계정의 role만 바꾸면 되는 일이라
   여기서 바로 처리한다(2026-09-01). 반대 방향(관리자 → 일반 고객)은 이미 admins.js의
   "권한 해제"가 담당하므로 여기서 다시 만들지 않는다. "누가 관리자가 될 수 있는지"는
   마스터 관리자만 정할 수 있어(lib/auth.js 참고) requireMasterAdmin으로 막는다. */
router.patch("/api/admin/members/:id/promote", requireMasterAdmin, async (req, res) => {
  const id = req.params.id;
  if (!(await requireCustomerTarget(id, res))) return;

  const { error } = await supabaseAdmin.from("profiles").update({ role: "admin" }).eq("id", id);
  if (error) return res.status(500).json({ error: "관리자 승격에 실패했습니다." });

  logAdminAction(req, "member.promote", "member", id);
  res.json({ ok: true });
});

/* 인증 메일 재발송 — 2026-09-01 회원가입 이메일 인증 조사 중 나온 요청. 원래 발송된 메일이
   스팸함에 묻히거나 유효기간(보통 24시간)이 지나 링크가 만료됐을 때, 고객이 다시 가입 시도를
   하지 않고도 관리자가 같은 메일을 다시 보내줄 수 있게 한다. Supabase가 공식적으로 안내하는
   `auth.resend()`를 그대로 쓴다(관리자 권한이 아니라 이메일만 있으면 되는 API라 service role
   키로도 동일하게 동작). */
router.post("/api/admin/members/:id/resend-confirmation", requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (!(await requireCustomerTarget(id, res))) return;

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(id);
  if (userError || !userData?.user?.email) return res.status(500).json({ error: "회원 이메일을 확인하지 못했습니다." });
  if (userData.user.email_confirmed_at) return res.status(400).json({ error: "이미 이메일 인증이 완료된 계정입니다." });

  const { error } = await supabaseAdmin.auth.resend({ type: "signup", email: userData.user.email });
  if (error) return res.status(500).json({ error: "인증 메일 재발송에 실패했습니다." });

  logAdminAction(req, "member.resendConfirmation", "member", id);
  res.json({ ok: true });
});

/* 이메일 인증 수동 완료 처리 — 발송 자체가 계속 막히는 등(Resend/SMTP 설정 문제) 정상적인
   인증 메일 경로가 당장 안 될 때 쓰는 비상용 예외 처리다. 본인 확인 없이 관리자 판단만으로
   인증 상태를 강제로 바꾸는 민감한 동작이라 프런트에서 재발송보다 더 강하게 확인시킨다. */
router.patch("/api/admin/members/:id/verify-email", requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (!(await requireCustomerTarget(id, res))) return;

  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { email_confirm: true });
  if (error) return res.status(500).json({ error: "이메일 인증 처리에 실패했습니다." });

  logAdminAction(req, "member.verifyEmail", "member", id);
  res.json({ ok: true });
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
