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

module.exports = { requireAuth, optionalAuth, requireAdmin };
