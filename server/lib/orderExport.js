/* 주문 목록 내보내기(CSV/엑셀/PDF) — 순수 변환 로직만 모아둔다(Supabase에 의존하지 않아 테스트하기 쉽다).
   호출부(server.js)가 이미 필터링·정렬까지 끝낸 주문 배열(Supabase row 형태)을 그대로 넘겨주면 된다. */
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const path = require("path");

const EXPORT_COLUMNS = [
  { key: "orderNo", label: "주문번호" },
  { key: "at", label: "주문일시" },
  { key: "name", label: "주문자" },
  { key: "tel", label: "연락처" },
  { key: "email", label: "이메일" },
  { key: "zip", label: "우편번호" },
  { key: "addr", label: "주소" },
  { key: "payer", label: "입금자명" },
  { key: "memo", label: "메모" },
  { key: "itemsText", label: "주문상품" },
  { key: "subtotal", label: "소계" },
  { key: "shipping", label: "배송비" },
  { key: "total", label: "합계" },
  { key: "status", label: "상태" },
  { key: "courier", label: "택배사" },
  { key: "trackingNo", label: "운송장번호" },
];

/* Supabase orders row(snake_case) → 내보내기용 평평한 객체(camelCase) */
/* toLocaleString은 "오후 7:23:00"처럼 길어서 표(특히 PDF)에서 잘리기 쉬워, 정렬도 잘 되는
   "YYYY-MM-DD HH:mm"(KST) 고정 포맷을 쓴다. */
function fmtExportDate(iso) {
  if (!iso) return "";
  const kst = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())} ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`;
}

function toExportRow(o) {
  const c = o.customer || {};
  return {
    orderNo: o.order_no,
    at: fmtExportDate(o.created_at),
    name: c.name || "",
    tel: c.tel || "",
    email: c.email || "",
    zip: c.zip || "",
    addr: [c.addr, c.addr2].filter(Boolean).join(" "),
    payer: c.payer || "",
    memo: c.memo || "",
    itemsText: (o.items || []).map((it) => `${it.name} x${it.qty}`).join(", "),
    subtotal: o.subtotal,
    shipping: o.shipping,
    total: o.total,
    status: o.status,
    courier: o.courier || "",
    trackingNo: o.tracking_no || "",
  };
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* 엑셀에서 CSV를 열었을 때 한글이 깨지지 않으려면 UTF-8 BOM이 필요하다 — 흔히 놓치는 부분. */
function toCsv(orders) {
  const headers = EXPORT_COLUMNS.map((c) => c.label);
  const lines = [headers.map(csvEscape).join(",")];
  orders.map(toExportRow).forEach((row) => {
    lines.push(EXPORT_COLUMNS.map((c) => csvEscape(row[c.key])).join(","));
  });
  return "﻿" + lines.join("\r\n");
}

async function toXlsxBuffer(orders) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("주문");
  ws.columns = EXPORT_COLUMNS.map((c) => ({ header: c.label, key: c.key, width: 18 }));
  orders.map(toExportRow).forEach((row) => ws.addRow(row));
  ws.getRow(1).font = { bold: true };
  return wb.xlsx.writeBuffer();
}

/* PDF는 표 형태가 복잡해지므로(전 컬럼 다 넣으면 한 줄에 안 들어감) 인쇄·훑어보기용으로
   핵심 컬럼만 가로 방향(landscape)으로 보여준다 — 전체 데이터는 CSV·엑셀 쪽이 담당한다. */
const PDF_COLUMNS = [
  { key: "orderNo", label: "주문번호", width: 85 },
  { key: "at", label: "주문일시", width: 90 },
  { key: "name", label: "주문자", width: 60 },
  { key: "tel", label: "연락처", width: 95 },
  { key: "itemsText", label: "주문상품", width: 210 },
  { key: "total", label: "합계", width: 65 },
  { key: "status", label: "상태", width: 55 },
  { key: "trackingNo", label: "운송장번호", width: 90 },
];
const FONT_PATH = path.join(__dirname, "../assets/fonts/Pretendard-Regular.otf");

function truncate(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function toPdfBuffer(orders) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    /* pdfkit 기본 폰트(Helvetica 등)는 한글 글리프가 없어서 한글이 안 나온다 —
       Pretendard(사이트 본문 폰트와 동일)를 직접 임베드해서 써야 한다. */
    doc.registerFont("Pretendard", FONT_PATH);
    doc.font("Pretendard");

    const left = doc.page.margins.left;
    const top = doc.page.margins.top;
    const rowHeight = 20;
    let y = top;

    /* width만 주면 pdfkit이 줄바꿈부터 시도하고, height까지 같이 줘야 그 높이를 넘는 순간
       ellipsis로 잘라낸다 — 한 줄짜리 표라 height를 rowHeight보다 살짝 작게 고정해 항상 한 줄만 남긴다. */
    const cellOpts = (w) => ({ width: w, height: rowHeight - 6, ellipsis: true, lineBreak: false });

    function drawHeaderRow() {
      doc.fontSize(9).fillColor("#000");
      let x = left;
      PDF_COLUMNS.forEach((col) => {
        doc.text(col.label, x, y, cellOpts(col.width));
        x += col.width;
      });
      y += rowHeight;
      doc.moveTo(left, y - 4).lineTo(doc.page.width - doc.page.margins.right, y - 4).strokeColor("#cccccc").stroke();
    }

    doc.fontSize(14).text("REITEN 주문 목록", left, y);
    y += 24;
    doc.fontSize(8).fillColor("#666666").text(`내보낸 시각: ${new Date().toLocaleString("ko-KR")} · 총 ${orders.length}건`, left, y);
    y += 20;
    drawHeaderRow();

    orders.map(toExportRow).forEach((row) => {
      if (y > doc.page.height - doc.page.margins.bottom - rowHeight) {
        doc.addPage();
        y = top;
        drawHeaderRow();
      }
      doc.fontSize(8.5).fillColor("#000000");
      let x = left;
      PDF_COLUMNS.forEach((col) => {
        const raw = col.key === "total" ? Number(row[col.key] || 0).toLocaleString("ko-KR") : row[col.key];
        doc.text(truncate(raw, 42), x, y, cellOpts(col.width - 4));
        x += col.width;
      });
      y += rowHeight;
    });

    doc.end();
  });
}

/* ---------- 범용 내보내기(재고·대시보드) ----------
   주문 내보내기와 달리 컬럼·행이 호출부마다 다르므로, "컬럼 정의 + 이미 평평한 행 배열"을
   그대로 받는 범용 버전을 따로 둔다. csvEscape 등 아래쪽 로직은 위 주문용과 동일하게 공유한다. */
function toCsvSection(title, columns, rows) {
  const headers = columns.map((c) => c.label);
  const lines = [csvEscape(title)];
  lines.push(headers.map(csvEscape).join(","));
  rows.forEach((row) => {
    lines.push(columns.map((c) => csvEscape(row[c.key])).join(","));
  });
  return lines.join("\r\n");
}

/* sections: [{ title, columns, rows }] — 여러 섹션을 빈 줄로 이어 붙인 CSV(대시보드용).
   섹션이 하나뿐이면(재고용) 그냥 표 하나짜리 CSV가 된다. */
function toCsvGeneric(sections) {
  return "﻿" + sections.map((s) => toCsvSection(s.title, s.columns, s.rows)).join("\r\n\r\n");
}

/* sheets: [{ name, columns, rows }] — 시트별로 컬럼·행이 다른 엑셀 워크북. */
async function toXlsxBufferGeneric(sheets) {
  const wb = new ExcelJS.Workbook();
  sheets.forEach(({ name, columns, rows }) => {
    const ws = wb.addWorksheet(name);
    ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: 18 }));
    rows.forEach((row) => ws.addRow(row));
    ws.getRow(1).font = { bold: true };
  });
  return wb.xlsx.writeBuffer();
}

module.exports = { EXPORT_COLUMNS, toExportRow, toCsv, toXlsxBuffer, toPdfBuffer, toCsvGeneric, toXlsxBufferGeneric, fmtExportDate };
