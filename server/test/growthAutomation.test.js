/* 2026-11-11 성장·자동화 6종 — 미입금 리마인드, 브리핑(현금영수증·발주 제안), 구글 쇼핑 피드, 상품 번역 제안,
   재고 소진 예측, 반품 사유 사이즈 보정 */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");

after(() => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

const H = 3600 * 1000;
const NOW = Date.parse("2026-11-11T12:00:00Z");

test("미입금 리마인드: 18~23시간 지난 무통장 입금대기만, 한 번만", async () => {
  const { remindUnpaidOrders, reminderWindow, hoursLeftFor } = require("../lib/depositReminder");
  const at = (h) => new Date(NOW - h * H).toISOString();
  supabaseAdmin.__reset({ orders: [
    { id: 1, order_no: "A", status: "입금대기", payment_method: "bank", created_at: at(19), customer: { name: "a" }, items: [], total: 1000 },
    { id: 2, order_no: "B", status: "입금대기", payment_method: "bank", created_at: at(10), customer: { name: "b" }, items: [], total: 1000 }, // 아직 이름
    { id: 3, order_no: "C", status: "입금대기", payment_method: "bank", created_at: at(23.5), customer: { name: "c" }, items: [], total: 1000 }, // 곧 취소
    { id: 4, order_no: "D", status: "입금확인", payment_method: "bank", created_at: at(19), customer: { name: "d" }, items: [], total: 1000 },
    { id: 5, order_no: "E", status: "입금대기", payment_method: "virtual_account", created_at: at(19), customer: { name: "e" }, items: [], total: 1000 },
  ] });
  const w = reminderWindow(NOW);
  assert.ok(w.from < w.to);
  assert.strictEqual(hoursLeftFor(at(19), NOW), 5);
  const first = await remindUnpaidOrders({ now: NOW });
  assert.strictEqual(first.sent, 1);
  const { data } = await supabaseAdmin.from("orders").select("order_no, deposit_reminded_at");
  assert.deepStrictEqual(data.filter((o) => o.deposit_reminded_at).map((o) => o.order_no), ["A"]);
  assert.strictEqual((await remindUnpaidOrders({ now: NOW })).sent, 0); // 두 번 안 보냄
  process.env.DEPOSIT_REMINDER = "off";
  assert.strictEqual((await remindUnpaidOrders({ now: NOW })).skipped, "off");
  delete process.env.DEPOSIT_REMINDER;
});

test("아침 요약 문구: 현금영수증 발급·발주 제안", () => {
  const { briefingText } = require("../lib/briefing");
  assert.strictEqual(briefingText({ pendingDeposit: 1, cashReceiptPending: 2, reorder: 3 }), "입금 확인 1 · 현금영수증 발급 2 · 발주 제안 3");
});

const P = {
  id: "hoodie", name: "Heart Hoodie", nameKo: "하트 후디", price: 89000, category: "후디", images: ["/assets/a.jpg", "https://res.cloudinary.com/x/b.jpg"],
  colors: ["black"], sizes: ["M", "L"], soldOut: [], outOfStockByColor: {}, desc: "따뜻한 <후디> & 반사", translations: { en: { name: "Heart Hoodie EN", desc: "Warm hoodie" } },
};

test("구글 쇼핑 피드: 사진·재고 있는 상품만, 언어별 문구·링크, XML 이스케이프", () => {
  const { googleFeedXml } = require("../lib/seo");
  const noImg = { ...P, id: "noimg", images: [] };
  const ko = googleFeedXml([P, noImg]);
  assert.match(ko, /<g:id>hoodie<\/g:id>/);
  assert.doesNotMatch(ko, /noimg/);
  assert.match(ko, /<g:price>89000 KRW<\/g:price>/);
  assert.match(ko, /따뜻한 &lt;후디&gt; &amp; 반사/);
  assert.match(ko, /<link>https:\/\/reiten\.kr\/product\.html\?id=hoodie<\/link>/);
  assert.match(ko, /<g:additional_image_link>https:\/\/res\.cloudinary\.com\/x\/b\.jpg/);
  const en = googleFeedXml([P], { lang: "en" });
  assert.match(en, /REITEN Heart Hoodie EN/);
  assert.match(en, /Warm hoodie/);
  assert.match(en, /id=hoodie&amp;lang=en/);
  const shipFree = googleFeedXml([{ ...P, price: 120000 }]);
  assert.match(shipFree, /<g:price>0 KRW<\/g:price><\/g:shipping>/);
});

test("구글 쇼핑 피드 주소가 XML로 응답", async () => {
  supabaseAdmin.__reset({ products: [], inventory: [] });
  const a = express();
  a.use(require("../routes/seo"));
  const r = await request(a).get("/feed/google.xml?lang=ja");
  assert.strictEqual(r.status, 200);
  assert.match(r.headers["content-type"], /xml/);
  assert.match(r.text, /<rss version="2.0"/);
});

test("상품 번역 제안: 형식 검사·미리보기·되돌리기용 이전 값", async () => {
  const { ACTIONS } = require("../lib/agentActions");
  supabaseAdmin.__reset({ products: [{ id: "hoodie", name_ko: "하트 후디", translations: { ja: { name: "ハート" } } }] });
  const a = ACTIONS.product_translate;
  assert.ok((await a.prepare({ productId: "hoodie", lang: "de", name: "x" })).error);
  assert.ok((await a.prepare({ productId: "hoodie", lang: "en" })).error);
  assert.ok((await a.prepare({ productId: "nope", lang: "en", name: "x" })).error);
  const ok = await a.prepare({ productId: "hoodie", lang: "en", name: " Heart Hoodie ", desc: "Warm", details: ["Cotton", 3] });
  assert.ifError(ok.error);
  assert.deepStrictEqual(ok.params.entry, { name: "Heart Hoodie", desc: "Warm", details: ["Cotton"] });
  assert.deepStrictEqual(ok.params.prev, { ja: { name: "ハート" } });
  assert.strictEqual(ok.dedupeKey, "product_translate:hoodie:en");
  assert.deepStrictEqual(ok.preview.lines.map((l) => l.label), ["영어 이름", "영어 설명", "영어 상세 항목"]);
  assert.strictEqual(a.autoAllowed, false);
});

test("재고 소진 예측: 판매 속도·취소 반영, 3주 안 품절 예상만", () => {
  const { forecastStock, forecastLine } = require("../lib/stockForecast");
  const products = [{ id: "h", name_ko: "후디", colors: ["black"], sizes: ["M", "L", "S"] }];
  const inventory = [{ product_id: "h", color: "black", size: "M", qty: 5 }, { product_id: "h", color: "black", size: "L", qty: 100 }, { product_id: "h", color: "black", size: "S", qty: 0 }];
  const logs = [
    { product_id: "h", color: "black", size: "M", delta: -30, reason: "order" },
    { product_id: "h", color: "black", size: "M", delta: 2, reason: "auto_cancel" }, // 순판매 28 → 하루 1장
    { product_id: "h", color: "black", size: "L", delta: -28, reason: "order" }, // 재고 100 → 100일 — 제외
    { product_id: "h", color: "black", size: "S", delta: -14, reason: "order" },
  ];
  const items = forecastStock({ inventory, logs, products });
  assert.deepStrictEqual(items.map((r) => [r.size, r.daysLeft, r.suggestQty]), [["S", 0, 22], ["M", 5, 39]]);
  assert.strictEqual(items[1].perWeek, 7);
  assert.match(forecastLine(items), /^발주 제안 2건: 후디 black S 품절·22장, 후디 black M 5일 뒤 품절 예상·39장$/);
  assert.strictEqual(forecastLine([]), null);
});

test("반품 사유 사이즈 보정: 한쪽으로 확실히 쏠릴 때만", () => {
  const { fitFeedbackFromRows, fitBias } = require("../lib/fitFeedback");
  const items = new Map([["O1", [{ productId: "h", size: "M" }, { productId: "charm-1", size: "F" }]], ["O2", [{ productId: "h", size: "L" }]], ["O3", [{ productId: "h", size: "S" }]], ["O4", [{ productId: "t", size: "M" }]]]);
  const rets = [
    { order_no: "O1", reason: "사이즈 작음" }, { order_no: "O2", reason: "사이즈 작음" }, { order_no: "O3", reason: "사이즈 작음" },
    { order_no: "O4", reason: "사이즈 불만족" }, { order_no: "O4", reason: "단순변심" }, { order_no: "O2", reason: "사이즈 작음", request_type: "cancel" },
  ];
  const r = fitFeedbackFromRows(rets, items, new Map([["h", 40]]));
  assert.deepStrictEqual(r.h, { small: 3, big: 0, unknown: 0, sold: 40, bias: "small" });
  assert.strictEqual(r.t.bias, null);
  assert.strictEqual(r["charm-1"], undefined);
  assert.strictEqual(fitBias({ small: 3, big: 2, sold: 10 }), null); // 반대 의견도 많음
  assert.strictEqual(fitBias({ small: 3, big: 0, sold: 200 }), null); // 판매량 대비 적음
  assert.strictEqual(fitBias({ small: 0, big: 4, sold: 20 }), "big");
});

test("사이즈 추천이 fitBias를 반영", () => {
  const { recommendSize } = require("../../소스 코드/assets/js/sizeAdvisor.js");
  const base = { heightCm: 175, weightKg: 70, fit: "regular" }; // 평소 L
  const sizes = ["S", "M", "L", "XL"];
  assert.strictEqual(recommendSize(base, { sizes }).recommended, "L");
  const small = recommendSize(base, { sizes, fitBias: "small" });
  assert.strictEqual(small.recommended, "XL");
  assert.ok(small.reasons.includes("runs_small"));
  assert.strictEqual(small.usual, "L");
  assert.strictEqual(recommendSize(base, { sizes, fitBias: "big" }).recommended, "M");
});
