/* ---------- 서버 여러 대에서도 안전한 처리 잠금 (2026-11-09, 마이그레이션 045) ----------
   결제 확정·환불·주문 변경·PIN 확인은 같은 건이 동시에 두 번 처리되면 돈이 두 번 나가거나 잠금이 우회된다.
   지금까지는 프로세스 메모리 안에서만 줄을 세웠는데(서버 1대 전제), 서버를 2대 이상으로 늘리면 서로의 줄을 모른다.
   그래서 두 겹으로 잠근다:
     ① 같은 서버 안: 메모리 줄(빠르고 DB 왕복 없음)
     ② 서버끼리: app_locks 표에 key를 먼저 넣은 서버만 진행(기본키 중복이면 대기 후 재시도)
   app_locks 표가 없으면(045 미실행) ②를 건너뛰고 예전처럼 ①만 쓴다 — 서버 1대일 때는 그대로 안전하다.
   잠금을 잡은 서버가 죽어도 expires_at이 지나면 다른 서버가 가져갈 수 있다(TTL). */
const crypto = require("crypto");
const { supabaseAdmin } = require("./supabase");
const { isMissingSchemaError } = require("./pgErrors");

const OWNER = `${process.env.RENDER_INSTANCE_ID || "local"}:${process.pid}:${crypto.randomUUID()}`;
const DEFAULT_TTL_MS = 120 * 1000; // PG 환불·결제 조회까지 넉넉히 — 정상 처리는 수 초
const DEFAULT_WAIT_MS = 30 * 1000;
const RETRY_MS = 150;

let tableMissing = false; // 045 미실행이면 한 번 확인 후 DB 잠금을 건너뛴다(재배포하면 다시 확인)
const localChains = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class LockBusyError extends Error {
  constructor(key) {
    super("같은 건을 다른 곳에서 처리하고 있습니다. 잠시 후 다시 시도해 주세요.");
    this.status = 409;
    this.code = "LOCK_BUSY";
    this.key = key;
  }
}

/* 같은 서버 안 줄 세우기 — 예전 withPaymentLock/withOrderLock과 같은 방식 */
async function withLocalLock(key, fn) {
  const prev = localChains.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((r) => (release = r));
  const chain = prev.then(() => mine);
  localChains.set(key, chain);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (localChains.get(key) === chain) localChains.delete(key);
  }
}

/* DB 잠금 한 번 시도 — true(잡음) / false(다른 서버가 잡고 있음) / null(표 없음·DB 오류: DB 잠금 없이 진행) */
async function tryAcquire(db, key, ttlMs, now = Date.now()) {
  if (tableMissing) return null;
  const row = { key, owner: OWNER, expires_at: new Date(now + ttlMs).toISOString() };
  const { error } = await db.from("app_locks").insert(row);
  if (!error) return true;
  if (isMissingSchemaError(error)) {
    tableMissing = true;
    console.warn("[dbLock] app_locks 표가 없어(마이그레이션 045 미실행) 서버 1대 기준 메모리 잠금만 씁니다.");
    return null;
  }
  if (error.code === "23505") {
    // 주인이 죽어 만료된 잠금이면 치우고 바로 한 번 더 시도
    await db.from("app_locks").delete().eq("key", key).lt("expires_at", new Date(now).toISOString());
    const retry = await db.from("app_locks").insert(row);
    return !retry.error;
  }
  // 그 밖의 DB 오류 — 잠금 때문에 결제·환불 자체를 막지는 않는다(실제 처리도 같은 DB를 쓰므로 어차피 실패한다)
  console.error("[dbLock] 잠금 확인 실패, 메모리 잠금만으로 진행:", error.message);
  return null;
}

async function release(db, key) {
  const { error } = await db.from("app_locks").delete().eq("key", key).eq("owner", OWNER);
  if (error && !isMissingSchemaError(error)) console.error("[dbLock] 잠금 해제 실패(만료 후 자동 해제):", error.message);
}

/* 같은 key는 서버가 몇 대든 한 번에 하나만 실행한다. waitMs 안에 못 잡으면 LockBusyError(409). */
async function withLock(key, fn, { db = supabaseAdmin, ttlMs = DEFAULT_TTL_MS, waitMs = DEFAULT_WAIT_MS } = {}) {
  return withLocalLock(key, async () => {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const got = await tryAcquire(db, key, ttlMs);
      if (got === null) return fn();
      if (got) {
        try {
          return await fn();
        } finally {
          await release(db, key);
        }
      }
      if (Date.now() >= deadline) throw new LockBusyError(key);
      await sleep(RETRY_MS + Math.floor(Math.random() * RETRY_MS));
    }
  });
}

/* 정기 작업(크론)용 — 서버가 여러 대면 같은 시각에 모두 크론이 울린다. 먼저 잡은 서버 하나만 실행하고 나머지는
   기다리지 않고 건너뛴다(자동취소 메일·주간 백업·월간 정산이 서버 대수만큼 나가는 것 방지).
   끝나도 일부러 풀지 않는다 — 서버마다 시계가 몇 초씩 달라 늦게 울린 서버가 다시 실행하지 않도록, ttlMs(작업 주기보다 짧게)
   동안 그대로 두고 자연 만료시킨다. 반환: 실행했으면 fn 결과, 건너뛰면 undefined. */
async function runExclusive(key, fn, { db = supabaseAdmin, ttlMs = 10 * 60 * 1000 } = {}) {
  const got = await tryAcquire(db, key, ttlMs);
  if (got === false) {
    console.log(`[dbLock] ${key} — 다른 서버가 이미 실행해 건너뜀`);
    return undefined;
  }
  return fn();
}

function __resetForTests() {
  tableMissing = false;
  localChains.clear();
}

module.exports = { withLock, runExclusive, LockBusyError, OWNER, __resetForTests };
