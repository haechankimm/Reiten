/* ---------- 서버 여러 대가 함께 쓰는 요청 제한 저장소 (2026-11-09, 마이그레이션 047) ----------
   express-rate-limit의 기본 저장소(MemoryStore)는 서버 메모리라 서버가 N대면 한도가 사실상 N배가 된다.
   RATE_LIMIT_SHARED=on 이면 Supabase의 rate_limits 표(rate_limit_hit 함수)로 모든 서버가 함께 센다.
   - 꺼져 있으면(기본) 예전처럼 메모리 저장소 — 서버 1대일 때는 이쪽이 빠르다(요청마다 DB 왕복 없음).
   - 켰는데 표·함수가 없거나 DB 오류면 그 요청부터 메모리 저장소로 넘어가고 로그를 한 번 남긴다(제한 때문에 사이트가 막히지 않게). */
const { MemoryStore } = require("express-rate-limit");

let warned = false;

class SharedRateLimitStore {
  constructor(prefix, { db } = {}) {
    this.prefix = prefix;
    // 공유 저장소를 켤 때만 Supabase를 불러온다(rateLimiters.js는 DB 설정 없이도 불러올 수 있어야 함)
    this.db = db || require("./supabase").supabaseAdmin;
    this.memory = new MemoryStore();
    this.localKeys = false;
    this.failed = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  fallback(err) {
    this.failed = true;
    if (!warned) {
      warned = true;
      console.error("[rate-limit] 공유 저장소 사용 실패, 서버 메모리로 셉니다(마이그레이션 047 실행 확인):", err && err.message);
    }
  }

  async increment(key) {
    if (this.failed) return this.memory.increment(key);
    const { data, error } = await this.db.rpc("rate_limit_hit", { p_key: this.prefix + key, p_window_ms: this.windowMs });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) {
      this.fallback(error || new Error("빈 응답"));
      return this.memory.increment(key);
    }
    return { totalHits: Number(row.out_hits), resetTime: new Date(row.out_reset_at) };
  }

  async decrement(key) {
    if (this.failed) return this.memory.decrement(key);
    await this.db.rpc("rate_limit_undo", { p_key: this.prefix + key });
  }

  async resetKey(key) {
    if (this.failed) return this.memory.resetKey(key);
    await this.db.from("rate_limits").delete().eq("key", this.prefix + key);
  }

  shutdown() {
    return this.memory.shutdown();
  }
}

function sharedEnabled(env = process.env) {
  return String(env.RATE_LIMIT_SHARED || "").toLowerCase() === "on";
}

/* 제한마다 따로 만든다(같은 저장소를 두 제한이 나눠 쓰면 express-rate-limit이 경고) — 끄면 undefined(기본 메모리) */
function storeFor(prefix) {
  return sharedEnabled() ? new SharedRateLimitStore(`${prefix}:`) : undefined;
}

module.exports = { SharedRateLimitStore, storeFor, sharedEnabled };
