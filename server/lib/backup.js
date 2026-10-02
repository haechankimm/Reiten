/* ---------- 전체 데이터 자동 백업 (2026-10-02) ----------
   Supabase 무료 플랜은 자동 백업이 없어서(README 0번 7번 항목), 매주 월요일 새벽 주요 테이블 전체를 JSON으로
   묶어(gzip) 관리자 메일(ADMIN_NOTIFY_EMAIL)로 보낸다 — 최악의 경우 이 파일로 복구할 수 있는 "마지막 안전망".
   고객 개인정보(주문자 이름·연락처·주소)가 들어 있으니 관리자 본인 메일함으로만 보내고, Works에서는 마스터만
   같은 파일을 바로 받을 수 있다. 끄려면 Render 환경변수 BACKUP_EMAIL=off.
   Supabase Pro 플랜(일일 자동 백업·시점 복구)을 쓰게 되면 그쪽이 1차, 이 파일은 보조 백업이 된다. */
const zlib = require("zlib");
const { supabaseAdmin } = require("./supabase");

const BACKUP_TABLES = [
  "orders", "order_refunds", "return_requests", "products", "inventory", "inventory_log", "coupons",
  "loyalty_points_ledger", "reviews", "qna", "profiles", "admin_settings", "lookbook", "product_colors",
  "restock_subscriptions", "qna_templates", "notices", "calendar_events",
];
const PAGE = 1000;

async function dumpTable(db, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select("*").range(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { rows };
}

/* → { filename, buffer(gzip), summary: { table: count | "오류: ..." } } */
async function buildBackup({ db = supabaseAdmin, now = new Date() } = {}) {
  const tables = {};
  const summary = {};
  for (const t of BACKUP_TABLES) {
    const { rows, error } = await dumpTable(db, t);
    if (error) {
      summary[t] = `건너뜀(${error.slice(0, 80)})`; // 마이그레이션 전이라 없는 테이블 등
      continue;
    }
    tables[t] = rows;
    summary[t] = rows.length;
  }
  const json = JSON.stringify({ exportedAt: now.toISOString(), format: "reiten-backup-v1", tables });
  return {
    filename: `reiten-backup-${now.toISOString().slice(0, 10)}.json.gz`,
    buffer: zlib.gzipSync(Buffer.from(json, "utf8")),
    summary,
  };
}

module.exports = { BACKUP_TABLES, buildBackup };
