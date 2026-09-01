/* ---------- 관리자 계정 관리 ----------
   예전엔 "고객 페이지에서 회원가입 → Supabase SQL Editor에서 role을 수동으로 admin으로
   승격"해야 했다(README 참고). Supabase Admin API의 inviteUserByEmail로 이 과정을 Works
   안에서 바로 처리한다 — 초대 메일의 링크로 본인이 직접 비밀번호를 정하므로, 관리자가 임시
   비밀번호를 만들어 전달할 필요가 없다(account.html이 이미 갖고 있는 "비밀번호 재설정" 화면을
   그대로 재사용).
   돈·재고를 건드리지 않는 순수 CRUD라 라우트 분리 다음 라운드에서 분리했다(2026-09-01).
   초대(POST)·해제(DELETE)는 requireMasterAdmin — "누가 관리자가 될 수 있는지"는 마스터
   관리자 한 명만 정할 수 있다(lib/auth.js 주석 참고). 목록 조회(GET)는 그대로 관리자 전원이
   볼 수 있게 뒀다 — 누가 관리자인지 보는 것 자체는 위험하지 않고, 계정 관리 화면이 통째로
   비어 보이면 오히려 혼란스러움. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");
const { requireAdmin, requireMasterAdmin } = require("../lib/auth");
const { logAdminAction } = require("../lib/adminLog");

const router = express.Router();

router.get("/api/admin/admins", requireAdmin, async (req, res) => {
  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id, name, created_at")
    .eq("role", "admin")
    .order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: "관리자 목록을 불러오지 못했습니다." });

  /* 관리자 한 명당 getUserById()를 따로 부르면(N+1) 관리자가 늘어날수록 호출 수가 그만큼
     늘어난다 — Admin API는 ID로 콕 집어 배치 조회하는 기능이 없어서, 대신 listUsers()
     한 번으로 이메일까지 전부 가져와 매칭한다(가입자 총 수가 이 perPage를 넘지 않는 한
     항상 1번의 호출로 끝남 — 이 매장 규모에서는 충분하지만, 가입자가 그 이상으로 늘어나면
     프로필에 이메일을 비정규화해 저장하는 방식으로 바꿔야 함). */
  const { data: userList } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map((userList?.users || []).map((u) => [u.id, u.email || ""]));
  const items = profiles.map((p) => ({ id: p.id, name: p.name || "", email: emailById.get(p.id) || "", createdAt: p.created_at }));
  res.json({ items });
});

router.post("/api/admin/admins", requireMasterAdmin, async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  const name = String((req.body || {}).name || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "올바른 이메일을 입력해 주세요." });
  }

  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: name ? { name } : undefined,
    redirectTo: "https://reiten.kr/account.html",
  });
  if (error) {
    /* 이미 가입돼 있는 이메일이면(예: 고객으로 먼저 가입한 사람을 나중에 관리자로 올리려는
       경우) Supabase가 영어 원문 에러("A user with this email address has already been
       registered" 등, 상황에 따라 error.code가 "email_exists"로 오기도 함)를 그대로 주는데,
       그걸 그냥 실패로 보여주면 안내가 안 된다(2026-09-01 사용자가 실제로 겪은 문제). 이미
       있는 계정이면 승격 대상 id를 같이 돌려줘서, 프런트가 "관리자로 승격할까요?"로 물어보고
       확인되면 members.js의 승격 엔드포인트를 그대로 재사용하게 한다(로직 중복 없음). */
    const alreadyExists = error.code === "email_exists" || /already.*registered|already exists/i.test(error.message || "");
    if (alreadyExists) {
      const { data: userList } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = (userList?.users || []).find((u) => (u.email || "").toLowerCase() === email);
      if (existing) {
        const { data: existingProfile } = await supabaseAdmin.from("profiles").select("role").eq("id", existing.id).maybeSingle();
        if (existingProfile && existingProfile.role === "admin") {
          return res.status(400).json({ error: "이미 관리자로 등록된 계정입니다." });
        }
        return res.status(409).json({
          error: "이미 가입된 이메일입니다. 관리자로 승격할까요?",
          code: "already_registered",
          existingId: existing.id,
        });
      }
    }
    return res.status(400).json({ error: error.message || "초대 이메일 발송에 실패했습니다." });
  }

  const { error: roleError } = await supabaseAdmin
    .from("profiles")
    .update({ role: "admin", ...(name ? { name } : {}) })
    .eq("id", data.user.id);
  if (roleError) {
    return res.status(500).json({ error: "계정은 만들어졌지만 관리자 권한 부여에 실패했습니다 — Supabase에서 수동으로 처리해 주세요." });
  }

  logAdminAction(req, "admin.invite", "admin", data.user.id, { email });
  res.json({ ok: true });
});

/* 관리자 권한만 해제(계정 자체는 삭제하지 않음 — 일반 고객 계정으로 남는다). 본인 권한은
   실수로 스스로를 잠그는 사고를 막기 위해 여기서 해제할 수 없게 막는다. */
router.delete("/api/admin/admins/:id", requireMasterAdmin, async (req, res) => {
  if (req.user.id === req.params.id) {
    return res.status(400).json({ error: "본인 계정은 여기서 해제할 수 없습니다." });
  }
  const { error } = await supabaseAdmin.from("profiles").update({ role: "customer" }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "권한 해제에 실패했습니다." });
  logAdminAction(req, "admin.revoke", "admin", req.params.id);
  res.json({ ok: true });
});

module.exports = router;
