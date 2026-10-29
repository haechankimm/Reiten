/* 서버가 오류 응답에 실어 보내는 번역 키(i18n: { key })가 모두 고객/Works 번역 사전(소스 코드/assets/js/i18n.js)에
   들어 있는지 확인한다 — 새 오류 문구를 추가하면서 번역을 빠뜨리면 영어·일본어·독일어 화면에 한국어가 그대로 나온다. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadDictionary() {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "소스 코드", "assets", "js", "i18n.js"), "utf8");
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

function serverSources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return ["node_modules", "test", "test-helpers", "migrations"].includes(e.name) ? [] : serverSources(path.join(dir, e.name));
    return e.name.endsWith(".js") ? [path.join(dir, e.name)] : [];
  });
}

test("서버 오류의 번역 키(i18n.key)는 모두 번역 사전에 있다", () => {
  const dict = loadDictionary();
  const missing = [];
  for (const file of serverSources(path.join(__dirname, ".."))) {
    const text = fs.readFileSync(file, "utf8");
    const re = /i18n:\s*\{\s*key:\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(text))) {
      const key = JSON.parse(`"${m[1]}"`);
      const entry = dict[key];
      if (!entry || !Object.keys(entry).length) missing.push(`${path.basename(file)}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});
