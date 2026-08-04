const test = require("node:test");
const assert = require("node:assert/strict");
const { toLookbookDto, lookbookPatchFromBody } = require("../lib/lookbook");

test("toLookbookDto — snake_case DB row를 camelCase로 변환", () => {
  const dto = toLookbookDto({
    id: "abc",
    span: "w8",
    ratio: "16/10",
    label: "01 — Night Ride",
    note: "헤드라이트 반사 컷",
    src: "assets/img/look-01.webp",
    active: true,
  });
  assert.equal(dto.span, "w8");
  assert.equal(dto.ratio, "16/10");
  assert.equal(dto.src, "assets/img/look-01.webp");
});

test("toLookbookDto — note/src 없으면 빈 문자열·null로 폴백", () => {
  const dto = toLookbookDto({ id: "x", span: "w6", ratio: "4/5", label: "라벨", active: false });
  assert.equal(dto.note, "");
  assert.equal(dto.src, null);
  assert.equal(dto.active, false);
});

test("lookbookPatchFromBody — 생성 시 라벨 누락이면 에러", () => {
  const { error } = lookbookPatchFromBody({ span: "w6", ratio: "4/5" }, { forCreate: true });
  assert.equal(error, "라벨을 입력해 주세요.");
});

test("lookbookPatchFromBody — span이 허용 목록에 없으면 에러", () => {
  const { error } = lookbookPatchFromBody({ span: "w99", ratio: "4/5", label: "라벨" }, { forCreate: true });
  assert.equal(error, "span은 w4/w6/w8/w12 중 하나여야 합니다.");
});

test("lookbookPatchFromBody — ratio 형식이 틀리면 에러", () => {
  const { error } = lookbookPatchFromBody({ span: "w6", ratio: "가로세로", label: "라벨" }, { forCreate: true });
  assert.equal(error, "ratio는 '16/10'처럼 '숫자/숫자' 형식이어야 합니다.");
});

test("lookbookPatchFromBody — 정상 생성 입력은 patch 객체를 만든다", () => {
  const { patch, error } = lookbookPatchFromBody({ span: "w8", ratio: "16/10", label: "라벨", note: "설명" }, { forCreate: true });
  assert.equal(error, undefined);
  assert.equal(patch.span, "w8");
  assert.equal(patch.ratio, "16/10");
  assert.equal(patch.note, "설명");
});

test("lookbookPatchFromBody — 수정 시 body에 없는 필드는 patch에 포함되지 않는다", () => {
  const { patch } = lookbookPatchFromBody({ active: false }, { forCreate: false });
  assert.deepEqual(Object.keys(patch), ["active"]);
});

test("lookbookPatchFromBody — src를 빈 값으로 보내면 null로 저장", () => {
  const { patch } = lookbookPatchFromBody({ src: "" }, { forCreate: false });
  assert.equal(patch.src, null);
});
