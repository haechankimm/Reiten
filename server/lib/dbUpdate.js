/* insertOrderRow(server.js)와 같은 원칙을 UPDATE에도 적용하는 공용 헬퍼 — 담당자 지정
   (assigned_to)·내부 메모(internal_note, 036_assignee_and_notes.sql)를 orders·return_requests·
   qna 세 라우트(server.js, routes/qna.js)가 전부 똑같이 다뤄야 해서 한 곳으로 뽑았다.
   optionalCols에 없는 컬럼이 원인인 에러면 그대로 반환해 호출부가 처리하게 한다. */
const { supabaseAdmin } = require("./supabase");
const { isMissingColumnError, extractMissingColumnName } = require("./pgErrors");

const ASSIGNEE_NOTE_OPTIONAL_COLUMNS = ["assigned_to", "internal_note"];

async function updateWithOptionalColumnFallback(table, matchColumn, matchValue, patch, optionalCols = ASSIGNEE_NOTE_OPTIONAL_COLUMNS) {
  const run = (p) => supabaseAdmin.from(table).update(p).eq(matchColumn, matchValue).select().maybeSingle();
  let current = patch;
  let result = await run(current);
  for (let i = 0; i < optionalCols.length && isMissingColumnError(result.error); i++) {
    const named = extractMissingColumnName(result.error);
    const col = named && named in current ? named : optionalCols.find((c) => c in current);
    if (!col) break;
    console.warn(`[${table}] '${col}' 컬럼 없음(마이그레이션 036 미실행) — ${col} 없이 재시도`);
    const { [col]: _omit, ...rest } = current;
    current = rest;
    result = await run(current);
  }
  return result;
}

/* selectOrdersWithFallback(server.js)과 같은 원칙의 범용 SELECT 버전 — 반품 신청 목록도
   033(request_type/custom_reason)·036(assigned_to/internal_note) 마이그레이션이 부분적으로만
   적용됐을 수 있어, 없는 컬럼만 하나씩 빼며 재조회한다. buildQuery(columns)는 그 컬럼
   목록으로 완성된 쿼리(range/limit까지 건)를 반환해야 한다. */
async function selectWithOptionalColumnFallback(baseColumns, optionalColumns, buildQuery) {
  let columns = [baseColumns, ...optionalColumns];
  let result = await buildQuery(columns);
  for (let i = 0; i < optionalColumns.length && isMissingColumnError(result.error); i++) {
    const named = extractMissingColumnName(result.error);
    const col = named && columns.includes(named) ? named : optionalColumns.find((c) => columns.includes(c));
    if (!col) break;
    columns = columns.filter((c) => c !== col);
    result = await buildQuery(columns);
  }
  return result;
}

module.exports = { ASSIGNEE_NOTE_OPTIONAL_COLUMNS, updateWithOptionalColumnFallback, selectWithOptionalColumnFallback };
