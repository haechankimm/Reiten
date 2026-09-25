const test = require("node:test");
const assert = require("node:assert/strict");
require("../lib/asyncErrors");
const express = require("express");
const request = require("supertest");

test("async 라우트에서 난 예외가 응답 없이 멈추지 않고 에러 핸들러로 간다", async () => {
  const app = express();
  app.get("/boom", async () => { throw new Error("boom"); });
  app.get("/ok", async (req, res) => res.json({ ok: true }));
  const router = express.Router();
  router.get("/r/boom", async () => { await Promise.resolve(); throw new Error("nested"); });
  app.use(router);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  assert.equal((await request(app).get("/boom").timeout(2000)).status, 500);
  assert.equal((await request(app).get("/r/boom").timeout(2000)).body.error, "nested");
  assert.equal((await request(app).get("/ok")).status, 200);
});
