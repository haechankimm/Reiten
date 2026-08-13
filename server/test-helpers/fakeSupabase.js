/* 결제·쿠폰 로직을 실제 Supabase 없이 통합 테스트하기 위한 최소 가짜 클라이언트.
   resolveCoupon(lib/coupons.js)이 실제로 쓰는 호출 패턴만 지원한다:
     db.from(table).select(cols, opts?).eq(col, val)...maybeSingle()
     db.from(table).select(cols, { count: "exact", head: true }).eq(col, val)   (await 직접)
   진짜 Supabase의 PostgrestFilterBuilder처럼 체이닝 도중 어디서 await해도(그 자체가 thenable)
   결과가 나오게 만들어서, 실제 서버 코드를 고치지 않고도 그대로 테스트에 꽂을 수 있다. */

class FakeQuery {
  constructor(rows) {
    this.rows = rows;
    this.filters = [];
    this.wantCount = false;
    this.mode = "many"; // "single" | "maybeSingle" | "many"
  }
  select(_cols, opts) {
    if (opts && opts.count === "exact") this.wantCount = true;
    return this;
  }
  eq(col, val) {
    this.filters.push([col, val]);
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }
  _matched() {
    return this.rows.filter((r) => this.filters.every(([col, val]) => r[col] === val));
  }
  then(resolve, reject) {
    try {
      const matched = this._matched();
      if (this.mode === "single") {
        resolve(matched.length ? { data: matched[0], error: null } : { data: null, error: { message: "not found" } });
      } else if (this.mode === "maybeSingle") {
        resolve({ data: matched[0] || null, error: null });
      } else {
        resolve({ data: matched, error: null, count: this.wantCount ? matched.length : undefined });
      }
    } catch (e) {
      reject(e);
    }
  }
}

/* seed: { coupons: [...], orders: [...], ... } — 테이블별 초기 행. 얕은 복사해서 테스트끼리 서로
   상태를 공유하지 않게 한다. */
function createFakeSupabase(seed = {}) {
  const store = {};
  Object.keys(seed).forEach((table) => {
    store[table] = seed[table].map((row) => ({ ...row }));
  });
  return {
    from(table) {
      if (!store[table]) store[table] = [];
      return new FakeQuery(store[table]);
    },
  };
}

module.exports = { createFakeSupabase };
