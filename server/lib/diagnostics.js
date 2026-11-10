/* ---------- 진단 리포트 (2026-11-09) ----------
   Works "정보" 탭의 "진단 리포트 복사" 버튼이 쓴다. 운영 점검·최근 시스템 오류·결제 이상·멈춘 주문 같은
   "지금 무슨 문제가 있나"를 한 덩어리 텍스트로 만들어, 복사해서 Claude나 다른 AI에게 그대로 붙여넣을 수 있게 한다.
   외부 AI에 붙여넣는 글이라 이메일·전화번호·토큰·웹훅 주소·긴 비밀값은 전부 가린다(maskText). 읽기만 하고 아무것도 바꾸지 않는다. */
const { supabaseAdmin } = require("./supabase");
const { runOpsCheck } = require("./opsCheck");

const SYSTEM_ERROR_LIMIT = 30;
const PAYMENT_ISSUE_LIMIT = 15;
const STUCK_PENDING_HOURS = 48;
const STUCK_PAID_DAYS = 3;
const MAX_DETAIL_CHARS = 600;

/* 외부 AI에 보내도 되는 글로 만든다 — 순서가 중요하다(URL → 이메일 → 전화 → 긴 토큰). */
function maskText(input) {
  return String(input ?? "")
    .replace(/https?:\/\/[^\s"')]+/gi, (u) => {
      try { return `${new URL(u).origin}/…`; } catch (e) { return "[url]"; }
    })
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\b\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, "[phone]")
    .replace(/\b[A-Za-z0-9_\-]{32,}\b/g, "[secret]");
}

function detailText(detail) {
  if (detail == null) return "";
  const raw = typeof detail === "string" ? detail : JSON.stringify(detail);
  return maskText(raw).slice(0, MAX_DETAIL_CHARS);
}

const kst = (iso) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16) + " KST" : "-");

async function safe(fn, fallback) {
  try { return await fn(); } catch (e) { return fallback; }
}

async function buildDiagnosticReport({ db = supabaseAdmin, env = process.env, now = new Date() } = {}) {
  const lines = [];
  const add = (s = "") => lines.push(s);
  const section = (title) => { add(); add(`## ${title}`); };

  add("# REITEN 진단 리포트");
  add(`생성: ${kst(now.toISOString())} · 서버 가동 ${Math.round(process.uptime() / 60)}분 · Node ${process.version}`);
  const commit = String(env.RENDER_GIT_COMMIT || "").slice(0, 7);
  add(`배포 커밋: ${commit || "(알 수 없음)"} · 환경: ${env.NODE_ENV || "-"}`);
  add("※ 이메일·전화번호·주소(URL)·긴 비밀값은 자동으로 가렸습니다.");

  const ops = await safe(() => runOpsCheck({ db, env, now }), null);
  section("운영 점검");
  if (!ops) add("(점검 실패)");
  else {
    add(`오류 ${ops.errors}건 · 경고 ${ops.warnings}건`);
    ops.checks.forEach((c) => add(`- [${c.level}] ${maskText(c.label)}`));
  }

  const { data: errs } = await safe(() => db.from("system_error_log").select("type, detail, resolved, created_at").order("created_at", { ascending: false }).limit(SYSTEM_ERROR_LIMIT), { data: null });
  section(`최근 시스템 오류 (최대 ${SYSTEM_ERROR_LIMIT}건)`);
  if (!errs || !errs.length) add("없음");
  else {
    const open = errs.filter((e) => !e.resolved).length;
    add(`미해결 ${open}건 / 표시 ${errs.length}건`);
    errs.forEach((e) => add(`- ${kst(e.created_at)} [${e.resolved ? "해결됨" : "미해결"}] ${e.type} ${detailText(e.detail)}`));
  }

  const { data: pays } = await safe(() => db.from("payment_log").select("status, amount, method, reason, created_at").neq("status", "paid").order("created_at", { ascending: false }).limit(PAYMENT_ISSUE_LIMIT), { data: null });
  section(`최근 결제 이상 (실패·금액불일치·오류, 최대 ${PAYMENT_ISSUE_LIMIT}건)`);
  if (!pays || !pays.length) add("없음");
  else pays.forEach((p) => add(`- ${kst(p.created_at)} ${p.status} ${p.method || ""} ${p.amount ?? ""}원 ${maskText(p.reason || "")}`.trim()));

  const pendingCut = new Date(now.getTime() - STUCK_PENDING_HOURS * 3600 * 1000).toISOString();
  const paidCut = new Date(now.getTime() - STUCK_PAID_DAYS * 24 * 3600 * 1000).toISOString();
  const count = async (build) => {
    const { count: n, error } = await build(db.from("orders").select("order_no", { count: "exact", head: true }));
    return error ? "조회 실패" : n || 0;
  };
  section("멈춘 것으로 보이는 주문");
  add(`- 입금대기 ${STUCK_PENDING_HOURS}시간 넘음: ${await count((q) => q.eq("status", "입금대기").lt("created_at", pendingCut))}건`);
  add(`- 입금확인 후 ${STUCK_PAID_DAYS}일 넘게 미출고: ${await count((q) => q.eq("status", "입금확인").lt("created_at", paidCut))}건`);
  const { count: openReturns, error: rErr } = await safe(() => db.from("return_requests").select("id", { count: "exact", head: true }).not("status", "in", "(완료,반려)"), { count: null, error: true });
  add(`- 처리 안 된 반품·교환·취소 신청: ${rErr ? "조회 실패" : openReturns || 0}건`);

  section("AI에게 이렇게 물어보세요");
  add("위 리포트를 보고 ① 지금 고객에게 영향을 주는 문제 ② 원인 후보 ③ 고쳐야 할 순서를 알려 주세요.");
  return lines.join("\n");
}

/* 에이전트(피클)용 구조화 진단(2026-11-09, routes/botDiagnostics.js) — 같은 원칙(읽기 전용·마스킹)으로 JSON을 만든다.
   오류는 종류별로 묶어 횟수·첫 발생·마지막 발생·최근 내용 1건만 준다(원문 전체를 넘기지 않음). */
async function collectDiagnostics({ db = supabaseAdmin, env = process.env, now = new Date() } = {}) {
  const ops = await safe(() => runOpsCheck({ db, env, now }), null);
  const since = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: errs } = await safe(
    () => db.from("system_error_log").select("type, detail, resolved, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
    { data: null }
  );
  const groups = new Map();
  for (const e of errs || []) {
    const g = groups.get(e.type) || { type: e.type, count: 0, unresolved: 0, firstAt: e.created_at, lastAt: e.created_at, latestDetail: detailText(e.detail) };
    g.count++;
    if (!e.resolved) g.unresolved++;
    if (e.created_at < g.firstAt) g.firstAt = e.created_at;
    groups.set(e.type, g);
  }
  const { data: pays } = await safe(
    () => db.from("payment_log").select("status, method, reason, created_at").neq("status", "paid").gte("created_at", since).order("created_at", { ascending: false }).limit(50),
    { data: null }
  );
  const pendingCut = new Date(now.getTime() - STUCK_PENDING_HOURS * 3600 * 1000).toISOString();
  const paidCut = new Date(now.getTime() - STUCK_PAID_DAYS * 24 * 3600 * 1000).toISOString();
  const countOrders = async (build) => {
    const { count: n, error } = await safe(() => build(db.from("orders").select("order_no", { count: "exact", head: true })), { error: true });
    return error ? null : n || 0;
  };
  const { count: openReturns, error: rErr } = await safe(
    () => db.from("return_requests").select("id", { count: "exact", head: true }).not("status", "in", "(완료,반려)"),
    { count: null, error: true }
  );
  const { count: newOrders24h, error: nErr } = await safe(
    () => db.from("orders").select("order_no", { count: "exact", head: true }).gte("created_at", new Date(now.getTime() - 24 * 3600 * 1000).toISOString()),
    { count: null, error: true }
  );
  return {
    generatedAt: now.toISOString(),
    deploy: { commit: String(env.RENDER_GIT_COMMIT || "") || null, uptimeMinutes: Math.round(process.uptime() / 60), node: process.version },
    ops: ops ? { errors: ops.errors, warnings: ops.warnings, checks: ops.checks.map((c) => ({ level: c.level, key: c.key, label: maskText(c.label) })) } : null,
    systemErrors7d: [...groups.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)),
    paymentIssues7d: (pays || []).map((p) => ({ at: p.created_at, status: p.status, method: p.method || null, reason: maskText(p.reason || "").slice(0, 300) })),
    orders: {
      new24h: nErr ? null : newOrders24h || 0,
      pendingOver48h: await countOrders((q) => q.eq("status", "입금대기").lt("created_at", pendingCut)),
      paidNotShippedOver3d: await countOrders((q) => q.eq("status", "입금확인").lt("created_at", paidCut)),
      openReturnRequests: rErr ? null : openReturns || 0,
    },
  };
}

module.exports = { buildDiagnosticReport, collectDiagnostics, maskText };
