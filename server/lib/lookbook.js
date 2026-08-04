/* 룩북 DTO 변환 · 관리자 입력값 검증 — 순수 함수만 모아둔다(테스트하기 쉽도록 Supabase에 의존하지 않음). */
const SPANS = ["w4", "w6", "w8", "w12"];

function toLookbookDto(row) {
  return {
    id: row.id,
    span: row.span,
    ratio: row.ratio,
    label: row.label,
    note: row.note || "",
    src: row.src || null,
    active: row.active,
  };
}

/* forCreate=true면 필수 필드(span/ratio/label)가 비어 있거나 형식이 틀리면 에러를 반환한다.
   forCreate=false(수정)면 body에 들어온 필드만 patch에 반영한다. */
function lookbookPatchFromBody(b, { forCreate }) {
  const patch = {};
  if (forCreate || b.span !== undefined) {
    const v = String(b.span || "").trim();
    if (!SPANS.includes(v)) return { error: "span은 w4/w6/w8/w12 중 하나여야 합니다." };
    patch.span = v;
  }
  if (forCreate || b.ratio !== undefined) {
    const v = String(b.ratio || "").trim();
    if (!/^\d+\/\d+$/.test(v)) return { error: "ratio는 '16/10'처럼 '숫자/숫자' 형식이어야 합니다." };
    patch.ratio = v;
  }
  if (forCreate || b.label !== undefined) {
    const v = String(b.label || "").trim().slice(0, 120);
    if (forCreate && !v) return { error: "라벨을 입력해 주세요." };
    patch.label = v;
  }
  if (b.note !== undefined) patch.note = String(b.note || "").trim().slice(0, 200);
  if (b.src !== undefined) patch.src = b.src ? String(b.src).trim().slice(0, 500) : null;
  if (b.active !== undefined) patch.active = !!b.active;
  if (b.sortOrder !== undefined) patch.sort_order = Number.isFinite(Number(b.sortOrder)) ? Math.floor(Number(b.sortOrder)) : 0;
  return { patch };
}

module.exports = { toLookbookDto, lookbookPatchFromBody, SPANS };
