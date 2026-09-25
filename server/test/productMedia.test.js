const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeMedia, mediaFromRow, productPatchFromBody, toProductDto } = require("../lib/products");

const COLORS = { black: true, sky: true };
const CDN = "https://res.cloudinary.com/x/image/upload/v1/a.jpg";

test("sanitizeMedia — 모르는 종류·외부 주소·빈 문구는 버리고, 없는 컬러는 공통으로", () => {
  const out = sanitizeMedia([
    { kind: "gallery", src: CDN, color: "black" },
    { kind: "detail", src: CDN, color: "pink", caption: "원단" },
    { kind: "video", src: "https://evil.example.com/v.mp4" },
    { kind: "text", text: "  " },
    { kind: "text", text: "헤비 기모", color: "sky" },
    { kind: "hack", src: CDN },
  ], COLORS);
  assert.deepEqual(out, [
    { kind: "gallery", src: CDN, color: "black" },
    { kind: "detail", src: CDN, color: null, caption: "원단" },
    { kind: "text", text: "헤비 기모", color: "sky" },
  ]);
});

test("mediaFromRow — media가 없으면 예전 images+image_colors로 갤러리를 만든다", () => {
  assert.deepEqual(mediaFromRow({ images: [CDN, null, CDN], image_colors: ["black", null, null] }), [
    { kind: "gallery", src: CDN, color: "black" },
    { kind: "gallery", src: CDN, color: null },
  ]);
  const media = [{ kind: "detail", src: CDN, color: null }];
  assert.equal(mediaFromRow({ media, images: [CDN] }), media);
});

test("productPatchFromBody — media를 저장하면 images/image_colors가 갤러리 사진으로 맞춰진다", () => {
  const { patch } = productPatchFromBody({
    media: [
      { kind: "detail", src: CDN, color: null },
      { kind: "gallery", src: CDN + "?b", color: "black" },
      { kind: "gallery", src: CDN + "?s", color: "sky" },
    ],
    modelInfo: " 178cm / L ",
  }, { forCreate: false, validColors: COLORS });
  assert.equal(patch.media.length, 3);
  assert.deepEqual(patch.images, [CDN + "?b", CDN + "?s"]);
  assert.deepEqual(patch.image_colors, ["black", "sky"]);
  assert.equal(patch.model_info, "178cm / L");
});

test("toProductDto — media·modelInfo를 내려준다", () => {
  const dto = toProductDto({ id: "a", images: [CDN], image_colors: ["black"], model_info: "M 착용" });
  assert.equal(dto.modelInfo, "M 착용");
  assert.equal(dto.media[0].color, "black");
});
