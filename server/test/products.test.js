const test = require("node:test");
const assert = require("node:assert/strict");
const { toProductDto, productPatchFromBody } = require("../lib/products");

test("toProductDto — snake_case DB row를 camelCase로 변환", () => {
  const dto = toProductDto({
    id: "core-zip-hoodie",
    name: "Core Zip Hoodie",
    name_ko: "코어 집업 후디",
    type: "zip",
    category: "후드집업",
    price: 119000,
    badge: "Customizable",
    images: ["a.webp", null],
    colors: ["black"],
    sizes: ["S", "M"],
    sold_out: ["S"],
    size_table: "hoodie",
    short: "설명",
    description: "상세 설명",
    details: ["d1"],
    charm_ready: true,
    active: true,
  });
  assert.equal(dto.nameKo, "코어 집업 후디");
  assert.equal(dto.sizeTable, "hoodie");
  assert.deepEqual(dto.soldOut, ["S"]);
  assert.equal(dto.charmReady, true);
  assert.equal(dto.desc, "상세 설명");
});

test("toProductDto — null/누락 필드는 빈 배열·빈 문자열로 폴백", () => {
  const dto = toProductDto({ id: "x", name: "X", name_ko: "엑스", type: "hoodie", category: "후드티", price: 1000, active: false });
  assert.deepEqual(dto.images, []);
  assert.deepEqual(dto.colors, []);
  assert.deepEqual(dto.details, []);
  assert.equal(dto.short, "");
  assert.equal(dto.charmReady, false);
  assert.equal(dto.badge, undefined);
});

test("productPatchFromBody — 생성 시 필수값 누락이면 에러 반환", () => {
  const { error } = productPatchFromBody({}, { forCreate: true });
  assert.equal(error, "상품명을 입력해 주세요.");
});

test("productPatchFromBody — 생성 시 가격이 0 이하면 에러", () => {
  const { error } = productPatchFromBody(
    { name: "A", nameKo: "에이", type: "hoodie", category: "후드티", price: 0 },
    { forCreate: true }
  );
  assert.equal(error, "가격이 올바르지 않습니다.");
});

test("productPatchFromBody — 정상 생성 입력은 patch 객체를 만든다", () => {
  const { patch, error } = productPatchFromBody(
    { name: "A", nameKo: "에이", type: "hoodie", category: "후드티", price: 50000 },
    { forCreate: true }
  );
  assert.equal(error, undefined);
  assert.equal(patch.name, "A");
  assert.equal(patch.price, 50000);
});

test("productPatchFromBody — COLORS에 없는 컬러 키는 걸러낸다", () => {
  const { patch } = productPatchFromBody({ colors: ["black", "not-a-real-color"] }, { forCreate: false });
  assert.deepEqual(patch.colors, ["black"]);
});

test("productPatchFromBody — SIZE_TABLES에 없는 sizeTable 값은 null로 저장", () => {
  const { patch } = productPatchFromBody({ sizeTable: "no-such-table" }, { forCreate: false });
  assert.equal(patch.size_table, null);
});

test("productPatchFromBody — 수정 시 body에 없는 필드는 patch에 포함되지 않는다", () => {
  const { patch } = productPatchFromBody({ price: 60000 }, { forCreate: false });
  assert.deepEqual(Object.keys(patch), ["price"]);
});
