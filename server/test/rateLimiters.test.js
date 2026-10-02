/* lib/rateLimiters.js — 회원은 회원 id로, 비회원은 IP로 따로 세고, 카드결제 확인 요청은 주문 한도에서 빠진다. */
const { test } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { memberOrIpKey, orderLimiter, writeLimiter } = require("../lib/rateLimiters");

test("memberOrIpKey — 로그인 회원은 user:id, 비회원은 ip:주소", () => {
  assert.strictEqual(memberOrIpKey({ user: { id: "u1" }, ip: "1.2.3.4" }), "user:u1");
  assert.match(memberOrIpKey({ user: null, ip: "1.2.3.4" }), /^ip:1\.2\.3\.4/);
});

test("orderLimiter — 같은 공유 IP라도 회원마다 따로 세고, 결제 확인(paymentId) 요청은 세지 않는다", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = req.headers["x-user"] ? { id: req.headers["x-user"] } : null; next(); });
  app.post("/order", orderLimiter, (req, res) => res.json({ ok: true }));

  for (let i = 0; i < 30; i++) await request(app).post("/order").set("x-user", "A").send({});
  assert.strictEqual((await request(app).post("/order").set("x-user", "A").send({})).status, 429, "회원 A는 한도 초과");
  assert.strictEqual((await request(app).post("/order").set("x-user", "B").send({})).status, 200, "같은 IP의 회원 B는 영향 없음");
  assert.strictEqual((await request(app).post("/order").set("x-user", "A").send({ paymentId: "p1" })).status, 200, "결제 확인은 항상 통과");
});

test("writeLimiter — 한도 초과 응답은 번역 가능한 코드와 함께 온다", async () => {
  const app = express();
  app.post("/w", writeLimiter, (req, res) => res.json({ ok: true }));
  let last;
  for (let i = 0; i < 21; i++) last = await request(app).post("/w");
  assert.strictEqual(last.status, 429);
  assert.strictEqual(last.body.code, "RATE_LIMITED");
});
