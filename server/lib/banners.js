/* 고객 사이트 띠배너(2026-11-21, 마이그레이션 056) — 휴무·배송 지연 같은 안내를 사이트 맨 위에 한 줄로 띄운다.
   Works "고객 공지 배너" 탭에서 추가·수정·삭제하면 고객 화면(app.js renderHeader)이 /api/banners로 받아 보여준다.
   여기엔 순수 함수만 둔다(입력 검사, 지금 보여줄 배너 고르기) — routes/banners.js와 테스트가 같이 쓴다. */
const TONES = ["info", "warning"];
const MAX_MESSAGE = 200;

/* 링크는 우리 사이트 안 경로(/shop.html 등)나 https 주소만 — javascript: 같은 주소로 고객 화면에 스크립트를 넣는 길을 막는다 */
function safeLink(raw) {
  const v = String(raw || "").trim();
  if (!v) return null;
  if (/^\/(?!\/)[^\s]*$/.test(v)) return v.slice(0, 300);
  if (/^https:\/\/[^\s<>"']+$/i.test(v)) return v.slice(0, 300);
  return undefined; // 잘못된 값
}

function parseDate(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/* body → DB 패치. forCreate면 문구 필수. 잘못된 값은 { error } */
function bannerPatchFromBody(b, { forCreate = false } = {}) {
  const patch = {};
  if (forCreate || b.message !== undefined) {
    const m = String(b.message || "").replace(/\s+/g, " ").trim();
    if (!m) return { error: "배너 문구를 입력해 주세요." };
    if (m.length > MAX_MESSAGE) return { error: `배너 문구는 ${MAX_MESSAGE}자 이내로 입력해 주세요.` };
    patch.message = m;
  }
  for (const [key, col] of [["messageEn", "message_en"], ["messageJa", "message_ja"]]) {
    if (b[key] !== undefined) patch[col] = String(b[key] || "").replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE) || null;
  }
  if (b.linkUrl !== undefined) {
    const link = safeLink(b.linkUrl);
    if (link === undefined) return { error: "링크는 /로 시작하는 사이트 안 주소나 https:// 주소만 넣을 수 있습니다." };
    patch.link_url = link;
  }
  if (b.tone !== undefined) patch.tone = TONES.includes(b.tone) ? b.tone : "info";
  for (const [key, col] of [["startsAt", "starts_at"], ["endsAt", "ends_at"]]) {
    if (b[key] !== undefined) {
      const d = parseDate(b[key]);
      if (d === undefined) return { error: "기간 날짜 형식이 올바르지 않습니다." };
      patch[col] = d;
    }
  }
  if (patch.starts_at && patch.ends_at && patch.ends_at <= patch.starts_at) return { error: "끝나는 시각은 시작 시각보다 뒤여야 합니다." };
  if (b.active !== undefined) patch.active = !!b.active;
  if (b.sortOrder !== undefined) patch.sort_order = Number.isFinite(Number(b.sortOrder)) ? Math.floor(Number(b.sortOrder)) : 0;
  return { patch };
}

function toBannerDto(r) {
  return {
    id: r.id,
    message: r.message,
    messageEn: r.message_en || "",
    messageJa: r.message_ja || "",
    linkUrl: r.link_url || "",
    tone: r.tone || "info",
    startsAt: r.starts_at || null,
    endsAt: r.ends_at || null,
    active: r.active !== false,
    sortOrder: r.sort_order || 0,
    createdBy: r.created_by || "",
    updatedAt: r.updated_at || r.created_at || null,
  };
}

/* 지금 고객에게 보여줄 배너 — 켜져 있고 기간 안(비어 있으면 제한 없음), 순서대로 최대 3개 */
function liveBanners(rows, now = Date.now()) {
  return (rows || [])
    .filter((r) => r.active !== false)
    .filter((r) => !r.starts_at || new Date(r.starts_at).getTime() <= now)
    .filter((r) => !r.ends_at || new Date(r.ends_at).getTime() > now)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 3);
}

/* 고객용 모양 — 관리자 정보(작성자)는 빼고, 닫기 기억용 버전(updatedAt)은 넣는다 */
function toPublicBanner(r) {
  const d = toBannerDto(r);
  return { id: d.id, message: d.message, messageEn: d.messageEn, messageJa: d.messageJa, linkUrl: d.linkUrl, tone: d.tone, version: d.updatedAt };
}

/* Works 목록 상태 표시: 표시 중 / 예약 / 끝남 / 꺼짐 */
function bannerState(r, now = Date.now()) {
  if (r.active === false) return "off";
  if (r.starts_at && new Date(r.starts_at).getTime() > now) return "scheduled";
  if (r.ends_at && new Date(r.ends_at).getTime() <= now) return "ended";
  return "live";
}

module.exports = { bannerPatchFromBody, toBannerDto, liveBanners, toPublicBanner, bannerState, safeLink };
