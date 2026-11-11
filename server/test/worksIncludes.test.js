/* Works index.html 조각 합치기(2026-11-11) — index.html의 `<!-- #include … -->`가 가리키는 파일이 모두 있고,
   tabs/·partials/의 파일은 빠짐없이 어딘가에 포함되며, 합친 결과에 include 표시가 남지 않는지. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const express = require("express");
const request = require("supertest");
const { expandIncludes, htmlWithVersions, __resetForTests } = require("../lib/assetVersion");

const WORKS = path.join(__dirname, "..", "..", "works");
const SITE = path.join(__dirname, "..", "..", "소스 코드");

test("Works include — 가리키는 파일이 모두 있고 조각 파일은 전부 쓰인다", () => {
  const index = fs.readFileSync(path.join(WORKS, "index.html"), "utf8");
  const refs = [...index.matchAll(/<!-- #include ([\w./-]+) -->/g)].map((m) => m[1]);
  assert.ok(refs.length >= 20, "탭 include가 너무 적다");
  for (const r of refs) assert.ok(fs.existsSync(path.join(WORKS, r)), `없는 조각: ${r}`);
  const parts = ["tabs", "partials"].flatMap((d) => fs.readdirSync(path.join(WORKS, d)).map((f) => `${d}/${f}`));
  for (const p of parts) assert.ok(refs.includes(p), `index.html에 포함되지 않은 조각: ${p}`);
  const full = expandIncludes(index, WORKS);
  assert.ok(!full.includes("#include"), "합친 결과에 include 표시가 남았다");
  assert.ok(!full.includes("include 없음"), "빠진 조각이 있다");
  for (const id of ["admin-orders", "admin-products", "admin-settings", "sidebar", "auth-view", "photo-editor"]) {
    assert.ok(full.includes(`id="${id}"`), `${id}가 합친 HTML에 없다`);
  }
});

test("Works include — 폴더 밖 경로는 거부하고, 없는 파일은 주석만 남긴다", () => {
  assert.match(expandIncludes("<!-- #include ../server/package.json.html -->", WORKS), /include 거부/);
  assert.match(expandIncludes("<!-- #include tabs/none.html -->", WORKS), /include 없음/);
});

test("Works include — 실제 서빙 경로에서도 탭이 합쳐져 나간다", async () => {
  __resetForTests();
  const app = express();
  app.use(htmlWithVersions([WORKS, SITE]));
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('id="admin-orders"'));
  assert.ok(!res.text.includes("#include"));
});

test("Works 독일어 — i18n-de/의 모든 파일을 불러오고, _common.js가 맨 먼저다", () => {
  const list = fs.readFileSync(path.join(WORKS, "partials", "i18n-de.html"), "utf8");
  const srcs = [...list.matchAll(/src="\/assets\/js\/i18n-de\/([\w-]+\.js)"/g)].map((m) => m[1]);
  const files = fs.readdirSync(path.join(SITE, "assets", "js", "i18n-de")).filter((f) => f.endsWith(".js"));
  assert.equal(srcs[0], "_common.js");
  assert.deepEqual([...srcs].sort(), [...files].sort(), "partials/i18n-de.html 목록과 i18n-de/ 파일이 다르다");
});
