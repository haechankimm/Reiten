const { test } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const router = require("../routes/clientErrors");

function app() {
  const a = express();
  a.use(express.json());
  a.use(router);
  return a;
}

test("화면 오류 보고 — 받으면 204, 쿼리스트링(주문번호 등)은 로그에 남기지 않는다", async () => {
  const logs = [];
  const orig = console.warn;
  console.warn = (...a) => logs.push(a.join(" "));
  try {
    const res = await request(app()).post("/api/client-errors").send({ message: "x is undefined", page: "reiten.kr/order-complete.html?paymentId=SECRET", source: "https://reiten.kr/assets/js/app.js?v=1", line: 10 });
    assert.strictEqual(res.status, 204);
    assert.ok(logs.some((l) => l.includes("x is undefined")));
    assert.ok(!logs.some((l) => l.includes("SECRET")));
  } finally {
    console.warn = orig;
  }
});

test("빈 보고·이상한 본문도 오류 없이 204", async () => {
  assert.strictEqual((await request(app()).post("/api/client-errors").send({})).status, 204);
  assert.strictEqual((await request(app()).post("/api/client-errors").send([1, 2])).status, 204);
});
