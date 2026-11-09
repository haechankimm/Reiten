/* ---------- 고객 화면 기기별 레이아웃 검사 (2026-11-09) ----------
   모든 고객 페이지를 휴대폰~태블릿 폭(320·360·390·414·768px) × 한국어·영어·일본어로 열어
   ① 가로로 넘쳐 화면이 좌우로 흔들리는지(가로 스크롤) ② 자바스크립트 오류가 나는지 확인한다.
   서버·DB 없이 정적 파일만 띄우고 /api/* 요청은 503으로 막는다(서버가 없을 때도 화면이 깨지지 않아야 하므로).
   GitHub Actions(.github/workflows/test.yml의 ui 작업)에서 돈다. 로컬: npm i --no-save playwright && npx playwright install chromium
   후 `node scripts/uiLayoutCheck.js`. 문제가 있으면 목록을 출력하고 종료 코드 1. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const SITE = path.join(__dirname, "..", "..", "소스 코드");
const WIDTHS = [320, 360, 390, 414, 768];
const LANGS = ["ko", "en", "ja"];
const SKIP = new Set(["404.html", "500.html"]);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain" };

function serve() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const file = path.join(SITE, urlPath === "/" ? "index.html" : urlPath);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const pages = fs.readdirSync(SITE).filter((f) => f.endsWith(".html") && !SKIP.has(f));
  const browser = await chromium.launch();
  const problems = [];
  for (const lang of LANGS) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: width < 768, hasTouch: width < 768 });
      await ctx.addInitScript((l) => { try { localStorage.setItem("reiten_lang", l); } catch (e) {} }, lang);
      // 외부(분석·채널톡·CDN)와 API는 막는다 — 네트워크 상태와 무관하게 같은 결과가 나오게
      await ctx.route("**/*", (route) => {
        const u = route.request().url();
        if (u.startsWith(base + "api/")) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
        if (!u.startsWith(base)) return route.abort();
        return route.continue();
      });
      const page = await ctx.newPage();
      for (const file of pages) {
        const errors = [];
        const onError = (e) => errors.push(e.message);
        page.on("pageerror", onError);
        try {
          await page.goto(base + file, { waitUntil: "load", timeout: 15000 });
          await page.waitForTimeout(300);
          const over = await page.evaluate(() => {
            const de = document.documentElement;
            const px = de.scrollWidth - de.clientWidth;
            if (px <= 1) return null;
            const culprits = [];
            for (const el of document.querySelectorAll("body *")) {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.right > de.clientWidth + 1 && getComputedStyle(el).position !== "fixed") {
                culprits.push(el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
                if (culprits.length >= 3) break;
              }
            }
            return { px, culprits };
          });
          if (over) problems.push(`[가로 넘침] ${lang} ${width}px ${file}: +${over.px}px (${over.culprits.join(", ")})`);
        } catch (e) {
          problems.push(`[열기 실패] ${lang} ${width}px ${file}: ${e.message.split("\n")[0]}`);
        }
        page.off("pageerror", onError);
        for (const m of new Set(errors)) problems.push(`[JS 오류] ${lang} ${width}px ${file}: ${m}`);
      }
      await ctx.close();
    }
  }
  await browser.close();
  server.close();
  if (problems.length) {
    console.log(problems.join("\n"));
    console.log(`\n문제 ${problems.length}건`);
    process.exit(1);
  }
  console.log(`이상 없음 — ${pages.length}개 페이지 × ${WIDTHS.length}개 폭 × ${LANGS.length}개 언어`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
