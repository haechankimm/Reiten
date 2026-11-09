/* lib/rateLimitStore.js — 서버 여러 대 공유 요청 제한(RATE_LIMIT_SHARED=on, 마이그레이션 047) */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { rateLimit } = require("express-rate-limit");
const { SharedRateLimitStore, sharedEnabled } = require("../lib/rateLimitStore");

after(() => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

/* rate_limit_hit 함수를 흉내 내는 DB — 서버 두 대가 같은 객체를 공유 */
function sharedDb() {
  const rows = new Map();
  return {
    rows,
    rpc: async (fn, args) => {
      if (fn === "rate_limit_hit") {
        const now = Date.now();
        const r = rows.get(args.p_key);
        if (!r || r.reset <= now) rows.set(args.p_key, { hits: 1, reset: now + args.p_window_ms });
        else r.hits++;
        const cur = rows.get(args.p_key);
        return { data: [{ out_hits: cur.hits, out_reset_at: new Date(cur.reset).toISOString() }], error: null };
      }
      if (fn === "rate_limit_undo") { const r = rows.get(args.p_key); if (r) r.hits = Math.max(0, r.hits - 1); return { data: null, error: null }; }
      return { data: null, error: { message: "unknown" } };
    },
    from: () => ({ delete: () => ({ eq: async () => ({ error: null }) }) }),
  };
}

function appWith(store) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(rateLimit({ windowMs: 60000, max: 3, store, standardHeaders: true, legacyHeaders: false, validate: false }));
  app.get("/", (req, res) => res.json({ ok: true }));
  return app;
}

test("서버 두 대가 한도를 함께 센다 — 합쳐서 3번 넘으면 429", async () => {
  const db = sharedDb();
  const a = appWith(new SharedRateLimitStore("t:", { db }));
  const b = appWith(new SharedRateLimitStore("t:", { db }));
  const ip = { "X-Forwarded-For": "1.2.3.4" };
  assert.strictEqual((await request(a).get("/").set(ip)).status, 200);
  assert.strictEqual((await request(b).get("/").set(ip)).status, 200);
  assert.strictEqual((await request(a).get("/").set(ip)).status, 200);
  assert.strictEqual((await request(b).get("/").set(ip)).status, 429);
});

test("표·함수가 없으면 서버 메모리로 넘어가 사이트는 그대로 동작", async () => {
  const db = { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "missing function" } }) };
  const orig = console.error;
  console.error = () => {};
  try {
    const app = appWith(new SharedRateLimitStore("m:", { db }));
    for (let i = 0; i < 3; i++) assert.strictEqual((await request(app).get("/")).status, 200);
    assert.strictEqual((await request(app).get("/")).status, 429, "메모리로도 한도는 지킨다");
  } finally {
    console.error = orig;
  }
});

test("기본은 꺼짐 — RATE_LIMIT_SHARED=on 일 때만", () => {
  assert.strictEqual(sharedEnabled({}), false);
  assert.strictEqual(sharedEnabled({ RATE_LIMIT_SHARED: "on" }), true);
});
