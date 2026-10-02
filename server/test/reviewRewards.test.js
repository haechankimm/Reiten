/* lib/reviewRewards.js — 회원 주문 사진 리뷰 승인 시 적립(리뷰당 1회), 비회원·사진 없음·0원 설정은 제외 */
process.env.SUPABASE_URL = "fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { supabaseAdmin } = require("../lib/supabase");
const { rewardPhotoReview } = require("../lib/reviewRewards");

beforeEach(() => {
  supabaseAdmin.__reset({
    orders: [{ order_no: "M1", user_id: "u1", status: "완료" }, { order_no: "G1", user_id: null, status: "완료" }],
    loyalty_points_ledger: [],
    admin_settings: [],
  });
});
after(() => { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

test("회원 주문 사진 리뷰 — 기본 1,000원, 같은 리뷰는 한 번만", async () => {
  const review = { id: "rv1", photo_url: "https://res.cloudinary.com/x.jpg", order_no: "M1" };
  assert.equal((await rewardPhotoReview(supabaseAdmin, review)).awarded, 1000);
  assert.equal((await rewardPhotoReview(supabaseAdmin, review)).awarded, 0);
  const ledger = (await supabaseAdmin.from("loyalty_points_ledger").select("*")).data;
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].reason, "earn_review");
});

test("비회원 주문·사진 없음·설정 0원은 적립하지 않는다, 설정값을 따른다", async () => {
  assert.equal((await rewardPhotoReview(supabaseAdmin, { id: "rv2", photo_url: "x", order_no: "G1" })).reason, "guest_order");
  assert.equal((await rewardPhotoReview(supabaseAdmin, { id: "rv3", photo_url: null, order_no: "M1" })).reason, "no_photo_or_order");
  supabaseAdmin.__reset({ orders: [{ order_no: "M1", user_id: "u1", status: "완료" }], loyalty_points_ledger: [], admin_settings: [{ label: "사진 리뷰 적립금(원)", value: "0" }] });
  assert.equal((await rewardPhotoReview(supabaseAdmin, { id: "rv4", photo_url: "x", order_no: "M1" })).reason, "disabled");
  supabaseAdmin.__reset({ orders: [{ order_no: "M1", user_id: "u1", status: "완료" }], loyalty_points_ledger: [], admin_settings: [{ label: "사진 리뷰 적립금(원)", value: "2,000" }] });
  assert.equal((await rewardPhotoReview(supabaseAdmin, { id: "rv5", photo_url: "x", order_no: "M1" })).awarded, 2000);
});
