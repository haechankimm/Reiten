/* ---------- CSS·JS 캐시 버전 (2026-11-09) ----------
   예전엔 HTML·CSS·JS를 브라우저가 페이지를 열 때마다 서버에 "바뀌었나?" 다시 물어봤다(재배포가 바로 반영되게 하려고).
   그래서 페이지 이동마다 CSS·JS 7~10개를 확인하는 왕복이 생겼다. 이제 HTML을 보낼 때 그 안의 CSS·JS 주소에 파일 내용의
   지문(?v=해시 8자)을 붙이고, 지문이 붙은 요청은 1년 동안 묻지도 않고 쓰게 한다(immutable). 파일 내용이 바뀌면 지문이
   바뀌어 새 주소가 되므로 재배포는 여전히 바로 반영된다. HTML 자체는 지금처럼 매번 확인한다.
   빌드 단계 없이 서버가 HTML을 내보낼 때 바꿔 쓰는 방식이라 원본 파일은 그대로다. 결과는 프로세스 메모리에 보관(배포마다 새로 계산). */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const hashCache = new Map(); // 절대경로 → 해시(없는 파일은 null)
const htmlCache = new Map(); // 절대경로 → 바꿔 쓴 HTML

function fileHash(absPath) {
  if (hashCache.has(absPath)) return hashCache.get(absPath);
  let h = null;
  try {
    h = crypto.createHash("sha1").update(fs.readFileSync(absPath)).digest("hex").slice(0, 8);
  } catch (e) {
    h = null;
  }
  hashCache.set(absPath, h);
  return h;
}

/* html 안의 로컬 CSS·JS 주소에 ?v=지문을 붙인다. lookupDirs: "/assets/..." 같은 절대 주소를 찾을 폴더 순서(정적 서빙 순서와 같게),
   상대 주소("assets/x.js", "js/core.js")는 첫 폴더(그 HTML이 있는 폴더) 기준. 외부 주소·이미 ?가 붙은 주소는 건드리지 않는다. */
function versionHtml(html, lookupDirs) {
  return html.replace(/(<(?:script|link)\b[^>]*?\s(?:src|href)=")([^"?#:]+\.(?:js|css))(")/g, (m, pre, url, post) => {
    if (url.startsWith("//")) return m;
    const rel = url.replace(/^\//, "");
    const dirs = url.startsWith("/") ? lookupDirs : lookupDirs.slice(0, 1);
    for (const dir of dirs) {
      const abs = path.join(dir, rel);
      if (!abs.startsWith(dir)) continue;
      const h = fileHash(abs);
      if (h) return `${pre}${url}?v=${h}${post}`;
    }
    return m;
  });
}

/* GET /, /xxx.html을 지문 붙인 HTML로 내보낸다. 파일이 없으면 다음(정적 핸들러·404)으로 넘긴다. */
function htmlWithVersions(lookupDirs) {
  const root = lookupDirs[0];
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let rel = req.path;
    if (rel.endsWith("/")) rel += "index.html";
    if (!rel.endsWith(".html")) return next();
    let decoded;
    try { decoded = decodeURIComponent(rel); } catch (e) { return next(); }
    const abs = path.join(root, decoded);
    if (!abs.startsWith(root + path.sep)) return next();
    let html = htmlCache.get(abs);
    if (html === undefined) {
      try {
        html = versionHtml(fs.readFileSync(abs, "utf8"), lookupDirs);
      } catch (e) {
        html = null;
      }
      htmlCache.set(abs, html);
    }
    if (html === null) return next();
    const etag = `W/"${crypto.createHash("sha1").update(html).digest("hex").slice(0, 16)}"`;
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("ETag", etag);
    res.set("Cache-Control", "no-cache");
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    res.send(req.method === "HEAD" ? undefined : html);
  };
}

/* ?v=가 붙은 CSS·JS 요청만 1년 캐시로 서빙(지문이 바뀌면 주소가 바뀌므로 안전). 나머지는 기존 정적 핸들러가 처리. */
function immutableAssets(dirs) {
  const statics = dirs.map((d) => express.static(d, { maxAge: "365d", immutable: true, index: false }));
  return (req, res, next) => {
    if (!req.query || !req.query.v || !/\.(js|css)$/.test(req.path)) return next();
    let i = 0;
    const tryNext = (err) => {
      if (err) return next(err);
      if (i >= statics.length) return next();
      statics[i++](req, res, tryNext);
    };
    tryNext();
  };
}

function __resetForTests() {
  hashCache.clear();
  htmlCache.clear();
}

module.exports = { versionHtml, htmlWithVersions, immutableAssets, fileHash, __resetForTests };
