/* 라이딩 크루·동호회 단체 주문 문의(2026-11-21, 마이그레이션 056) — 순수 함수(입력 검사·모양 변환). routes/groupInquiries.js가 쓴다. */
const STATUSES = ["접수", "상담중", "견적발송", "확정", "종료"];
const MIN_QTY = 5;
const MAX_QTY = 5000;

const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

/* 고객이 보낸 문의 → DB 행. 잘못된 값은 { error } */
function inquiryFromBody(b) {
  b = b || {};
  const teamName = clip(b.teamName, 80);
  const contactName = clip(b.contactName, 40);
  const tel = clip(b.tel, 20);
  const email = clip(b.email, 120);
  const quantity = Math.floor(Number(b.quantity));
  if (!teamName) return { error: "팀(크루)명을 입력해 주세요." };
  if (!contactName) return { error: "담당자 이름을 입력해 주세요." };
  if (!/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(tel.replace(/\s/g, ""))) return { error: "연락처를 정확히 입력해 주세요." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "이메일 형식을 확인해 주세요." };
  if (!Number.isFinite(quantity) || quantity < MIN_QTY) return { error: `단체 주문은 ${MIN_QTY}벌부터 문의할 수 있습니다.` };
  if (quantity > MAX_QTY) return { error: "수량을 다시 확인해 주세요." };
  let desiredDate = null;
  if (b.desiredDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.desiredDate))) return { error: "희망 날짜 형식이 올바르지 않습니다." };
    desiredDate = String(b.desiredDate);
  }
  return {
    row: {
      team_name: teamName,
      contact_name: contactName,
      tel,
      email,
      quantity,
      products: clip(b.products, 300) || null,
      customization: clip(b.customization, 1000) || null,
      desired_date: desiredDate,
      message: clip(b.message, 2000) || null,
    },
  };
}

function toInquiryDto(r) {
  return {
    id: r.id,
    teamName: r.team_name,
    contactName: r.contact_name,
    tel: r.tel,
    email: r.email,
    quantity: r.quantity,
    products: r.products || "",
    customization: r.customization || "",
    desiredDate: r.desired_date || null,
    message: r.message || "",
    status: r.status,
    adminMemo: r.admin_memo || "",
    assignedTo: r.assigned_to || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* 관리자 수정(상태·메모·담당자) */
function inquiryPatchFromBody(b) {
  b = b || {};
  const patch = {};
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return { error: "상태 값이 올바르지 않습니다." };
    patch.status = b.status;
  }
  if (b.adminMemo !== undefined) patch.admin_memo = clip(b.adminMemo, 2000) || null;
  if (b.assignedTo !== undefined) patch.assigned_to = b.assignedTo || null;
  return { patch };
}

module.exports = { inquiryFromBody, toInquiryDto, inquiryPatchFromBody, STATUSES, MIN_QTY };
