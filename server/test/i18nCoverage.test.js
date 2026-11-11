/* 화면 번역 누락 검사(2026-11-09) — 고객 화면(소스 코드/)의 t("한국어")·data-i18n 문구는 모두 영어·일본어가,
   Works(works/)의 문구는 독일어가 번역 사전(i18n.js)에 있어야 한다. 새 문구를 넣고 번역을 빠뜨리면 그 언어 화면에
   한국어가 그대로 나오는 버그가 반복돼서(2026-10 감사에서 수십 건) CI에서 막는다.
   일부러 빈 문자열로 둔 번역(예: 독일어에서 필요 없는 "건")은 통과 — 값이 문자열이기만 하면 된다.
   ${} 변수가 들어간 템플릿 문자열은 키가 실행 중에 정해져 검사하지 않는다. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");
const SITE = path.join(ROOT, "소스 코드");
const WORKS = path.join(ROOT, "works");

function loadDictionary() {
  // 고객용 사전 + Works 전용 독일어(i18n-de/ 탭별 파일, 2026-11-11 — _common.js가 addDe를 정의하므로 이름순 맨 앞)
  const deDir = path.join(SITE, "assets", "js", "i18n-de");
  const files = [path.join(SITE, "assets", "js", "i18n.js"), ...fs.readdirSync(deDir).sort().map((f) => path.join(deDir, f))];
  const src = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const ctx = {
    document: { documentElement: { lang: "ko", setAttribute() {} }, addEventListener() {}, querySelectorAll() { return []; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    navigator: { language: "ko" },
    console,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src + "\n;globalThis.__I18N = I18N;", ctx);
  return ctx.__I18N;
}

const decodeHtml = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/* 파일에서 번역 키 후보를 뽑는다: t("…")/t('…')/t(`…`) 리터럴(변수 ${} 없는 것)과 data-i18n="…" 속성 */
function keysIn(file) {
  const text = fs.readFileSync(file, "utf8");
  const keys = [];
  for (const m of text.matchAll(/\bt\(\s*(["'`])((?:(?!\1)[^\\\n]|\\.)*?)\1/g)) {
    const raw = m[2];
    if (raw.includes("${")) continue;
    let key;
    try { key = m[1] === '"' ? JSON.parse(`"${raw}"`) : raw.replace(/\\(["'`\\])/g, "$1").replace(/\\n/g, "\n"); } catch (e) { continue; }
    if (/[가-힣]/.test(key)) keys.push(key);
  }
  for (const m of text.matchAll(/data-i18n(?:-html)?=(["'])(.*?)\1/g)) {
    const key = decodeHtml(m[2]);
    if (/[가-힣]/.test(key)) keys.push(key);
  }
  return keys;
}

function filesIn(dir, exts, skip = []) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return skip.includes(e.name) ? [] : filesIn(p, exts, skip);
    return exts.some((x) => e.name.endsWith(x)) && !skip.includes(e.name) ? [p] : [];
  });
}

function missingFor(files, langs, dict) {
  const missing = new Set();
  for (const f of files) {
    for (const key of keysIn(f)) {
      const entry = dict[key];
      const lacks = langs.filter((l) => !entry || typeof entry[l] !== "string");
      if (lacks.length) missing.add(`${path.relative(ROOT, f)}: ${key.slice(0, 80)} [${lacks}]`);
    }
  }
  return [...missing];
}

test("고객 화면 문구는 모두 영어·일본어 번역이 있다", () => {
  const dict = loadDictionary();
  const files = [...filesIn(SITE, [".html"], ["img"]), ...filesIn(path.join(SITE, "assets", "js"), [".js"], ["i18n.js", "i18n-de"])];
  assert.deepEqual(missingFor(files, ["en", "ja"], dict), []);
});

test("Works 화면 문구는 모두 독일어 번역이 있다", () => {
  const dict = loadDictionary();
  // index.html은 탭·조각 파일(tabs/·partials/)을 서버가 합쳐 내보낸다(2026-11-11, lib/assetVersion.js expandIncludes)
  const files = [
    path.join(WORKS, "index.html"),
    ...filesIn(path.join(WORKS, "tabs"), [".html"]),
    ...filesIn(path.join(WORKS, "partials"), [".html"]),
    ...filesIn(path.join(WORKS, "js"), [".js"]),
  ];
  assert.deepEqual(missingFor(files, ["de"], dict), []);
});
