/* ---------- 서버 내부 실행 통로 (2026-11-11, AI 승인함) ----------
   사람이 AI 제안을 승인하면, 서버가 "승인한 관리자" 신분으로 기존 관리자 API(주문 상태 변경·재고 저장 등)를 그대로 호출해 실행한다.
   그래서 메일 발송·재고·적립금·활동 로그 같은 기존 처리 로직을 다시 만들지 않는다(같은 코드가 돈다).
   - 서버 프로세스가 시작할 때 만든 무작위 비밀값(메모리에만, 밖으로 나가지 않음) + 같은 기계(127.0.0.1)에서 온 요청만 인정한다.
   - lib/adminGuard.js가 이 요청을 알아보고 로그인·PIN 확인 대신 실어 보낸 신분(승인자)을 쓴다. req.agentActionId가 붙어
     활동 로그(lib/adminLog.js)에 "AI 제안 #번호"로 함께 남는다.
   - 테스트에서는 setDispatchOverride로 바꿔 끼운다. */
const crypto = require("crypto");
const http = require("http");

const INTERNAL_TOKEN = crypto.randomBytes(32).toString("hex");
let port = Number(process.env.PORT) || 3000;
let override = null;

function setPort(p) { port = Number(p) || port; }
function setDispatchOverride(fn) { override = fn; }

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/* adminGuard가 부른다 — 내부 실행 요청이면 { actor, actionId }, 아니면 null */
function readInternal(req) {
  const given = req.headers["x-reiten-internal"];
  if (!given) return null;
  const a = Buffer.from(String(given));
  const b = Buffer.from(INTERNAL_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!LOOPBACK.has(req.socket && req.socket.remoteAddress)) return null;
  try {
    const actor = JSON.parse(Buffer.from(String(req.headers["x-reiten-actor"] || ""), "base64").toString());
    if (!actor || !actor.id || !actor.email) return null;
    return { actor, actionId: String(req.headers["x-reiten-agent-action"] || "") || null };
  } catch (e) {
    return null;
  }
}

/* { method, path, body, actor:{id,email,isMaster}, actionId } → { status, body } */
function dispatch(opts) {
  if (override) return override(opts);
  const { method, path, body, actor, actionId } = opts;
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve) => {
    const req = http.request({
      host: "127.0.0.1", port, method, path,
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": payload.length } : {}),
        "X-Reiten-Internal": INTERNAL_TOKEN,
        "X-Reiten-Actor": Buffer.from(JSON.stringify(actor)).toString("base64"),
        ...(actionId ? { "X-Reiten-Agent-Action": String(actionId) } : {}),
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString() || "null"); } catch (e) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ status: 0, body: { error: e.message } }));
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { dispatch, readInternal, setPort, setDispatchOverride };
