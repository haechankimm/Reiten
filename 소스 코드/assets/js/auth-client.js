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

async function getAccessToken() {
  const client = await getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data && data.session ? data.session.access_token : null;
}

/* 로그인 상태면 { id, email, name, role }, 아니면 null */
async function getCurrentProfile() {
  const client = await getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  const session = data && data.session;
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
