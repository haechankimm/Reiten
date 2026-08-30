/* 재고 관련 순수 계산 로직 — Supabase 조회 자체는 server.js에 남기고, "조회한 데이터로 뭘
   판단하는지"만 여기로 뽑아서 테스트하기 쉽게 만든다. */

/* 반품/자동취소/관리자취소 3곳에서 똑같이 반복되던 "주문 items에서 재고 복원용 페이로드
   뽑기" 로직 — 참(charm-*)은 재고 관리 대상이 아니라 제외하고, productId·size가 없는
   항목(이 패턴이 생기기 전의 옛 주문)도 복원할 수 없으니 제외한다. */
function restoreItemsFromOrder(items) {
  return (items || [])
    .filter((it) => it.productId && it.size && !String(it.productId).startsWith("charm-"))
    .map((it) => ({ productId: it.productId, color: it.color || "", size: it.size, qty: it.qty }));
}

/* checkRestockNeeded()의 핵심 판단 로직 — 재고 변동 이력(최신순)을 거꾸로 훑어 재고가 마지막
   으로 0 이하로 떨어진 시점을 역산한다. logs가 비어있으면(이력 자체가 없음) null(판단 불가). */
function findOutOfStockSinceFromLogs(logs, currentQty) {
  if (!logs || !logs.length) return null;
  let running = currentQty;
  for (const log of logs) {
    const before = running - log.delta;
    if (before > 0) return log.created_at; // 이 변동으로 재고가 0 이하로 떨어짐 — 그 시점이 "since"
    running = before;
  }
  return logs[logs.length - 1].created_at; // 조회한 이력 전체 기간 동안 계속 품절
}

module.exports = { restoreItemsFromOrder, findOutOfStockSinceFromLogs };
