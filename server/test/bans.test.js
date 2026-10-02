/* lib/bans.js + lib/auth.js 차단 처리 — 차단된 회원은 ① 살아 있는 토큰으로도 로그인 필요 API를
   못 쓰고 ② 선택 로그인 API에서는 비회원으로 내려가며 표시가 남고 ③ 같은 이메일의 비회원 주문도 막힌다. */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const { requireAuth, optionalAuth } = require("../lib/auth");
const { isEmailBanned, invalidateBanCache } = require("../lib/bans");

const FUTURE = new Date(Date.now() + 86400000).toISOString();
const PAST = new Date(Date.now() - 86400000).toISOString();

function buildApp() {
  const app = express();
  app.get("/need-login", requireAuth, (req, res) => res.json({ ok: true }));
  app.post("/maybe-login", optionalAuth, (req, res) => res.json({ user: req.user && req.user.id, banned: req.userBanned }));
  return app;
}

beforeEach(() => {
  invalidateBanCache();
  supabaseAdmin.__reset({
    authUsers: [
      { id: "bad", email: "Bad@Example.com", banned_until: FUTURE },
      { id: "old", email: "old@example.com", banned_until: PAST },
      { id: "good", email: "good@example.com" },
    ],
  });
});

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("requireAuth — 차단된 회원은 토큰이 살아 있어도 403", async () => {
  const res = await request(buildApp()).get("/need-login").set("Authorization", `Bearer ${fakeAdminToken("bad", "bad@example.com")}`);
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.code, "banned");
  const ok = await request(buildApp()).get("/need-login").set("Authorization", `Bearer ${fakeAdminToken("old", "old@example.com")}`);
  assert.strictEqual(ok.status, 200, "차단 기간이 지난 회원은 통과");
});

test("optionalAuth — 차단된 회원은 비회원으로 내려가고 userBanned 표시", async () => {
  const res = await request(buildApp()).post("/maybe-login").set("Authorization", `Bearer ${fakeAdminToken("bad", "bad@example.com")}`);
  assert.deepStrictEqual(res.body, { user: null, banned: true });
  const good = await request(buildApp()).post("/maybe-login").set("Authorization", `Bearer ${fakeAdminToken("good", "good@example.com")}`);
  assert.deepStrictEqual(good.body, { user: "good", banned: false });
});

test("isEmailBanned — 대소문자·공백 무시, 만료된 차단은 제외, 캐시 무효화 후 반영", async () => {
  assert.strictEqual(await isEmailBanned(" bad@example.com "), true);
  assert.strictEqual(await isEmailBanned("old@example.com"), false);
  assert.strictEqual(await isEmailBanned("good@example.com"), false);
  assert.strictEqual(await isEmailBanned(""), false);

  await supabaseAdmin.auth.admin.updateUserById("good", { ban_duration: "876000h" });
  assert.strictEqual(await isEmailBanned("good@example.com"), false, "캐시가 남아 있는 동안은 이전 값");
  invalidateBanCache();
  assert.strictEqual(await isEmailBanned("good@example.com"), true);
});
