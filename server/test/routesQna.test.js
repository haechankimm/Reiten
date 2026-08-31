/* routes/qna.js 통합 테스트 — test-helpers/fakeSupabase.js 사용(routesSettings.test.js 참고). */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { supabaseAdmin } = require("../lib/supabase");
const { fakeAdminToken } = require("../test-helpers/fakeSupabase");
const qnaRouter = require("../routes/qna");

const ADMIN = { id: "admin-1", email: "admin@example.com" };
const TOKEN = fakeAdminToken(ADMIN.id, ADMIN.email);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(qnaRouter);
  return app;
}

beforeEach(() => {
  supabaseAdmin.__reset({
    profiles: [{ id: ADMIN.id, role: "admin" }],
    products: [{ id: "reflect-heart-hoodie" }],
  });
});

after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("POST /api/qna — 존재하지 않는 상품이면 400", async () => {
  const res = await request(buildApp())
    .post("/api/qna")
    .send({ productId: "no-such-product", name: "홍길동", question: "이거 재입고되나요?" });
  assert.strictEqual(res.status, 400);
});

test("POST /api/qna — 이름·문의내용이 비어있으면 400", async () => {
  const res = await request(buildApp())
    .post("/api/qna")
    .send({ productId: "general", name: "", question: "" });
  assert.strictEqual(res.status, 400);
});

test("POST /api/qna — general 문의는 성공하고, 비밀글이 아니면 목록에서 내용이 그대로 보인다", async () => {
  const app = buildApp();
  const posted = await request(app).post("/api/qna").send({ productId: "general", name: "홍길동", question: "배송은 며칠 걸리나요?" });
  assert.strictEqual(posted.status, 200);
  assert.strictEqual(posted.body.question, "배송은 며칠 걸리나요?");
  // status 기본값("답변대기")은 실제 Postgres 컬럼 default라 가짜 DB에는 없음 — 여기선 검증 안 함

  const listed = await request(app).get("/api/qna");
  assert.strictEqual(listed.status, 200);
  assert.strictEqual(listed.body[0].question, "배송은 며칠 걸리나요?");
});

test("POST /api/qna — 비밀글은 목록 조회 시 본인/관리자가 아니면 내용이 가려진다", async () => {
  const app = buildApp();
  await request(app).post("/api/qna").send({ productId: "reflect-heart-hoodie", name: "익명", question: "환불 언제 되나요?", secret: true });

  const publicView = await request(app).get("/api/qna");
  assert.strictEqual(publicView.body[0].question, null);
});

test("GET /api/admin/qna — 인증 없으면 401, 있으면 비밀글 내용도 그대로 보인다", async () => {
  const app = buildApp();
  await request(app).post("/api/qna").send({ productId: "general", name: "익명", question: "비밀 문의", secret: true });

  const unauth = await request(app).get("/api/admin/qna");
  assert.strictEqual(unauth.status, 401);

  const auth = await request(app).get("/api/admin/qna").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(auth.status, 200);
  assert.strictEqual(auth.body.items[0].question, "비밀 문의");
});

test("PATCH /api/admin/qna/:id — 답변을 등록하면 상태가 답변완료로 바뀐다", async () => {
  const app = buildApp();
  const posted = await request(app).post("/api/qna").send({ productId: "general", name: "익명", question: "질문" });

  const empty = await request(app).patch(`/api/admin/qna/${posted.body.id}`).set("Authorization", `Bearer ${TOKEN}`).send({ answer: "" });
  assert.strictEqual(empty.status, 400);

  const answered = await request(app)
    .patch(`/api/admin/qna/${posted.body.id}`)
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ answer: "안녕하세요, 답변드립니다." });
  assert.strictEqual(answered.status, 200);

  const listed = await request(app).get("/api/admin/qna").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(listed.body.items[0].status, "답변완료");
});

test("CS 템플릿 CRUD — 등록·조회·삭제가 전부 정상 동작한다", async () => {
  const app = buildApp();
  const created = await request(app)
    .post("/api/admin/qna-templates")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ label: "배송 문의 답변", body: "영업일 기준 2~3일 소요됩니다.", keywords: ["배송", "택배"] });
  assert.strictEqual(created.status, 200);
  assert.deepStrictEqual(created.body.keywords, ["배송", "택배"]);

  const listed = await request(app).get("/api/admin/qna-templates").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(listed.body.items.length, 1);

  const deleted = await request(app).delete(`/api/admin/qna-templates/${created.body.id}`).set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(deleted.status, 200);

  const listedAfter = await request(app).get("/api/admin/qna-templates").set("Authorization", `Bearer ${TOKEN}`);
  assert.strictEqual(listedAfter.body.items.length, 0);
});
