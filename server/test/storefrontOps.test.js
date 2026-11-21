/* 2026-11-21 고객 운영 기능(056) — 띠배너·단체 주문 문의·상품 공개 예약·추가 아이템 단독 줄·순수 로직.
   주소록·셀프 배송지 변경은 test/addresses.test.js(쓰기 제한 횟수 때문에 파일을 나눴다). */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const { MASTER_ADMIN_EMAIL } = require("../lib/auth");

const MASTER_TOKEN = fakeAdminToken("master-1", MASTER_ADMIN_EMAIL);
const MEMBER_TOKEN = fakeAdminToken("member-1", "member@example.com");

function buildApp(...routers) {
  const app = express();
  app.use(express.json());
  routers.forEach((r) => app.use(r));
  return app;
}

beforeEach(() => {
  supabaseAdmin.__reset({
    profiles: [{ id: "master-1", role: "admin", created_at: "2026-01-01T00:00:00.000Z" }, { id: "member-1", role: "customer" }],
    site_banners: [],
    group_inquiries: [],
    products: [],
  });
});

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

/* ---------- 띠배너 ---------- */
test("띠배너 입력 검사: 문구 필수·링크는 사이트 안 주소나 https만·끝이 시작보다 뒤", () => {
  const { bannerPatchFromBody } = require("../lib/banners");
  assert.match(bannerPatchFromBody({}, { forCreate: true }).error, /문구/);
  assert.match(bannerPatchFromBody({ message: "휴무", linkUrl: "javascript:alert(1)" }, { forCreate: true }).error, /링크/);
  assert.match(bannerPatchFromBody({ message: "휴무", linkUrl: "//evil.example" }, { forCreate: true }).error, /링크/);
  assert.match(bannerPatchFromBody({ message: "휴무", startsAt: "2026-12-02T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" }, { forCreate: true }).error, /끝나는/);
  const ok = bannerPatchFromBody({ message: "  연휴  휴무 ", linkUrl: "/notice.html", tone: "weird", startsAt: "" }, { forCreate: true }).patch;
  assert.deepStrictEqual([ok.message, ok.link_url, ok.tone, ok.starts_at], ["연휴 휴무", "/notice.html", "info", null]);
  // 수정 때는 보낸 칸만 바꾼다
  assert.deepStrictEqual(bannerPatchFromBody({ active: false }).patch, { active: false });
});

test("띠배너 노출: 켜져 있고 기간 안인 것만, 순서대로 최대 3개", () => {
  const { liveBanners, bannerState } = require("../lib/banners");
  const now = Date.parse("2026-12-01T12:00:00Z");
  const rows = [
    { id: "a", message: "a", active: true, sort_order: 2 },
    { id: "b", message: "b", active: true, sort_order: 1, starts_at: "2026-12-01T00:00:00Z", ends_at: "2026-12-02T00:00:00Z" },
    { id: "c", message: "c", active: true, starts_at: "2026-12-03T00:00:00Z" }, // 예약
    { id: "d", message: "d", active: true, ends_at: "2026-11-30T00:00:00Z" }, // 끝남
    { id: "e", message: "e", active: false }, // 꺼짐
    { id: "f", message: "f", active: true, sort_order: 3 },
    { id: "g", message: "g", active: true, sort_order: 4 },
  ];
  assert.deepStrictEqual(liveBanners(rows, now).map((r) => r.id), ["b", "a", "f"]);
  assert.deepStrictEqual(["a", "c", "d", "e"].map((id) => bannerState(rows.find((r) => r.id === id), now)), ["live", "scheduled", "ended", "off"]);
});

test("띠배너 API: 관리자가 등록하면 고객 API에 바로 보이고, 끄거나 지우면 사라진다", async () => {
  const app = buildApp(require("../routes/banners"));
  assert.strictEqual((await request(app).post("/api/admin/banners").send({ message: "x" })).status, 401);
  assert.strictEqual((await request(app).post("/api/admin/banners").set("Authorization", `Bearer ${MEMBER_TOKEN}`).send({ message: "x" })).status, 403);

  const created = await request(app).post("/api/admin/banners").set("Authorization", `Bearer ${MASTER_TOKEN}`).send({ message: "12/24~26 출고 휴무", tone: "warning", active: true });
  assert.strictEqual(created.status, 200);
  const pub = await request(app).get("/api/banners");
  assert.deepStrictEqual(pub.body.items.map((b) => [b.message, b.tone]), [["12/24~26 출고 휴무", "warning"]]);
  assert.ok(!("createdBy" in pub.body.items[0]), "고객 API에는 작성자 같은 내부 정보가 없다");

  await request(app).patch(`/api/admin/banners/${created.body.id}`).set("Authorization", `Bearer ${MASTER_TOKEN}`).send({ active: false });
  assert.deepStrictEqual((await request(app).get("/api/banners")).body.items, []);
  const list = await request(app).get("/api/admin/banners").set("Authorization", `Bearer ${MASTER_TOKEN}`);
  assert.strictEqual(list.body.items[0].state, "off");

  assert.strictEqual((await request(app).delete(`/api/admin/banners/${created.body.id}`).set("Authorization", `Bearer ${MASTER_TOKEN}`)).status, 200);
  assert.strictEqual((await request(app).delete(`/api/admin/banners/${created.body.id}`).set("Authorization", `Bearer ${MASTER_TOKEN}`)).status, 404);
});

/* ---------- 단체 주문 문의 ---------- */
test("단체 문의 입력 검사: 5벌 이상·연락처·이메일", () => {
  const { inquiryFromBody, inquiryPatchFromBody } = require("../lib/groupInquiries");
  const base = { teamName: "새벽 라이더스", contactName: "김라이더", tel: "010-1234-5678", email: "crew@example.com", quantity: 12 };
  assert.ok(inquiryFromBody(base).row);
  assert.match(inquiryFromBody({ ...base, quantity: 3 }).error, /5/);
  assert.ok(inquiryFromBody({ ...base, tel: "12" }).error);
  assert.ok(inquiryFromBody({ ...base, email: "nope" }).error);
  assert.ok(inquiryFromBody({ ...base, teamName: "" }).error);
  assert.ok(inquiryPatchFromBody({ status: "환불" }).error, "정해진 상태만");
  assert.deepStrictEqual(inquiryPatchFromBody({ status: "상담중" }).patch, { status: "상담중" });
});

test("단체 문의 API: 접수 → 관리자 목록(진행 중 필터) → 상태 변경, 봇 칸이 채워지면 저장하지 않는다", async () => {
  const app = buildApp(require("../routes/groupInquiries"));
  const body = { teamName: "새벽 라이더스", contactName: "김라이더", tel: "010-1234-5678", email: "crew@example.com", quantity: 12, desiredDate: "2026-12-20" };
  assert.strictEqual((await request(app).post("/api/group-inquiries").send({ ...body, quantity: 2 })).status, 400);
  assert.strictEqual((await request(app).post("/api/group-inquiries").send({ ...body, website: "http://spam" })).status, 200);
  assert.strictEqual((await supabaseAdmin.from("group_inquiries").select("*")).data.length, 0, "봇 칸이 채워진 접수는 저장 안 함");

  assert.strictEqual((await request(app).post("/api/group-inquiries").send(body)).status, 200);
  const rows = (await supabaseAdmin.from("group_inquiries").select("*")).data;
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].team_name, "새벽 라이더스");
  await supabaseAdmin.from("group_inquiries").update({ status: "접수" }).eq("id", rows[0].id); // DB 기본값 흉내

  assert.strictEqual((await request(app).get("/api/admin/group-inquiries").set("Authorization", `Bearer ${MEMBER_TOKEN}`)).status, 403);
  const open = await request(app).get("/api/admin/group-inquiries?status=open").set("Authorization", `Bearer ${MASTER_TOKEN}`);
  assert.strictEqual(open.body.total, 1);

  const patched = await request(app).patch(`/api/admin/group-inquiries/${rows[0].id}`).set("Authorization", `Bearer ${MASTER_TOKEN}`).send({ status: "종료", adminMemo: "전화 상담 후 보류" });
  assert.strictEqual(patched.status, 200);
  assert.deepStrictEqual([patched.body.status, patched.body.adminMemo], ["종료", "전화 상담 후 보류"]);
  const after = await request(app).get("/api/admin/group-inquiries?status=open").set("Authorization", `Bearer ${MASTER_TOKEN}`);
  assert.strictEqual(after.body.total, 0, "종료하면 진행 중 목록에서 빠진다");
});

/* ---------- 상품 공개 예약 ---------- */
test("공개 예약: 앞으로의 시각이면 비공개+예약, 지난 시각이면 바로 공개, 공개/비공개만 바꾸면 예약 취소", () => {
  const { productPatchFromBody } = require("../lib/products");
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 60000).toISOString();
  const f = productPatchFromBody({ active: true, publishAt: future }, { forCreate: false }).patch;
  assert.deepStrictEqual([f.active, f.publish_at], [false, future]);
  const p = productPatchFromBody({ active: false, publishAt: past }, { forCreate: false }).patch;
  assert.deepStrictEqual([p.active, p.publish_at], [true, null]);
  const c = productPatchFromBody({ active: false, publishAt: null }, { forCreate: false }).patch;
  assert.deepStrictEqual([c.active, c.publish_at], [false, null]);
  const only = productPatchFromBody({ active: true }, { forCreate: false }).patch;
  assert.strictEqual(only.publish_at, null, "예약 없이 직접 공개하면 걸려 있던 예약은 취소");
  assert.ok(productPatchFromBody({ publishAt: "아무 날" }, { forCreate: false }).error);
});

test("공개 예약: 시각이 된 상품만 공개되고, 공개 전에는 /upcoming이 공개 시각만 알려 준다", async () => {
  const now = Date.now();
  const soon = new Date(now + 3600000).toISOString();
  supabaseAdmin.__reset({
    products: [
      { id: "due", name_ko: "드롭 후디", active: false, publish_at: new Date(now - 1000).toISOString() },
      { id: "later", name_ko: "다음 드롭", active: false, publish_at: soon, price: 99000 },
      { id: "hidden", name_ko: "그냥 비공개", active: false, publish_at: null },
    ],
  });
  const { publishDueProducts } = require("../lib/catalog");
  const r = await publishDueProducts({ now });
  assert.deepStrictEqual(r.published, ["due"]);
  const rows = (await supabaseAdmin.from("products").select("*")).data;
  assert.deepStrictEqual(rows.map((p) => [p.id, p.active, p.publish_at]), [["due", true, null], ["later", false, soon], ["hidden", false, null]]);

  const app = buildApp(require("../routes/products"));
  const up = await request(app).get("/api/products/later/upcoming");
  assert.strictEqual(up.status, 200);
  assert.deepStrictEqual(up.body, { publishAt: soon }, "이름·가격 같은 다른 정보는 주지 않는다");
  assert.strictEqual((await request(app).get("/api/products/hidden/upcoming")).status, 404);
  assert.strictEqual((await request(app).get("/api/products/due/upcoming")).status, 404);
});

/* ---------- 추가 아이템 단독 줄(무료배송 추천) ---------- */
test("추가 아이템 단독 줄: 서버 가격으로 계산하고, 옷 없이 부속만으로는 주문할 수 없다", () => {
  const { priceItem, hasPhysicalProduct, isAddonLine } = require("../lib/pricing");
  const opts = { extras: [{ key: "flower-doll", label: "플라워 인형" }], charmPrice: 0, extraPrice: 9000 };
  const line = priceItem({ productId: "extra-flower-doll", qty: 2, unit: 1 }, [], opts);
  assert.deepStrictEqual([line.name, line.unit, line.sum], ["추가 아이템 — 플라워 인형", 9000, 18000]);
  assert.strictEqual(priceItem({ productId: "extra-unknown", qty: 1 }, [], opts), null);
  assert.strictEqual(priceItem({ productId: "extra-flower-doll", qty: 1, extras: ["flower-doll"] }, [], opts), null);
  assert.strictEqual(hasPhysicalProduct([{ productId: "extra-flower-doll" }, { productId: "charm-heart" }]), false);
  assert.strictEqual(hasPhysicalProduct([{ productId: "extra-flower-doll" }, { productId: "hoodie" }]), true);
  assert.deepStrictEqual(["extra-a", "charm-b", "hoodie"].map(isAddonLine), [true, true, false]);
});
