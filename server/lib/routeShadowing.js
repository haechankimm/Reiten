/* 라우트 등록 순서 검사 — server.js에서 분리(2026-11-09, 동작 변경 없음). */

/* ---------- 라우트 등록 순서 검사 (재발 방지) ----------
   2026-09-01 코드 감사에서 발견된 버그 — Express는 라우트를 등록 순서대로 매칭하는데,
   `PATCH /api/admin/products/:id`처럼 파라미터가 있는 라우트가 `PATCH .../bulk-active`
   같은 리터럴 경로보다 먼저 등록되면 ":id"가 그 문자열 자체를 파라미터 값으로 오인해
   가로채 버린다. 이번에 세 곳(상품·주문·리뷰 일괄 처리)을 사람이 직접 찾아 고쳤지만,
   "주석으로 기억하기"에만 의존하면 다음에 새 라우트를 추가하는 세션이 또 똑같이 실수할 수
   있다 — 그래서 서버가 뜰 때마다 실제 등록된 모든 라우트(중첩된 라우터 포함)를 검사해서,
   이런 충돌이 하나라도 있으면 기동 자체를 막는다. 로컬에서 `npm start`만 해도 바로 드러나고,
   Render 배포도 크래시로 실패하니 "배포된 채로 몇 주간 조용히 죽어있던" 사고가 구조적으로
   불가능해진다. */
function assertNoRouteShadowing(expressApp) {
  const entries = [];
  let order = 0;

  function walk(stack) {
    for (const layer of stack) {
      if (layer.route) {
        const routePath = layer.route.path;
        const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
        const segments = String(routePath).split("/").filter(Boolean);
        for (const method of methods) entries.push({ method, segments, order: order++, path: routePath });
      } else if (layer.name === "router" && layer.handle && layer.handle.stack) {
        walk(layer.handle.stack);
      }
    }
  }
  walk(expressApp._router.stack);

  // earlier(파라미터 포함)가 later(전부 리터럴)와 세그먼트 개수가 같고, 파라미터 자리를 뺀
  // 나머지 리터럴 세그먼트가 전부 일치하면 later를 완전히 가릴 수 있다는 뜻이다.
  function paramShadowsLiteral(paramSegments, literalSegments) {
    if (paramSegments.length !== literalSegments.length) return false;
    for (let i = 0; i < paramSegments.length; i++) {
      const p = paramSegments[i];
      if (p.startsWith(":")) continue;
      if (p !== literalSegments[i]) return false;
    }
    return true;
  }

  const byMethod = new Map();
  for (const e of entries) {
    if (!byMethod.has(e.method)) byMethod.set(e.method, []);
    byMethod.get(e.method).push(e);
  }

  const problems = [];
  for (const list of byMethod.values()) {
    for (const earlier of list) {
      if (!earlier.segments.some((s) => s.startsWith(":"))) continue; // 파라미터가 없으면 아무것도 못 가림
      for (const later of list) {
        if (later.order <= earlier.order) continue;
        const laterIsLiteral = later.segments.every((s) => !s.startsWith(":"));
        if (laterIsLiteral && paramShadowsLiteral(earlier.segments, later.segments)) {
          problems.push(`${earlier.method.toUpperCase()} ${earlier.path} (먼저 등록됨)이 ${later.method.toUpperCase()} ${later.path} (나중에 등록됨)를 가립니다`);
        }
      }
    }
  }

  if (problems.length) {
    throw new Error("라우트 등록 순서 충돌 발견 — 리터럴 경로는 반드시 :param 라우트보다 먼저 등록해야 합니다:\n" + problems.join("\n"));
  }
}

module.exports = { assertNoRouteShadowing };
