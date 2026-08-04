/* 상품 DTO 변환 · 관리자 입력값 검증 — 순수 함수만 모아둔다(테스트하기 쉽도록 Supabase에 의존하지 않음). */
const { COLORS, SIZE_TABLES } = require("../../소스 코드/assets/js/data.js");

function toProductDto(row) {
  return {
    id: row.id,
    name: row.name,
    nameKo: row.name_ko,
    type: row.type,
    category: row.category,
    price: row.price,
    badge: row.badge || undefined,
    images: row.images || [],
    colors: row.colors || [],
    sizes: row.sizes || [],
    soldOut: row.sold_out || [],
    sizeTable: row.size_table || undefined,
    short: row.short || "",
    desc: row.description || "",
    details: row.details || [],
    charmReady: !!row.charm_ready,
    active: row.active,
  };
}

/* forCreate=true면 필수 필드(name/nameKo/type/category/price)가 비어 있을 때 에러를 반환한다.
   forCreate=false(수정)면 body에 들어온 필드만 patch에 반영한다. */
function productPatchFromBody(b, { forCreate }) {
  const patch = {};
  if (forCreate || b.name !== undefined) {
    const v = String(b.name || "").trim().slice(0, 120);
    if (forCreate && !v) return { error: "상품명을 입력해 주세요." };
    patch.name = v;
  }
  if (forCreate || b.nameKo !== undefined) {
    const v = String(b.nameKo || "").trim().slice(0, 120);
    if (forCreate && !v) return { error: "한글 상품명을 입력해 주세요." };
    patch.name_ko = v;
  }
  if (forCreate || b.type !== undefined) {
    const v = String(b.type || "").trim().slice(0, 30);
    if (forCreate && !v) return { error: "타입을 입력해 주세요." };
    patch.type = v;
  }
  if (forCreate || b.category !== undefined) {
    const v = String(b.category || "").trim().slice(0, 40);
    if (forCreate && !v) return { error: "카테고리를 입력해 주세요." };
    patch.category = v;
  }
  if (forCreate || b.price !== undefined) {
    const price = Math.floor(Number(b.price));
    if (!Number.isFinite(price) || price <= 0) return { error: "가격이 올바르지 않습니다." };
    patch.price = price;
  }
  if (b.badge !== undefined) patch.badge = String(b.badge || "").trim().slice(0, 40) || null;
  if (b.images !== undefined) {
    patch.images = Array.isArray(b.images) ? b.images.slice(0, 6).map((u) => (u ? String(u).slice(0, 500) : null)) : [];
  }
  if (b.colors !== undefined) {
    patch.colors = Array.isArray(b.colors) ? b.colors.filter((c) => COLORS[c]) : [];
  }
  if (b.sizes !== undefined) {
    patch.sizes = Array.isArray(b.sizes) ? b.sizes.filter((s) => typeof s === "string").slice(0, 10) : [];
  }
  if (b.soldOut !== undefined) {
    patch.sold_out = Array.isArray(b.soldOut) ? b.soldOut.filter((s) => typeof s === "string").slice(0, 10) : [];
  }
  if (b.sizeTable !== undefined) {
    patch.size_table = b.sizeTable && SIZE_TABLES[b.sizeTable] ? b.sizeTable : null;
  }
  if (b.short !== undefined) patch.short = String(b.short || "").trim().slice(0, 200);
  if (b.desc !== undefined) patch.description = String(b.desc || "").trim().slice(0, 3000);
  if (b.details !== undefined) {
    patch.details = Array.isArray(b.details)
      ? b.details.filter((d) => typeof d === "string").slice(0, 20).map((d) => d.slice(0, 300))
      : [];
  }
  if (b.charmReady !== undefined) patch.charm_ready = !!b.charmReady;
  if (b.active !== undefined) patch.active = !!b.active;
  if (b.sortOrder !== undefined) patch.sort_order = Number.isFinite(Number(b.sortOrder)) ? Math.floor(Number(b.sortOrder)) : 0;
  return { patch };
}

module.exports = { toProductDto, productPatchFromBody };
