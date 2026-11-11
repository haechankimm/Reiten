/* ---------- 현금영수증 신청(무통장입금 주문, 2026-11-11) ----------
   고객이 주문서에서 신청하면 orders.customer.cashReceipt에 { type, number }로 남긴다(마이그레이션 없음 — customer는 jsonb).
   실제 발급은 관리자가 홈택스에서 하고 Works 주문 상세에서 "발급 완료"를 누르면 issuedAt이 붙는다.
   - personal(소득공제용): 휴대폰 번호(010…) 또는 현금영수증 카드번호(13~19자리)
   - business(지출증빙용): 사업자등록번호 10자리 */
const TYPES = ["personal", "business"];

function normalizeCashReceipt(raw) {
  if (!raw || raw.type === "none" || raw.type === "" || raw.type === undefined) return { value: null };
  if (!TYPES.includes(raw.type)) return { error: "현금영수증 종류가 올바르지 않습니다." };
  const digits = String(raw.number || "").replace(/\D/g, "");
  if (raw.type === "business") {
    if (digits.length !== 10) return { error: "사업자등록번호 10자리를 입력해 주세요." };
  } else if (!(/^01\d{8,9}$/.test(digits) || (digits.length >= 13 && digits.length <= 19))) {
    return { error: "현금영수증용 휴대폰 번호를 정확히 입력해 주세요." };
  }
  return { value: { type: raw.type, number: digits } };
}

/* 화면·메일용 가림 표시 — 가운데를 가린다(010****5678, 123-**-*7890) */
function maskCashReceiptNumber(number) {
  const d = String(number || "");
  if (d.length <= 4) return d;
  return d.slice(0, 3) + "*".repeat(Math.max(0, d.length - 7)) + d.slice(-4);
}

module.exports = { normalizeCashReceipt, maskCashReceiptNumber };
