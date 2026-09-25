/* 상품 DTO 변환 · 관리자 입력값 검증 — 순수 함수만 모아둔다(테스트하기 쉽도록 Supabase에 의존하지 않음). */
const { COLORS, SIZE_TABLES } = require("../../소스 코드/assets/js/data.js");

const MEDIA_KINDS = ["gallery", "detail", "video", "text"];
const MAX_MEDIA = 60;

/* media가 비어 있는 예전 상품은 images(최대 4칸)+image_colors를 갤러리 항목으로 바꿔서 내려준다 —
   상품 페이지·Works가 media 하나만 보면 되게 하기 위함(DB는 건드리지 않음). */
function mediaFromRow(row) {
  if (Array.isArray(row.media) && row.media.length) return row.media;
  const colors = row.image_colors || [];
  return (row.images || [])
    .map((src, i) => (src ? { kind: "gallery", src, color: colors[i] || null } : null))
    .filter(Boolean);
}

/* 관리자 입력 검증 — 모르는 kind·잘못된 주소·없는 컬러는 걸러낸다. */
function sanitizeMedia(input, validColors) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const m of input.slice(0, MAX_MEDIA)) {
    if (!m || !MEDIA_KINDS.includes(m.kind)) continue;
    const color = m.color && validColors[m.color] ? m.color : null;
    if (m.kind === "text") {
      const text = String(m.text || "").trim().slice(0, 2000);
      if (text) out.push({ kind: "text", text, color });
      continue;
    }
    const src = String(m.src || "").trim();
    if (!/^https:\/\/res\.cloudinary\.com\//.test(src) && !/^\/assets\//.test(src)) continue;
    const item = { kind: m.kind, src: src.slice(0, 500), color };
    const caption = String(m.caption || "").trim().slice(0, 300);
    if (caption) item.caption = caption;
    out.push(item);
  }
  return out;
}

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
    imageColors: row.image_colors || [],
    media: mediaFromRow(row),
    modelInfo: row.model_info || "",
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
   forCreate=false(수정)면 body에 들어온 필드만 patch에 반영한다.
   validColors는 { key: true, ... } 형태 — 관리자가 product_colors 테이블에 추가한 색상까지
   포함해서 호출부(server.js)가 넘겨준다. 안 넘기면(단위 테스트 등) data.js의 정적 COLORS로 폴백한다. */
function productPatchFromBody(b, { forCreate, validColors = COLORS }) {
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
  if (b.imageColors !== undefined) {
    /* images와 같은 인덱스로 짝을 맞추는 배열이라 필터링하면 안 되고(칸이 밀림), 유효하지 않은
       값만 null로 바꿔치기한다. */
    patch.image_colors = Array.isArray(b.imageColors)
      ? b.imageColors.slice(0, 6).map((c) => (c && validColors[c] ? c : null))
      : [];
  }
  if (b.media !== undefined) {
    patch.media = sanitizeMedia(b.media, validColors);
    /* 상품 카드·장바구니·공유 미리보기 등 나머지 화면은 계속 images를 보므로, 갤러리 사진으로 맞춰 둔다. */
    const gallery = patch.media.filter((m) => m.kind === "gallery").slice(0, 6);
    patch.images = gallery.map((m) => m.src);
    patch.image_colors = gallery.map((m) => m.color);
  }
  if (b.modelInfo !== undefined) patch.model_info = String(b.modelInfo || "").trim().slice(0, 120) || null;
  if (b.colors !== undefined) {
    patch.colors = Array.isArray(b.colors) ? b.colors.filter((c) => validColors[c]) : [];
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

module.exports = { toProductDto, productPatchFromBody, sanitizeMedia, mediaFromRow };
