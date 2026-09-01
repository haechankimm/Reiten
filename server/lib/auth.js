const { supabaseAdmin } = require("./supabase");

/* Authorization: Bearer <jwt> 헤더를 Supabase로 검증하고 req.user에 세팅한다.
   프런트가 admin 패널을 숨기는 것과 별개로, 여기서 매 요청마다 다시 검증한다 —
   개발자도구로 UI를 우회해도 이 검증을 통과하지 못하면 데이터에 접근할 수 없다. */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: "로그인이 만료되었습니다. 다시 로그인해 주세요." });
  }

  req.user = data.user;
  next();
}

/* 로그인 여부와 무관하게 통과시키되, 토큰이 있으면 req.user를 채운다.
   비회원 주문을 그대로 허용하면서, 로그인한 고객의 주문에는 user_id를 남기기 위함. */
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    req.user = null;
    return next();
  }
  const { data } = await supabaseAdmin.auth.getUser(token);
  req.user = (data && data.user) || null;
  next();
}

async function requireAdmin(req, res, next) {
  requireAuth(req, res, async () => {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", req.user.id)
      .single();

    if (error || !data || data.role !== "admin") {
      return res.status(403).json({ error: "관리자만 접근할 수 있습니다." });
    }
    next();
  });
}

/* 관리자 계정 자체를 다루는(새 관리자 초대, 기존 관리자 권한 해제, 회원을 관리자로 승격)
   동작만 이 이메일 한 명으로 제한한다(2026-09-01 사용자 요청) — 관리자가 여러 명이 되면
   그중 누구든 서로를 관리자로 만들거나 끌어내릴 수 있는 게 사고 위험이 크다고 판단해서,
   "누가 관리자가 될 수 있는지"를 정하는 권한만 한 명에게 모아뒀다. 그 외 주문·재고·상품·
   일반 회원 관리는 기존처럼 관리자 전원이 그대로 할 수 있다 — requireAdmin 위에 이 검사
   하나만 얹는 구조라 나머지 권한 로직은 전혀 안 건드림. 이 계정 자체(마스터 관리자가 누구인지)는
   README에서만 다루고 사용설명서(비개발자용 문서)에는 남기지 않는다(사용자 지시). */
const MASTER_ADMIN_EMAIL = "haechankimm@gmail.com";

async function requireMasterAdmin(req, res, next) {
  requireAdmin(req, res, () => {
    if ((req.user.email || "").toLowerCase() !== MASTER_ADMIN_EMAIL) {
      return res.status(403).json({ error: "이 작업은 마스터 관리자만 할 수 있습니다." });
    }
    next();
  });
}

module.exports = { requireAuth, optionalAuth, requireAdmin, requireMasterAdmin, MASTER_ADMIN_EMAIL };
