/* ---------- 택배사 목록 (2026-11-10) ----------
   공급처가 늘면 택배사도 늘어난다(원단 도매는 경동·대신 같은 화물택배를 자주 쓴다). 택배사를 추가할 땐 이 표에 한 줄만 넣으면
   공급처 송장 등록·배송조회 링크·스마트택배 조회가 함께 따라온다.
   - id: tracker.delivery 방식 코드(피클이 carrierCode로 보내는 값). aliases: 피클이 이름으로 보내도 알아보게.
   - courierKey: 고객 주문에서 쓰는 data.js COURIERS의 key(배송조회 링크를 거기서 가져옴).
   - sweetCode: 스마트택배 택배사 코드. 모르는 택배사는 비워 두면 스마트택배 택배사 목록 API에서 이름으로 찾는다(lib/tracking.js).
   표에 없는 택배사도 등록은 된다 — 그땐 이름으로 스마트택배 목록을 찾고, 링크는 네이버 택배 검색으로 대신한다. */
const { COURIERS } = require("../../소스 코드/assets/js/data.js");

const CARRIERS = [
  { id: "kr.cjlogistics", courierKey: "cj", sweetCode: "04", name: "CJ대한통운", aliases: ["cj", "cjlogistics", "cj대한통운", "대한통운"] },
  { id: "kr.hanjin", courierKey: "hanjin", sweetCode: "05", name: "한진택배", aliases: ["hanjin", "한진"] },
  { id: "kr.lotte", courierKey: "lotte", sweetCode: "08", name: "롯데택배", aliases: ["lotte", "롯데", "롯데글로벌로지스"] },
  { id: "kr.logen", courierKey: "logen", sweetCode: "06", name: "로젠택배", aliases: ["logen", "로젠"] },
  { id: "kr.epost", courierKey: "epost", sweetCode: "01", name: "우체국택배", aliases: ["epost", "우체국", "우체국소포"] },
  { id: "kr.kdexp", name: "경동택배", aliases: ["kdexp", "경동", "경동화물"] },
  { id: "kr.daesin", name: "대신택배", aliases: ["daesin", "대신", "대신화물"] },
  { id: "kr.ilyanglogis", name: "일양로지스", aliases: ["ilyanglogis", "일양"] },
  { id: "kr.hdexp", name: "합동택배", aliases: ["hdexp", "합동"] },
  { id: "kr.cupost", name: "CU 편의점택배", aliases: ["cupost", "cu편의점택배", "cu택배"] },
  { id: "kr.cvsnet", name: "GS Postbox 택배", aliases: ["cvsnet", "gs편의점택배", "gs postbox", "gs택배"] },
];

const norm = (s) => String(s || "").toLowerCase().replace(/[\s·()_-]/g, "");

/* 코드나 이름 → 표의 택배사(없으면 null). 코드가 먼저, 그다음 이름. */
function findCarrier(code, name) {
  const c = norm(code);
  const n = norm(name);
  return (
    CARRIERS.find((x) => norm(x.id) === c || x.aliases.some((a) => norm(a) === c)) ||
    CARRIERS.find((x) => n && (norm(x.name) === n || x.aliases.some((a) => norm(a) === n))) ||
    null
  );
}

/* 배송조회 링크 — 알려진 택배사는 그 회사 조회 화면, 모르면 네이버 검색(택배사 이름 + 송장번호면 조회 카드가 뜬다). */
function trackingUrl(code, name, trackingNumber) {
  if (!trackingNumber) return null;
  const carrier = findCarrier(code, name);
  const courier = carrier && carrier.courierKey && COURIERS.find((c) => c.key === carrier.courierKey);
  if (courier) return courier.urlTemplate.replace("{tracking}", encodeURIComponent(trackingNumber));
  const label = (carrier && carrier.name) || name || code;
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(`${label} ${trackingNumber}`)}`;
}

module.exports = { CARRIERS, findCarrier, trackingUrl, normCarrierName: norm };
