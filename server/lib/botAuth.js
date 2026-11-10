/* 비서 에이전트(피클) 전용 키 확인 — routes/botDiagnostics.js(읽기)와 routes/supplierShipments.js(공급처 송장 기록)가 함께 쓴다.
   - 헤더 X-REITEN-BOT-KEY == Render 환경변수 REITEN_BOT_KEY(32자 이상). 키가 없거나 짧으면 봇 경로 전체가 꺼진다(404).
   - 비교는 sha256 후 timingSafeEqual(길이·시간으로 키를 추측하지 못하게). */
const crypto = require("crypto");

const MIN_KEY_LENGTH = 32;
/* 활동 로그(admin_audit_log.admin_id)에 쓰는 봇 자리표시 ID — 실제 관리자 계정과 겹치지 않는다. */
const BOT_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

function keyMatches(given, expected) {
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(String(expected || "")).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireBotKey(req, res, next) {
  const expected = String(process.env.REITEN_BOT_KEY || "");
  if (expected.length < MIN_KEY_LENGTH) return res.status(404).json({ error: "존재하지 않는 API입니다." });
  const given = req.get("x-reiten-bot-key");
  if (!given || !keyMatches(given, expected)) {
    console.warn("[bot] 잘못된 키로 요청:", req.method, req.path, req.ip);
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

module.exports = { requireBotKey, keyMatches, BOT_ACTOR_ID, MIN_KEY_LENGTH };
