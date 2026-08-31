/* 색상 팔레트 조회 — routes/colors.js(관리자 CRUD)와 server.js의 상품 검증
   (productPatchFromBody에 넘기는 validColors)이 함께 쓰므로 별도 파일로 뺐다. */
const { supabaseAdmin } = require("./supabase");
const { COLORS: STATIC_COLORS } = require("../../소스 코드/assets/js/data.js");

function toColorDto(row) {
  return { key: row.key, label: row.label, labelDe: row.label_de || null, hex: row.hex };
}

function staticColorList() {
  return Object.values(STATIC_COLORS).map((c) => ({ key: c.key, label: c.label, labelDe: null, hex: c.hex }));
}

/* product_colors 테이블(마이그레이션 010)이 있으면 관리자가 자유롭게 추가한 색상까지 포함해
   내려주고, 테이블이 없거나 조회에 실패하면 data.js의 정적 6종 팔레트로 폴백한다. */
async function getPublicColors() {
  const { data, error } = await supabaseAdmin.from("product_colors").select("*").order("sort_order", { ascending: true });
  if (error) {
    console.error("[colors] DB 조회 실패, 정적 목록으로 폴백:", error.message);
    return staticColorList();
  }
  return data.map(toColorDto);
}

/* 상품 저장 시 colors 배열을 검증할 때 쓴다({ key: true, ... } 형태) — 관리자가
   product_colors에 새로 추가한 색상까지 포함해야 저장 시 걸러지지 않는다(productPatchFromBody 참고). */
async function getValidColorMap() {
  const list = await getPublicColors();
  return Object.fromEntries(list.map((c) => [c.key, true]));
}

module.exports = { toColorDto, getPublicColors, getValidColorMap };
