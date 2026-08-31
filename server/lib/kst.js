/* KST(UTC+9) 날짜 처리를 한 곳에 모은다.
   지금까지 "+9시간 오프셋" 계산이 server.js 여러 곳(주문·반품·감사로그·재고 필터마다 각자)과
   orderExport.js에 따로따로 구현돼 있어서, 한 곳을 고치고 다른 곳을 놓치기 쉬웠다. 실제로
   computeDashboardStats()는 이 오프셋 자체가 아예 빠져 있어서 자정~오전 9시(KST) 사이에는
   "오늘 매출"이 실제로는 어제 몫까지 섞여서 나오는 버그가 있었다(서버는 UTC로 돌기 때문에
   `now.toISOString().slice(0,10)`이 그 9시간 동안은 KST 기준 "오늘"이 아니라 "어제" 날짜를
   반환함) — 아래 kstDateKey로 교체해 해결한다. 순수 함수만 있어 테스트하기 쉽다. */

const KST_OFFSET_MS = 9 * 3600 * 1000;

/* 주어진 시각을 KST로 "읽기 위한" Date로 바꾼다 — 이 반환값은 반드시 getUTC*() 계열
   메서드로만 읽어야 KST 값이 나온다(getFullYear() 등 로컬 getter를 쓰면 서버가 실제로
   도는 타임존에 따라 또 달라지므로 절대 쓰지 않는다 — Render는 UTC로 돈다). */
function toKst(date) {
  return new Date(new Date(date).getTime() + KST_OFFSET_MS);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/* KST 기준 "YYYY-MM-DD" — 대시보드의 오늘/일별 매출 집계, 재고 로그 등 "그 날"을 묶는 키로 쓴다. */
function kstDateKey(date) {
  const k = toKst(date);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())}`;
}

/* KST 기준 "YYYY-MM" — 이번 달 매출 집계용. */
function kstMonthKey(date) {
  const k = toKst(date);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}`;
}

/* KST 기준 "YYYY-MM-DD HH:mm" — 관리자 화면·엑셀/CSV 내보내기의 날짜 표시용
   (toLocaleString은 "오후 7:23:00"처럼 길어서 표에서 잘리기 쉽고 정렬도 잘 안 됨). */
function kstDateTimeLabel(date) {
  const k = toKst(date);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())} ${pad2(k.getUTCHours())}:${pad2(k.getUTCMinutes())}`;
}

/* "YYYY-MM-DD"(KST 기준 날짜)를 그날 00:00:00.000~23:59:59.999(KST)에 해당하는 UTC ISO
   문자열 범위로 바꾼다 — 관리자 패널의 날짜 필터(주문·반품·감사로그 등)에서 반복되던
   `new Date(`${d}T00:00:00+09:00`)` 패턴을 대체한다. 형식이 이상하면 null. */
function kstDayRangeISO(dateStr) {
  const start = new Date(`${dateStr}T00:00:00+09:00`);
  const end = new Date(`${dateStr}T23:59:59.999+09:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

/* `from` 기준 "이번 달에서 monthsAgo개월 전" 달의 [시작, 끝) UTC ISO 범위 — 월간 정산
   리포트(매달 1일, 지난달 = monthsAgo=1)에서 사용. Date.UTC는 month가 음수거나 11을
   넘어도 연도까지 알아서 넘겨 계산해주므로 1월에 지난달(12월, 전년도)을 구해도 안전하다. */
function kstMonthRangeISO(monthsAgo = 0, from = new Date()) {
  const k = toKst(from);
  const y = k.getUTCFullYear();
  const m = k.getUTCMonth() - monthsAgo;
  const startKst = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  const endKst = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0));
  return {
    startISO: new Date(startKst.getTime() - KST_OFFSET_MS).toISOString(),
    endISO: new Date(endKst.getTime() - KST_OFFSET_MS).toISOString(),
    monthKey: `${startKst.getUTCFullYear()}-${pad2(startKst.getUTCMonth() + 1)}`,
    monthLabel: `${startKst.getUTCFullYear()}년 ${startKst.getUTCMonth() + 1}월`,
  };
}

/* dateFrom/dateTo(YYYY-MM-DD, KST 기준 하루)를 Supabase 쿼리에 적용하는 공통 헬퍼 — 감사로그·
   주문·반품·리뷰·문의 필터에서 똑같이 반복되던 `T00:00:00+09:00` 패턴을 kstDayRangeISO
   하나로 통일한다(날짜는 한국 사용자 기준이라 UTC로 그대로 비교하면 자정 근처 기록이
   하루 어긋나 보일 수 있음). */
function applyKstDateRangeFilter(query, column, dateFrom, dateTo) {
  if (dateFrom) {
    const range = kstDayRangeISO(dateFrom);
    if (range) query = query.gte(column, range.startISO);
  }
  if (dateTo) {
    const range = kstDayRangeISO(dateTo);
    if (range) query = query.lte(column, range.endISO);
  }
  return query;
}

module.exports = { toKst, kstDateKey, kstMonthKey, kstDateTimeLabel, kstDayRangeISO, kstMonthRangeISO, applyKstDateRangeFilter };
