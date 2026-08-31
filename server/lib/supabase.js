const { createClient } = require("@supabase/supabase-js");

/* SUPABASE_URL=fake로 설정하면 실제 네트워크 없이 test-helpers/fakeSupabase.js를 대신 쓴다 —
   server.js와 routes/*.js 전부 이 모듈 하나에서 supabaseAdmin을 가져다 쓰므로, 여기만 바꾸면
   라우트 코드를 한 줄도 안 고치고 통합 테스트(server/test/routes.*.test.js)가 가능해진다. */
let supabaseAdmin;
if (process.env.SUPABASE_URL === "fake") {
  supabaseAdmin = require("../test-helpers/fakeSupabase").createFakeSupabase();
} else {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다. server/.env.example을 복사해 server/.env를 채워주세요."
    );
  }
  // service role key는 RLS를 우회한다 — 절대 브라우저로 내려보내지 말 것.
  supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

module.exports = { supabaseAdmin };
