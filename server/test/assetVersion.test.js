/* lib/assetVersion.js — HTML의 CSS·JS 주소에 내용 지문을 붙이고, 지문 붙은 요청만 1년 캐시 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const request = require("supertest");
const av = require("../lib/assetVersion");

let site;
let works;
beforeEach(() => {
  av.__resetForTests();
  site = fs.mkdtempSync(path.join(os.tmpdir(), "site-"));
  works = fs.mkdtempSync(path.join(os.tmpdir(), "works-"));
  fs.mkdirSync(path.join(site, "assets", "js"), { recursive: true });
  fs.mkdirSync(path.join(works, "js"));
  fs.writeFileSync(path.join(site, "assets", "js", "app.js"), "console.log(1)");
  fs.writeFileSync(path.join(works, "js", "core.js"), "console.log(2)");
  fs.writeFileSync(path.join(site, "index.html"), '<link rel="stylesheet" href="assets/css/none.css"><script src="assets/js/app.js"></script><script src="https://cdn.x/y.js"></script><img src="assets/js/app.js">');
  fs.writeFileSync(path.join(works, "index.html"), '<script src="/assets/js/app.js"></script><script src="js/core.js"></script>');
});

function siteApp() {
  const app = express();
  app.use(av.immutableAssets([site]));
  app.use(av.htmlWithVersions([site]));
  app.use(express.static(site));
  return app;
}

test("HTML의 로컬 JS에 지문이 붙고, 없는 파일·외부 주소·img는 그대로", async () => {
  const res = await request(siteApp()).get("/");
  assert.strictEqual(res.status, 200);
  assert.match(res.text, /src="assets\/js\/app\.js\?v=[0-9a-f]{8}"/);
  assert.ok(res.text.includes('href="assets/css/none.css"'));
  assert.ok(res.text.includes('src="https://cdn.x/y.js"'));
  assert.ok(res.text.includes('<img src="assets/js/app.js">'));
  assert.strictEqual(res.headers["cache-control"], "no-cache");
  const again = await request(siteApp()).get("/index.html").set("If-None-Match", res.headers.etag);
  assert.strictEqual(again.status, 304);
});

test("지문 붙은 JS는 1년 immutable, 지문 없으면 기본(매번 확인)", async () => {
  const v = await request(siteApp()).get("/assets/js/app.js?v=abc");
  assert.strictEqual(v.status, 200);
  assert.match(v.headers["cache-control"], /max-age=31536000.*immutable/);
  const plain = await request(siteApp()).get("/assets/js/app.js");
  assert.match(plain.headers["cache-control"], /max-age=0/);
});

test("Works: 상대 주소는 works 폴더, /assets는 고객 사이트 폴더에서 찾는다", () => {
  const html = av.versionHtml(fs.readFileSync(path.join(works, "index.html"), "utf8"), [works, site]);
  assert.match(html, /src="\/assets\/js\/app\.js\?v=[0-9a-f]{8}"/);
  assert.match(html, /src="js\/core\.js\?v=[0-9a-f]{8}"/);
});

test("내용이 바뀌면 지문도 바뀐다", () => {
  const a = av.fileHash(path.join(site, "assets", "js", "app.js"));
  av.__resetForTests();
  fs.writeFileSync(path.join(site, "assets", "js", "app.js"), "console.log(3)");
  assert.notStrictEqual(av.fileHash(path.join(site, "assets", "js", "app.js")), a);
});

test("폴더 밖 경로(../)는 내보내지 않는다", async () => {
  const res = await request(siteApp()).get("/..%2f..%2fetc%2fpasswd.html");
  assert.notStrictEqual(res.status, 200);
});
