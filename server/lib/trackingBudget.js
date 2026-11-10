/* ---------- 스마트택배 월간 조회 예산 (2026-11-10, 마이그레이션 049) ----------
   무료 플랜은 한 달 100건이고, 다 쓰면 그달 남은 기간은 조회가 막힌다. 고객 주문 배송조회 크론·공급처 송장 크론·Works "배송조회"
   버튼이 모두 이 예산을 함께 쓴다 — 조회 직전에 reserve()로 1건을 잡고, 한도에 닿으면 조회하지 않는다.
   한도: Render SWEETTRACKER_MONTHLY_LIMIT(기본 100, 유료 이용권으로 바꾸면 그 건수로). 달은 한국 시간 기준.
   api_usage_monthly 표(049)가 없으면 서버 메모리로 센다(재시작하면 0부터 — 049 실행 권장). */
const { kstMonthKey } = require("./kst");
const { isMissingSchemaError } = require("./pgErrors");

const PROVIDER = "sweettracker";
const TABLE = "api_usage_monthly";
let memory = { month: null, calls: 0, lastError: null, lastErrorAt: null };

function monthlyLimit(env = process.env) {
  const n = Number(env.SWEETTRACKER_MONTHLY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 100;
}

async function readRow(db, month) {
  const { data, error } = await db.from(TABLE).select("*").eq("key", `${PROVIDER}:${month}`).maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) return { persisted: false };
    throw error;
  }
  return { persisted: true, row: data };
}

function memRow(month) {
  if (memory.month !== month) memory = { month, calls: 0, lastError: null, lastErrorAt: null };
  return memory;
}

async function usage(db, now = new Date()) {
  const month = kstMonthKey(now);
  const limit = monthlyLimit();
  const r = await readRow(db, month).catch(() => ({ persisted: false }));
  const src = r.persisted ? r.row || {} : memRow(month);
  const calls = Number(src.calls) || 0;
  return {
    month, limit, calls, remaining: Math.max(0, limit - calls), persisted: r.persisted,
    lastError: src.last_error || src.lastError || null, lastErrorAt: src.last_error_at || src.lastErrorAt || null,
  };
}

async function write(db, month, patch) {
  const { error } = await db
    .from(TABLE)
    .upsert({ key: `${PROVIDER}:${month}`, provider: PROVIDER, month, ...patch, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return !error;
}

/* 1건 쓰기 — 남았으면 true(그리고 1 올림), 다 썼으면 false. */
async function reserve(db, now = new Date()) {
  const u = await usage(db, now);
  if (u.calls >= u.limit) return false;
  if (u.persisted) {
    const ok = await write(db, u.month, { calls: u.calls + 1 });
    if (ok) return true;
  }
  memRow(u.month).calls = Math.max(memory.calls, u.calls) + 1;
  return true;
}

/* 조회 실패(키 만료·잘못된 키 등)를 남겨 운영 점검에 보이게 한다. 성공하면 clear. */
async function noteResult(db, now, errorMessage) {
  const month = kstMonthKey(now);
  const patch = errorMessage ? { last_error: String(errorMessage).slice(0, 200), last_error_at: now.toISOString() } : { last_error: null, last_error_at: null };
  const m = memRow(month);
  m.lastError = patch.last_error;
  m.lastErrorAt = patch.last_error_at;
  const r = await readRow(db, month).catch(() => ({ persisted: false }));
  if (r.persisted && (errorMessage || (r.row && r.row.last_error))) await write(db, month, { calls: Number((r.row || {}).calls) || 0, ...patch });
}

function _resetMemory() {
  memory = { month: null, calls: 0, lastError: null, lastErrorAt: null };
}

module.exports = { usage, reserve, noteResult, monthlyLimit, _resetMemory };
