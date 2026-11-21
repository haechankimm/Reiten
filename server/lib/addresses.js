/* 회원 배송지 주소록 · 출고 전 고객 셀프 배송지 변경(2026-11-21, 마이그레이션 056) — 순수 함수. routes/addresses.js가 쓴다. */
const MAX_ADDRESSES = 10;
/* 배송지를 고객이 직접 바꿀 수 있는 주문 상태 — 운송장이 입력되면(출고 준비 끝) 잠근다 */
const EDITABLE_STATUSES = ["입금대기", "입금확인"];
const HISTORY_KEEP = 5;

const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);

/* 우편번호·주소는 주문서와 같은 기준(5자리 우편번호, 주소 검색으로 채운 도로명 주소) */
function shipFields(b) {
  const zip = clip(b.zip, 10).replace(/\D/g, "");
  const addr = clip(b.addr, 200);
  const addr2 = clip(b.addr2, 120);
  if (!/^\d{5}$/.test(zip)) return { error: "우편번호 5자리를 주소 검색으로 채워 주세요." };
  if (addr.length < 5) return { error: "주소를 주소 검색으로 채워 주세요." };
  return { zip, addr, addr2 };
}

function addressFromBody(b) {
  b = b || {};
  const s = shipFields(b);
  if (s.error) return { error: s.error };
  const name = clip(b.name, 40);
  const tel = clip(b.tel, 20);
  if (name.length < 1) return { error: "받는 분 이름을 입력해 주세요." };
  if (tel.replace(/\D/g, "").length < 9) return { error: "받는 분 연락처를 확인해 주세요." };
  return { row: { label: clip(b.label, 30) || null, name, tel, zip: s.zip, addr: s.addr, addr2: s.addr2 || null } };
}

function toAddressDto(r) {
  return { id: r.id, label: r.label || "", name: r.name, tel: r.tel, zip: r.zip, addr: r.addr, addr2: r.addr2 || "", isDefault: !!r.is_default };
}

/* 같은 주소를 또 저장하지 않게 — 받는 분·우편번호·주소·상세주소가 같으면 같은 배송지 */
function sameAddress(a, b) {
  const n = (v) => String(v || "").replace(/\s+/g, "").toLowerCase();
  return n(a.name) === n(b.name) && n(a.zip) === n(b.zip) && n(a.addr) === n(b.addr) && n(a.addr2) === n(b.addr2);
}

function canEditAddress(order) {
  return !!order && EDITABLE_STATUSES.includes(order.status) && !order.tracking_no;
}

/* 주문의 customer(jsonb)에 새 배송지를 넣고, 이전 배송지는 addressHistory에 남긴다(Works 주문 상세에 표시) */
function applyAddressChange(customer, change, now = new Date()) {
  const c = customer || {};
  const prev = { at: now.toISOString(), zip: c.zip || "", addr: c.addr || "", addr2: c.addr2 || "", memo: c.memo || "" };
  return {
    ...c,
    zip: change.zip,
    addr: change.addr,
    addr2: change.addr2 || "",
    memo: change.memo !== undefined ? change.memo : c.memo || "",
    addressChangedAt: now.toISOString(),
    addressHistory: [...(Array.isArray(c.addressHistory) ? c.addressHistory : []), prev].slice(-HISTORY_KEEP),
  };
}

module.exports = { MAX_ADDRESSES, EDITABLE_STATUSES, shipFields, addressFromBody, toAddressDto, sameAddress, canEditAddress, applyAddressChange };
