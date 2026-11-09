/* lib/staticGuard.js — 정적 폴더 안의 내부 문서(README.md 등)가 웹으로 나가지 않는지. */
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const express = require("express");
const request = require("supertest");
const { isPublicStaticPath, staticGuard } = require("../lib/staticGuard");

test("isPublicStaticPath — 웹 리소스만 허용, 문서·인코딩 우회는 차단", () => {
  for (const ok of ["/", "/index.html", "/assets/js/app.js", "/assets/img/a.webp", "/sitemap.xml", "/robots.txt", "/manifest.webmanifest", "/health"]) {
    assert.strictEqual(isPublicStaticPath(ok), true, ok);
  }
  for (const bad of ["/README.md", "/readme.MD", "/README%2Emd", "/" + encodeURIComponent("사용설명서.md"), "/.env", "/x.sql", "/backup.zip", "/%E0%A4%A", "/a.md%00.html"]) {
    assert.strictEqual(isPublicStaticPath(bad), false, bad);
  }
});

test("staticGuard — 실제 static 폴더 앞에 두면 README.md는 404, html은 200", async () => {
  const siteDir = path.join(__dirname, "..", "..", "소스 코드");
  const app = express();
  app.use(staticGuard(path.join(siteDir, "404.html")));
  app.use(express.static(siteDir));
  assert.strictEqual((await request(app).get("/README.md")).status, 404);
  assert.strictEqual((await request(app).get("/" + encodeURIComponent("사용설명서.md"))).status, 404);
  assert.strictEqual((await request(app).get("/README%2Emd")).status, 404);
  assert.strictEqual((await request(app).get("/index.html")).status, 200);
  assert.strictEqual((await request(app).get("/assets/js/data.js")).status, 200);
});
