/* ---------- 배송조회 자동화 — 스마트택배(SweetTracker) API ----------
   2026-10-02. 운송장이 입력된 "배송중" 주문을 주기적으로 조회해서 배송완료가 확인되면 주문을 "완료"로 바꾸고
   delivered_at(배송완료 시각)을 남긴다 → 그로부터 7일 뒤 자동 구매확정(lib/purchaseConfirm.js).
   API 키는 https://tracking.sweettracker.co.kr 에서 무료로 발급받아 Render 환경변수 SWEETTRACKER_API_KEY에
   넣으면 켜진다. 키가 없으면 아무것도 하지 않는다(다른 선택 기능과 같은 원칙) — 그때는 관리자가 Works에서
   상태를 "완료"로 바꾸는 순간이 배송완료로 기록되고, 그것도 없으면 출고 14일 뒤 자동 구매확정된다. */
const API_URL = "https://info.sweettracker.co.kr/api/v1/trackingInfo";
const budget = require("./trackingBudget");
const carriers = require("./carriers");

/* data.js COURIERS의 key → 스마트택배 택배사 코드 */
const COURIER_CODES = { cj: "04", hanjin: "05", lotte: "08", logen: "06", epost: "01" };

function isConfigured() {
  return !!(process.env.SWEETTRACKER_API_KEY || "").trim();
}

/* API 응답 → { delivered, statusText, at } 로 정리. 응답 형태가 이상하면 { error }. 순수 함수(테스트용). */
function parseTrackingResponse(body) {
  if (!body || typeof body !== "object") return { error: "빈 응답" };
  if (body.status === false || body.result === "N" || body.code) {
    return { error: body.msg || body.message || "조회 실패" };
  }
  const last = body.lastDetail || (Array.isArray(body.trackingDetails) ? body.trackingDetails[body.trackingDetails.length - 1] : null) || {};
  const level = Number(body.level) || 0;
  const delivered = body.complete === true || body.completeYN === "Y" || level >= 6;
  // 단계 기록(Works 공급처 배송조회에서 보여줌, 2026-11-10) — 최근 15단계만
  const events = (Array.isArray(body.trackingDetails) ? body.trackingDetails : [])
    .slice(-15)
    .map((d) => ({ at: String(d.timeString || "").slice(0, 30), where: String(d.where || "").slice(0, 60), kind: String(d.kind || d.status || "").slice(0, 60) }));
  return {
    delivered,
    statusText: String(last.kind || last.status || (delivered ? "배송완료" : "")).slice(0, 60),
    at: last.timeString || null,
    events,
  };
}

async function fetchTracking(courierKey, invoice, opts) {
  const code = COURIER_CODES[courierKey];
  if (!code) return { error: "지원하지 않는 택배사" };
  return fetchTrackingByCode(code, invoice, opts);
}

/* 스마트택배 택배사 코드로 직접 조회(공급처 송장처럼 고객 주문 택배사 목록 밖의 택배사도, 2026-11-10). */
async function fetchTrackingByCode(code, invoice, { fetchImpl = globalThis.fetch } = {}) {
  if (!code) return { error: "지원하지 않는 택배사" };
  if (!isConfigured()) return { error: "SWEETTRACKER_API_KEY 없음" };
  const url = `${API_URL}?t_key=${encodeURIComponent(process.env.SWEETTRACKER_API_KEY.trim())}&t_code=${encodeURIComponent(code)}&t_invoice=${encodeURIComponent(String(invoice).replace(/[^0-9A-Za-z]/g, ""))}`;
  try {
    const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { error: (body && (body.msg || body.message)) || `HTTP ${res.status}` };
    return parseTrackingResponse(body);
  } catch (e) {
    return { error: e.message || "네트워크 오류" };
  }
}

/* 월간 예산(lib/trackingBudget.js)을 1건 잡고 조회. 다 썼으면 조회하지 않고 { error, budgetExhausted: true }.
   결과의 오류(키 만료 등)는 운영 점검에 보이게 남긴다. 고객 주문 크론·공급처 크론·Works 버튼이 모두 이걸 쓴다. */
async function trackWithBudget({ code, invoice, db, now = new Date(), fetchImpl } = {}) {
  if (!isConfigured()) return { error: "SWEETTRACKER_API_KEY 없음" };
  if (!code) return { error: "지원하지 않는 택배사" };
  if (!(await budget.reserve(db, now))) return { error: "이번 달 배송조회 한도를 다 썼습니다", budgetExhausted: true };
  const r = await fetchTrackingByCode(code, invoice, fetchImpl ? { fetchImpl } : undefined);
  await budget.noteResult(db, now, r.error || null).catch(() => {});
  return r;
}

/* 표(lib/carriers.js)에 스마트택배 코드가 없는 택배사는 스마트택배 택배사 목록 API에서 이름으로 찾는다. 목록은 하루 캐시(예산 1건 사용). */
const COMPANY_LIST_URL = "https://info.sweettracker.co.kr/api/v1/companylist";
let companyCache = { at: 0, list: null };
async function companyList({ db, now = new Date(), fetchImpl = globalThis.fetch } = {}) {
  if (companyCache.list && now.getTime() - companyCache.at < 24 * 3600 * 1000) return companyCache.list;
  if (!isConfigured() || !(await budget.reserve(db, now))) return companyCache.list || [];
  try {
    const res = await fetchImpl(`${COMPANY_LIST_URL}?t_key=${encodeURIComponent(process.env.SWEETTRACKER_API_KEY.trim())}`, { headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => null);
    const list = (body && Array.isArray(body.Company) ? body.Company : []).map((c) => ({ code: String(c.Code || ""), name: String(c.Name || "") })).filter((c) => c.code && c.name);
    if (list.length) companyCache = { at: now.getTime(), list };
  } catch (e) {
    console.error("[tracking] 택배사 목록 조회 실패:", e.message);
  }
  return companyCache.list || [];
}

/* 택배사(코드·이름) → 스마트택배 코드. 표에 있으면 바로, 없으면 이름으로 목록에서 찾는다. 못 찾으면 null. */
async function resolveSweetCode(carrierCode, carrierName, opts = {}) {
  const carrier = carriers.findCarrier(carrierCode, carrierName);
  if (carrier && carrier.sweetCode) return carrier.sweetCode;
  const names = [carrier && carrier.name, ...((carrier && carrier.aliases) || []), carrierName].filter(Boolean).map(carriers.normCarrierName);
  if (!names.length) return null;
  const list = await companyList(opts);
  const hit = list.find((c) => names.includes(carriers.normCarrierName(c.name))) || list.find((c) => names.some((n) => n.length >= 2 && carriers.normCarrierName(c.name).includes(n)));
  return hit ? hit.code : null;
}

function _resetCompanyCache() {
  companyCache = { at: 0, list: null };
}

module.exports = { isConfigured, fetchTracking, fetchTrackingByCode, trackWithBudget, resolveSweetCode, parseTrackingResponse, COURIER_CODES, _resetCompanyCache };
