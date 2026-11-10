/* ---------- 지출 장부 공용 로직 (2026-11-11, 마이그레이션 052) ----------
   지출은 supplier_invoices 표에 함께 담는다(매입 장부 확장). 여기에는 분류·결제수단·증빙 목록과
   동업자 정산·통계·내보내기에 쓰는 순수 계산만 둔다(routes/expenses.js·routes/supplierInvoices.js·lib/settlement.js가 사용).

   세무사가 없는 사업자를 위한 "업계 통상" 기준(세무 신고는 홈택스·신고 대행에서 최종 확인):
   - 분류는 간편장부·복식부기에서 흔히 쓰는 계정과목에 맞춰 묶었다(원재료·매입 / 운반비 / 광고선전비 / 지급수수료 …).
   - 부가세 매입세액 공제 "후보"는 적격증빙(세금계산서·사업용 카드·현금영수증 지출증빙)이 있고 공제 제외 성격(접대비 등)이
     아닌 지출이다. 개인 카드로 낸 것도 홈택스에 "사업용 카드"로 등록돼 있으면 공제 대상이 될 수 있어 "확인 필요"로 표시한다.
     이 값은 안내용 — 실제 공제 여부는 신고 때 확정한다. */

const CATEGORIES = {
  purchase: { label: "원재료·상품 매입", account: "원재료비·상품매입" },
  production: { label: "제작·외주 가공", account: "외주가공비" },
  shipping: { label: "택배·운송", account: "운반비" },
  packaging: { label: "포장재", account: "소모품비" },
  ads: { label: "광고·마케팅", account: "광고선전비" },
  software: { label: "서버·소프트웨어·구독", account: "지급수수료" },
  fees: { label: "결제·플랫폼 수수료", account: "지급수수료" },
  sample: { label: "샘플·개발", account: "연구개발비" },
  office: { label: "사무·소모품", account: "소모품비" },
  rent: { label: "임차료·공간", account: "지급임차료" },
  travel: { label: "교통·출장", account: "여비교통비" },
  meals: { label: "식대·접대", account: "복리후생비·접대비" },
  tax: { label: "세금·공과금", account: "세금과공과" },
  other: { label: "기타", account: "잡비" },
};

const PAYMENT_METHODS = {
  biz_check: "사업자 체크카드",
  biz_credit: "사업자 신용카드",
  personal_card: "개인 카드",
  transfer: "계좌이체",
  cash: "현금",
  auto_debit: "자동이체",
};

const EVIDENCE_TYPES = {
  tax_invoice: "세금계산서",
  card: "카드 전표",
  cash_receipt: "현금영수증(지출증빙)",
  simple_receipt: "간이영수증",
  none: "증빙 없음",
};

/* 부가세 공제 후보 — "yes"(적격증빙+공제 가능 성격), "check"(개인 카드 등 확인 필요), "no" */
function vatDeductibility(r) {
  if (r.category === "meals" || r.category === "tax") return "no";
  const ev = r.evidence_type;
  if (ev === "tax_invoice" || ev === "cash_receipt") return "yes";
  if (ev === "card") return r.payment_method === "personal_card" ? "check" : "yes";
  if (!ev && (r.payment_method === "biz_check" || r.payment_method === "biz_credit")) return "yes";
  return "no";
}

/* 공급가액·부가세가 비어 있으면 합계에서 10/110로 추정(세금계산서·카드 영수증의 통상 계산). 표시용 */
function splitVat(r) {
  if (r.supply_amount != null && r.vat_amount != null) return { supply: r.supply_amount, vat: r.vat_amount, estimated: false };
  const total = r.total_amount || 0;
  if (vatDeductibility(r) === "no") return { supply: total, vat: 0, estimated: true };
  const vat = Math.round(total / 11);
  return { supply: total - vat, vat, estimated: true };
}

/* ---------- 동업자 정산 ----------
   대상: 확인된(CONFIRMED) 공동 지출(shared) 중 동업자 개인 돈으로 낸 것(funded_by가 동업자 id), 아직 정산 안 된 것.
   각자 낸 돈(paid) − 각자 부담할 몫(total × share%) = balance. 양수면 받을 돈, 음수면 줄 돈.
   transfers: 줄 사람 → 받을 사람, 원 단위 반올림(마지막 사람에게 끝전을 맞춰 합이 0이 되게). */
function settlementCandidates(rows, partners) {
  const ids = new Set(partners.map((p) => p.id));
  return rows.filter((r) => r.status === "CONFIRMED" && r.shared !== false && !r.settlement_id && ids.has(r.funded_by));
}

function computeSettlement(rows, partners) {
  const active = partners.filter((p) => p.active !== false);
  const candidates = settlementCandidates(rows, active);
  const total = candidates.reduce((n, r) => n + (r.total_amount || 0), 0);
  const shareSum = active.reduce((n, p) => n + Number(p.share_percent || 0), 0) || 100;
  let balances = active.map((p) => {
    const paid = candidates.filter((r) => r.funded_by === p.id).reduce((n, r) => n + (r.total_amount || 0), 0);
    const share = Math.round((total * Number(p.share_percent || 0)) / shareSum);
    return { partnerId: p.id, name: p.name, paid, share, balance: paid - share };
  });
  // 반올림 끝전 보정 — 부담 합계가 total과 같게
  const diff = total - balances.reduce((n, b) => n + b.share, 0);
  if (diff && balances.length) {
    balances[balances.length - 1].share += diff;
    balances[balances.length - 1].balance -= diff;
  }
  const debtors = balances.filter((b) => b.balance < 0).map((b) => ({ ...b, left: -b.balance }));
  const creditors = balances.filter((b) => b.balance > 0).map((b) => ({ ...b, left: b.balance }));
  const transfers = [];
  for (const d of debtors) {
    for (const c of creditors) {
      if (!d.left) break;
      if (!c.left) continue;
      const amt = Math.min(d.left, c.left);
      transfers.push({ from: d.partnerId, fromName: d.name, to: c.partnerId, toName: c.name, amount: amt });
      d.left -= amt;
      c.left -= amt;
    }
  }
  return { total, count: candidates.length, expenseIds: candidates.map((r) => r.id), balances, transfers };
}

/* ---------- 통계 ---------- */
function summarize(rows, { budgets = [] } = {}) {
  const confirmed = rows.filter((r) => r.status === "CONFIRMED");
  const sum = (list) => list.reduce((n, r) => n + (r.total_amount || 0), 0);
  const group = (key) => {
    const m = new Map();
    for (const r of confirmed) {
      const k = r[key] || "unknown";
      m.set(k, (m.get(k) || 0) + (r.total_amount || 0));
    }
    return [...m.entries()].map(([k, total]) => ({ key: k, total })).sort((a, b) => b.total - a.total);
  };
  const bySupplier = new Map();
  for (const r of confirmed) {
    const cur = bySupplier.get(r.supplier_name) || { name: r.supplier_name, label: r.supplier_label || null, total: 0, count: 0 };
    cur.total += r.total_amount || 0;
    cur.count += 1;
    cur.label = cur.label || r.supplier_label || null;
    bySupplier.set(r.supplier_name, cur);
  }
  let vatCandidate = 0;
  let vatCheck = 0;
  for (const r of confirmed) {
    const d = vatDeductibility(r);
    if (d === "yes") vatCandidate += splitVat(r).vat;
    else if (d === "check") vatCheck += splitVat(r).vat;
  }
  const byCategory = group("category");
  const budgetStatus = budgets
    .filter((b) => b.monthly_amount > 0)
    .map((b) => {
      const spent = (byCategory.find((c) => c.key === b.category) || {}).total || 0;
      return { category: b.category, label: (CATEGORIES[b.category] || {}).label || b.category, budget: b.monthly_amount, spent, ratio: spent / b.monthly_amount };
    })
    .sort((a, b) => b.ratio - a.ratio);
  return {
    confirmedTotal: sum(confirmed),
    pendingTotal: sum(rows.filter((r) => r.status === "RECORDED")),
    pendingCount: rows.filter((r) => r.status === "RECORDED").length,
    count: confirmed.length,
    byCategory: byCategory.map((c) => ({ ...c, label: (CATEGORIES[c.key] || {}).label || c.key })),
    byPaymentMethod: group("payment_method").map((c) => ({ ...c, label: PAYMENT_METHODS[c.key] || "미지정" })),
    byFundedBy: group("funded_by"),
    topSuppliers: [...bySupplier.values()].sort((a, b) => b.total - a.total).slice(0, 10),
    vat: { deductibleCandidate: vatCandidate, needsCheck: vatCheck },
    budgets: budgetStatus,
  };
}

/* 월 키(YYYY-MM) → [시작일, 다음 달 1일] (발행일 date 칼럼 비교용) */
function monthBounds(monthKey) {
  const [y, m] = String(monthKey).split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return { first: `${monthKey}-01`, next: m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01` };
}

function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* 세무 신고·장부용 내보내기 행(업계 통상 열 순서: 일자·거래처·계정과목·적요·증빙·공급가액·부가세·합계·결제수단·…) */
function toLedgerRow(r, partnerNames = {}) {
  const v = splitVat(r);
  const cat = CATEGORIES[r.category] || CATEGORIES.other;
  return {
    date: r.issued_on,
    supplier: r.supplier_label || r.supplier_name,
    account: cat.account,
    category: cat.label,
    summary: r.items_summary || "",
    evidence: EVIDENCE_TYPES[r.evidence_type] || "",
    docNumber: r.doc_number || "",
    supply: v.supply,
    vat: v.vat,
    vatEstimated: v.estimated ? "추정" : "",
    total: r.total_amount,
    vatDeductible: { yes: "공제 후보", check: "확인 필요", no: "불공제" }[vatDeductibility(r)],
    payment: PAYMENT_METHODS[r.payment_method] || "",
    card: r.card_last4 ? `****${r.card_last4}` : "",
    fundedBy: r.funded_by === "business" ? "사업자" : partnerNames[r.funded_by] || r.funded_by || "",
    shared: r.shared === false ? "개인 부담" : "공동",
    settled: r.settlement_id ? "정산 완료" : "",
    memo: r.memo || "",
  };
}

const LEDGER_COLUMNS = [
  { key: "date", label: "일자" }, { key: "supplier", label: "거래처" }, { key: "account", label: "계정과목" }, { key: "category", label: "분류" },
  { key: "summary", label: "적요(품목)" }, { key: "evidence", label: "증빙" }, { key: "docNumber", label: "증빙번호" },
  { key: "supply", label: "공급가액" }, { key: "vat", label: "부가세" }, { key: "vatEstimated", label: "부가세 추정" }, { key: "total", label: "합계" },
  { key: "vatDeductible", label: "매입세액 공제" }, { key: "payment", label: "결제수단" }, { key: "card", label: "카드" },
  { key: "fundedBy", label: "낸 사람" }, { key: "shared", label: "부담" }, { key: "settled", label: "동업자 정산" }, { key: "memo", label: "메모" },
];

/* CSV 가져오기 한 줄 → 중복 판별용 해시(같은 날·금액·가맹점·카드면 같은 거래) */
function importHash(row) {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update([row.date, row.amount, String(row.merchant || "").trim().toLowerCase(), row.cardLast4 || ""].join("|")).digest("hex").slice(0, 64);
}

module.exports = {
  CATEGORIES, PAYMENT_METHODS, EVIDENCE_TYPES, vatDeductibility, splitVat, computeSettlement, settlementCandidates, summarize,
  monthBounds, shiftMonth, toLedgerRow, LEDGER_COLUMNS, importHash,
};
