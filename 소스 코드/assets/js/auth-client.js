/* 회원 로그인 세션을 페이지 간에 공유하기 위한 공용 헬퍼.
   server/가 꺼져 있거나 Supabase가 설정되지 않았으면(=/api/config 실패) 전부 null을 반환하며 조용히 비활성화된다. */

let _reitenSupabasePromise = null;

function loadSupabaseSdk() {
  return new Promise((resolve, reject) => {
    if (window.supabase && window.supabase.createClient) return resolve(window.supabase);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
    s.onload = () => resolve(window.supabase);
    s.onerror = () => reject(new Error("supabase-js 로드 실패"));
    document.head.appendChild(s);
  });
}

async function getSupabaseClient() {
  if (!_reitenSupabasePromise) {
    _reitenSupabasePromise = (async () => {
      try {
        const res = await fetch("/api/config");
        if (!res.ok) return null;
        const { supabaseUrl, supabaseAnonKey } = await res.json();
        if (!supabaseUrl || !supabaseAnonKey) return null;
        const sdk = await loadSupabaseSdk();
        return sdk.createClient(supabaseUrl, supabaseAnonKey);
      } catch (e) {
        return null;
      }
    })();
  }
  return _reitenSupabasePromise;
}

/* 로그인 세션은 기본적으로 localStorage에 저장되어 브라우저를 껐다 켜도 유지되고,
   supabase-js가 백그라운드 타이머로 만료 전에 자동 갱신한다. 다만 브라우저가 비활성
   탭의 타이머를 늦추면(백그라운드 throttling) 그 자동 갱신이 늦게 돌아 잠깐 만료된
   토큰이 쓰일 수 있다 — 그래서 세션을 쓰기 직전에 한 번 더 만료 여부를 확인해 필요하면
   즉시 갱신한다. getAccessToken/getCurrentProfile이 공통으로 이 헬퍼를 거친다. */
async function getFreshSession(client) {
  const { data } = await client.auth.getSession();
  let session = data && data.session;
  if (!session) return null;

  const expiresInMs = (session.expires_at || 0) * 1000 - Date.now();
  if (expiresInMs < 60_000) {
    const { data: refreshed } = await client.auth.refreshSession();
    if (refreshed && refreshed.session) session = refreshed.session;
  }
  return session;
}

async function getAccessToken() {
  const client = await getSupabaseClient();
  if (!client) return null;
  const session = await getFreshSession(client);
  return session ? session.access_token : null;
}

/* 로그인 상태면 { id, email, name, role }, 아니면 null */
async function getCurrentProfile() {
  const client = await getSupabaseClient();
  if (!client) return null;
  const session = await getFreshSession(client);
  if (!session) return null;

  const { data: profile } = await client
    .from("profiles")
    .select("id,name,role")
    .eq("id", session.user.id)
    .single();

  return {
    id: session.user.id,
    email: session.user.email,
    name: (profile && profile.name) || "",
    role: (profile && profile.role) || "customer",
  };
}
