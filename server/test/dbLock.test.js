/* lib/dbLock.js — 서버 여러 대 사이 잠금(app_locks 표, 마이그레이션 045). 기본키 중복을 흉내 내는 작은 가짜 DB로 확인한다. */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, after } = require("node:test");
const assert = require("node:assert");

after(() => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

/* app_locks만 아는 가짜 DB — insert는 key 중복이면 23505, delete는 eq/lt 조건을 모두 만족하는 행만 지운다 */
function lockDb({ missing = false } = {}) {
  const rows = new Map();
  return {
    rows,
    from() {
      return {
        insert: async (row) => {
          if (missing) return { error: { code: "PGRST205", message: "missing" } };
          if (rows.has(row.key)) return { error: { code: "23505", message: "duplicate" } };
          rows.set(row.key, { ...row });
          return { error: null };
        },
        delete() {
          const conds = [];
          const q = {
            eq(col, v) { conds.push((r) => r[col] === v); return q; },
            lt(col, v) { conds.push((r) => r[col] < v); return q; },
            then(resolve) {
              for (const [k, r] of rows) if (conds.every((c) => c(r))) rows.delete(k);
              resolve({ error: missing ? { code: "PGRST205" } : null });
            },
          };
          return q;
        },
      };
    },
  };
}

/* 서로 다른 서버 두 대 = 모듈을 두 번 새로 불러온 것(메모리 줄·OWNER가 따로) */
function freshInstance() {
  delete require.cache[require.resolve("../lib/dbLock")];
  return require("../lib/dbLock");
}

test("서버 두 대가 같은 key를 동시에 잡으면 한 번에 하나씩만 실행된다", async () => {
  const db = lockDb();
  const a = freshInstance();
  const b = freshInstance();
  assert.notStrictEqual(a.OWNER, b.OWNER);
  let running = 0;
  let maxRunning = 0;
  const work = async () => { running++; maxRunning = Math.max(maxRunning, running); await new Promise((r) => setTimeout(r, 40)); running--; return "done"; };
  const results = await Promise.all([a.withLock("refund:R1", work, { db }), b.withLock("refund:R1", work, { db })]);
  assert.deepStrictEqual(results, ["done", "done"]);
  assert.strictEqual(maxRunning, 1);
  assert.strictEqual(db.rows.size, 0, "끝나면 잠금이 풀린다");
});

test("다른 서버가 오래 붙잡고 있으면 기다리다 LockBusyError(409)", async () => {
  const db = lockDb();
  const b = freshInstance();
  db.rows.set("payment:P", { key: "payment:P", owner: "other", expires_at: new Date(Date.now() + 60000).toISOString() });
  await assert.rejects(b.withLock("payment:P", async () => "x", { db, waitMs: 200 }), (e) => e instanceof b.LockBusyError && e.status === 409);
});

test("주인이 죽어 만료된 잠금은 다른 서버가 가져간다", async () => {
  const db = lockDb();
  const b = freshInstance();
  db.rows.set("order:R9", { key: "order:R9", owner: "dead", expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.strictEqual(await b.withLock("order:R9", async () => "ok", { db, waitMs: 200 }), "ok");
});

test("app_locks 표가 없으면(045 미실행) 예전처럼 메모리 잠금만으로 실행한다", async () => {
  const db = lockDb({ missing: true });
  const a = freshInstance();
  let running = 0;
  let maxRunning = 0;
  const work = async () => { running++; maxRunning = Math.max(maxRunning, running); await new Promise((r) => setTimeout(r, 20)); running--; };
  await Promise.all([a.withLock("k", work, { db }), a.withLock("k", work, { db })]);
  assert.strictEqual(maxRunning, 1, "같은 서버 안에서는 여전히 줄을 선다");
});

test("크론(runExclusive) — 먼저 잡은 서버만 실행하고 나머지는 건너뛴다", async () => {
  const db = lockDb();
  const a = freshInstance();
  const b = freshInstance();
  let runs = 0;
  const job = async () => { runs++; };
  await Promise.all([a.runExclusive("cron:auto-cancel", job, { db }), b.runExclusive("cron:auto-cancel", job, { db })]);
  assert.strictEqual(runs, 1);
});
