/* ---------- 배송조회 자동화 — 스마트택배(SweetTracker) API ----------
   2026-10-02. 운송장이 입력된 "배송중" 주문을 주기적으로 조회해서 배송완료가 확인되면 주문을 "완료"로 바꾸고
   delivered_at(배송완료 시각)을 남긴다 → 그로부터 7일 뒤 자동 구매확정(lib/purchaseConfirm.js).
   API 키는 https://tracking.sweettracker.co.kr 에서 무료로 발급받아 Render 환경변수 SWEETTRACKER_API_KEY에
   넣으면 켜진다. 키가 없으면 아무것도 하지 않는다(다른 선택 기능과 같은 원칙) — 그때는 관리자가 Works에서
   상태를 "완료"로 바꾸는 순간이 배송완료로 기록되고, 그것도 없으면 출고 14일 뒤 자동 구매확정된다. */
const API_URL = "https://info.sweettracker.co.kr/api/v1/trackingInfo";

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
  return {
    delivered,
    statusText: String(last.kind || last.status || (delivered ? "배송완료" : "")).slice(0, 60),
    at: last.timeString || null,
  };
}

async function fetchTracking(courierKey, invoice, { fetchImpl = globalThis.fetch } = {}) {
  const code = COURIER_CODES[courierKey];
  if (!code) return { error: "지원하지 않는 택배사" };
  if (!isConfigured()) return { error: "SWEETTRACKER_API_KEY 없음" };
  const url = `${API_URL}?t_key=${encodeURIComponent(process.env.SWEETTRACKER_API_KEY.trim())}&t_code=${code}&t_invoice=${encodeURIComponent(String(invoice).replace(/[^0-9A-Za-z]/g, ""))}`;
  try {
    const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { error: (body && (body.msg || body.message)) || `HTTP ${res.status}` };
    return parseTrackingResponse(body);
  } catch (e) {
    return { error: e.message || "네트워크 오류" };
  }
}

module.exports = { isConfigured, fetchTracking, parseTrackingResponse, COURIER_CODES };
