/* 실제 Supabase 없이 통합 테스트하기 위한 최소 가짜 클라이언트.
   원래는 resolveCoupon(lib/coupons.js)의 조회 패턴만 지원했는데(select/eq/single/maybeSingle),
   2026-09-01에 routes/*.js 통합 테스트(server/test/routes.*.test.js)를 추가하면서
   insert/update/delete/order/range와 auth.getUser까지 넓혔다 — 기존 사용법(coupons.test.js 등)은
   그대로 호환된다(추가만 했지 기존 동작은 안 바꿈).
   진짜 Supabase의 PostgrestFilterBuilder처럼 체이닝 도중 어디서 await해도(그 자체가 thenable)
   결과가 나오게 만들어서, 실제 서버 코드를 고치지 않고도 그대로 테스트에 꽂을 수 있다. */

function genId() {
  return require("crypto").randomUUID();
}

class FakeQuery {
  constructor(store) {
    this.store = store; // 테이블 배열에 대한 참조(직접 push/splice해서 원본에 반영)
    this.filters = [];
    this.wantCount = false;
    this.mode = "many"; // "single" | "maybeSingle" | "many"
    this.op = "select"; // "select" | "insert" | "update" | "delete"
    this.insertRows = null;
    this.updatePatch = null;
    this.orderCol = null;
    this.orderAsc = true;
    this.rangeFrom = null;
    this.rangeTo = null;
  }
  select(_cols, opts) {
    if (opts && opts.count === "exact") this.wantCount = true;
    return this;
  }
  eq(col, val) {
    this.filters.push([col, val]);
    return this;
  }
  /* routes/members.js가 "customer만" 또는 "customer+admin" 중 하나를 한 번의 쿼리로
     고르는 데 쓰는 .in() 대응(2026-09-01) — eq처럼 값 하나가 아니라 배열 중 하나와 맞으면
     매칭시킨다. */
  in(col, values) {
    this.inFilters = this.inFilters || [];
    this.inFilters.push([col, values]);
    return this;
  }
  /* routes/colors.js가 jsonb 배열 컬럼에 특정 값이 들어있는지 확인할 때 쓰는 .contains() 대응
     ("cs" 연산자, value는 JSON 문자열) — 지금은 이 조합 하나만 지원한다. */
  filter(col, op, value) {
    if (op === "cs") {
      const needle = JSON.parse(value);
      this.jsonContainsFilters = this.jsonContainsFilters || [];
      this.jsonContainsFilters.push([col, needle]);
    }
    return this;
  }
  order(col, opts = {}) {
    this.orderCol = col;
    this.orderAsc = opts.ascending !== false;
    return this;
  }
  range(from, to) {
    this.rangeFrom = from;
    this.rangeTo = to;
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
  insert(rows) {
    this.op = "insert";
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch) {
    this.op = "update";
    this.updatePatch = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  _matched() {
    return this.store.filter(
      (r) =>
        this.filters.every(([col, val]) => r[col] === val) &&
        (this.inFilters || []).every(([col, values]) => values.includes(r[col])) &&
        (this.jsonContainsFilters || []).every(([col, needle]) => needle.every((v) => (r[col] || []).includes(v)))
    );
  }
  _execute() {
    if (this.op === "insert") {
      const created = this.insertRows.map((r) => ({ id: genId(), created_at: new Date().toISOString(), ...r }));
      this.store.push(...created);
      return { rows: created };
    }
    if (this.op === "update") {
      const matched = this._matched();
      matched.forEach((row) => Object.assign(row, this.updatePatch));
      return { rows: matched };
    }
    if (this.op === "delete") {
      const matched = this._matched();
      matched.forEach((row) => {
        const i = this.store.indexOf(row);
        if (i >= 0) this.store.splice(i, 1);
      });
      return { rows: matched };
    }
    let rows = this._matched();
    if (this.orderCol) {
      const col = this.orderCol;
      rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0));
      if (!this.orderAsc) rows.reverse();
    }
    const count = rows.length;
    if (this.rangeFrom != null) rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    return { rows, count };
  }
  then(resolve, reject) {
    try {
      const { rows, count } = this._execute();
      if (this.mode === "single") {
        resolve(rows.length ? { data: rows[0], error: null } : { data: null, error: { message: "not found" } });
      } else if (this.mode === "maybeSingle") {
        resolve({ data: rows[0] || null, error: null });
      } else {
        resolve({ data: rows, error: null, count: this.wantCount ? (count ?? rows.length) : undefined });
      }
    } catch (e) {
      reject(e);
    }
  }
}

/* seed: { coupons: [...], orders: [...], profiles: [...], ..., authUsers: [...] } — 테이블별
   초기 행. authUsers는 일반 테이블이 아니라 auth.users를 흉내내는 별도 목록(.from()이 아니라
   .auth.admin.*으로만 접근) — 얕은 복사해서 테스트끼리 서로 상태를 공유하지 않게 한다. */
function createFakeSupabase(seed = {}) {
  let store = {};
  let authUsers = [];
  function reseed(newSeed = {}) {
    store = {};
    Object.keys(newSeed).forEach((table) => {
      if (table === "authUsers") return;
      store[table] = newSeed[table].map((row) => ({ ...row }));
    });
    authUsers = (newSeed.authUsers || []).map((row) => ({ ...row }));
  }
  reseed(seed);

  return {
    from(table) {
      if (!store[table]) store[table] = [];
      return new FakeQuery(store[table]);
    },
    /* requireAuth/requireAdmin(lib/auth.js)이 부르는 실제 Supabase Auth API 흉내 — 진짜 JWT
       검증은 아니고, 테스트 전용 "fake-token:<id>:<email>" 형식 토큰을 그대로 파싱해서 그
       사용자로 인증된 것처럼 만든다. lib/auth.js 코드는 한 줄도 안 고쳐도 된다. */
    auth: {
      async getUser(token) {
        const m = /^fake-token:([^:]+):(.+)$/.exec(token || "");
        if (!m) return { data: { user: null }, error: { message: "invalid token" } };
        return { data: { user: { id: m[1], email: m[2] } }, error: null };
      },
      /* routes/members.js의 "인증 메일 재발송"이 쓰는 auth.resend() 흉내 — 실제 메일은
         당연히 안 보내고, 대상 이메일이 authUsers에 있는지만 확인한다. */
      async resend({ email } = {}) {
        const exists = authUsers.some((u) => (u.email || "").toLowerCase() === String(email || "").toLowerCase());
        if (!exists) return { data: null, error: { message: "user not found" } };
        return { data: {}, error: null };
      },
      /* routes/admins.js·routes/members.js가 쓰는 Admin API 최소 흉내. 실제 Supabase는
         auth.users를 지우면 profiles.id의 on delete cascade가 같이 지워주는데, 그 동작까지
         재현해야 "삭제 전 user_id를 null로 끊어두지 않으면 orders/qna가 문제된다"는 실제
         제약과 같은 조건에서 라우트를 테스트할 수 있다(001_init.sql 참고). */
      admin: {
        async listUsers({ page = 1, perPage = 1000 } = {}) {
          const from = (page - 1) * perPage;
          return { data: { users: authUsers.slice(from, from + perPage) }, error: null };
        },
        async getUserById(id) {
          const u = authUsers.find((x) => x.id === id);
          if (!u) return { data: { user: null }, error: { message: "user not found" } };
          return { data: { user: u }, error: null };
        },
        async updateUserById(id, patch) {
          const u = authUsers.find((x) => x.id === id);
          if (!u) return { data: null, error: { message: "user not found" } };
          if ("ban_duration" in patch) {
            u.banned_until = patch.ban_duration === "none" ? null : new Date(Date.now() + 3e12).toISOString();
          }
          if ("email_confirm" in patch && patch.email_confirm) {
            u.email_confirmed_at = new Date().toISOString();
          }
          return { data: { user: u }, error: null };
        },
        async deleteUser(id) {
          const i = authUsers.findIndex((x) => x.id === id);
          if (i < 0) return { data: null, error: { message: "user not found" } };
          authUsers.splice(i, 1);
          if (store.profiles) store.profiles = store.profiles.filter((p) => p.id !== id);
          return { data: {}, error: null };
        },
        async inviteUserByEmail(email) {
          /* 실제 Supabase는 이미 가입된 이메일을 다시 초대하면 에러를 준다 — routes/admins.js가
             그 에러를 감지해 "관리자로 승격할까요?" 흐름으로 넘기는지 테스트하려면 이 흉내도
             똑같이 거부해야 한다. */
          if (authUsers.some((u) => (u.email || "").toLowerCase() === String(email || "").toLowerCase())) {
            return { data: null, error: { message: "A user with this email address has already been registered", code: "email_exists" } };
          }
          const u = { id: genId(), email, email_confirmed_at: null, last_sign_in_at: null, created_at: new Date().toISOString() };
          authUsers.push(u);
          /* 001_init.sql의 handle_new_user() 트리거 흉내 — auth.users에 새로 생기는 즉시
             profiles 행이 자동으로 하나 생긴다(기본 role='customer'). 이걸 빼먹으면
             routes/admins.js가 뒤이어 하는 profiles.update({role:'admin'})가 매칭되는
             행이 없어 조용히 아무 효과가 없는 채로 "성공"해버린다. */
          if (!store.profiles) store.profiles = [];
          store.profiles.push({ id: u.id, name: "", role: "customer", created_at: u.created_at });
          return { data: { user: u }, error: null };
        },
      },
    },
    /* 테스트 beforeEach에서 매번 깨끗한 상태로 되돌릴 때 쓴다(server/lib/supabase.js가
       SUPABASE_URL=fake일 때 만드는 단일 인스턴스를 여러 테스트 파일이 공유하므로 필요). */
    __reset: reseed,
  };
}

/* 관리자 인증이 필요한 라우트를 테스트할 때 Authorization 헤더에 그대로 넣는 값.
   대응하는 profiles 행({ id, role: "admin" })을 seed에 같이 넣어야 requireAdmin을 통과한다. */
function fakeAdminToken(id, email) {
  return `fake-token:${id}:${email}`;
}

module.exports = { createFakeSupabase, fakeAdminToken };
