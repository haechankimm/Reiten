/* 주문 단위 순차 처리 — 같은 주문의 환불·취소·재고 복원·상태 변경이 동시에 들어오면(더블클릭, 두 관리자가 동시에 처리)
   둘 다 "이전 환불 기록"을 같은 값으로 읽고 각자 환불·재고 복원을 해서 두 번 나갔다(2026-10-28 정기 감사, 실행 테스트로 재현:
   같은 반품 환불 두 번, 재고가 주문 수량보다 많이 복원). 한 번에 하나씩 처리한다 — 서버 안에서는 메모리 줄,
   서버가 여러 대면 app_locks 표(lib/dbLock.js, 마이그레이션 045)로 서버끼리도 줄을 세운다(2026-11-09). */
const { withLock, LockBusyError } = require("./dbLock");

async function withOrderLock(orderNo, fn) {
  return withLock(`order:${String(orderNo || "")}`, fn);
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
    try {
      return await withOrderLock(key, () => handler(req, res, next));
    } catch (e) {
      // 다른 서버가 30초 넘게 같은 주문을 처리 중 — 실패로 숨기지 않고 다시 시도하라고 알린다
      if (e instanceof LockBusyError && !res.headersSent) return res.status(409).json({ error: e.message, code: e.code });
      throw e;
    }
  };
}

module.exports = { withOrderLock, serializeByOrder };
