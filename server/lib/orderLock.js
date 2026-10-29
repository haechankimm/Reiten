/* 주문 단위 순차 처리 — 같은 주문의 환불·취소·재고 복원·상태 변경이 동시에 들어오면(더블클릭, 두 관리자가 동시에 처리)
   둘 다 "이전 환불 기록"을 같은 값으로 읽고 각자 환불·재고 복원을 해서 두 번 나갔다(2026-10-28 정기 감사, 실행 테스트로 재현:
   같은 반품 환불 두 번, 재고가 주문 수량보다 많이 복원). 서버는 한 대(Render 단일 인스턴스)라 프로세스 안 잠금으로
   한 번에 하나씩 처리한다 — 결제 확정의 withPaymentLock(server.js)과 같은 방식. */
const locks = new Map();

async function withOrderLock(orderNo, fn) {
  const key = String(orderNo || "");
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((r) => (release = r));
  const chain = prev.then(() => mine);
  locks.set(key, chain);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chain) locks.delete(key);
  }
}

/* Express 핸들러를 주문번호별로 순차 처리하게 감싼다. keyOf(req)가 주문번호(또는 신청 id)를 돌려준다. */
function serializeByOrder(keyOf, handler) {
  return async (req, res, next) => {
    let key;
    try {
      key = await keyOf(req);
    } catch (e) {
      key = null;
    }
    if (!key) return handler(req, res, next);
    return withOrderLock(key, () => handler(req, res, next));
  };
}

module.exports = { withOrderLock, serializeByOrder };
