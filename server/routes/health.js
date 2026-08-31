/* ---------- 헬스체크 ----------
   UptimeRobot이 지금까지는 전용 엔드포인트가 없어서 홈페이지(/)를 핑하고 있었을 가능성이 큰데,
   그러면 "정적 파일은 잘 나가는데 Supabase 연결은 끊긴" 상태를 못 잡는다(express.static은
   DB를 전혀 안 거치므로 여전히 200을 줌). 여기는 실제로 DB에 가벼운 쿼리를 한 번 날려봐서
   "서버가 떠 있다"뿐 아니라 "서버가 실제로 일을 할 수 있는 상태인지"까지 확인한다.
   UptimeRobot 모니터 URL을 이 경로(/health)로 바꾸는 건 Render 대시보드 접근이 필요해
   사용자가 직접 해야 한다 — 위 0번 섹션 참고. */
const express = require("express");
const { supabaseAdmin } = require("../lib/supabase");

const router = express.Router();

router.get("/health", async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from("orders").select("id").limit(1);
    if (error) throw error;
    res.json({ ok: true, db: "ok" });
  } catch (e) {
    console.error("[health] DB 확인 실패:", e.message);
    res.status(503).json({ ok: false, db: "error" });
  }
});

module.exports = router;
