-- REITEN — 가상계좌 결제 마이그레이션
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--
-- 가상계좌는 카드결제와 달리 결제창을 닫는 순간 돈이 들어오는 게 아니라, 고객 전용 계좌번호가
-- 발급되고(이 시점 status: VIRTUAL_ACCOUNT_ISSUED) 고객이 그 계좌로 실제 입금해야 결제가
-- 끝난다(status: PAID, 포트원이 Transaction.Paid 웹훅으로 알려줌 — 무통장입금과 달리 관리자가
-- 수동으로 "입금확인"을 누를 필요 없이 자동으로 감지된다). 발급된 계좌 정보를 고객 화면·
-- 이메일에 보여주기 위해 orders에 컬럼을 추가한다.
--
-- ⚠️ 코드 준비는 이 마이그레이션만으로 끝나지만, 실제로 켜려면 포트원(PG사) 콘솔에서 가상계좌
-- 결제수단 자체를 별도로 심사·승인받아야 한다(README 참고) — 그 전까지는 서버 환경변수
-- PORTONE_VIRTUAL_ACCOUNT_BANK가 없어 결제수단 자체가 화면에 노출되지 않는다.

alter table orders add column if not exists virtual_account_bank text;
alter table orders add column if not exists virtual_account_number text;
alter table orders add column if not exists virtual_account_holder text;
alter table orders add column if not exists virtual_account_due_at timestamptz;

-- 가상계좌 결제는 실제 입금 확인이 웹훅으로만 온다(브라우저 요청이 아님) — 그 순간엔 "누가
-- 로그인해서 이 결제를 시작했는지"를 알 방법이 pending_payments에 미리 저장해둔 값뿐이다
-- (카드결제는 결제 확인 요청(/api/order)의 그 순간 로그인 세션에서 받아옴, 다른 경로).
-- 이 컬럼이 생긴 김에 카드결제 웹훅 경로(프론트가 먼저 안 오고 웹훅이 먼저 온 경우)도
-- 같이 개선해 회원 주문이 비회원으로 떨어지지 않게 한다(server.js 참고).
alter table pending_payments add column if not exists user_id uuid references auth.users(id);
