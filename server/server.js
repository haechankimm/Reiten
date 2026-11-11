require("dotenv").config();

const Sentry = require("@sentry/node");
const path = require("path");
const express = require("express");
require("./lib/asyncErrors");
const helmet = require("helmet");
const compression = require("compression");

const { apiLimiter } = require("./lib/rateLimiters");

/* 라우트는 기능별 Express Router(routes/*.js)로 나뉘어 있고, 이 파일은 공통 미들웨어와 마운트 순서만 정한다.
   마운트 순서가 곧 매칭 순서라 바꿀 때는 lib/routeShadowing.js 검사와 README 0번 "구조" 항목을 참고할 것. */
const settingsRoutes = require("./routes/settings");
const lookbookRoutes = require("./routes/lookbook");
const colorsRoutes = require("./routes/colors");
const qnaRoutes = require("./routes/qna");
const healthRoutes = require("./routes/health");
const adminsRoutes = require("./routes/admins");
const membersRoutes = require("./routes/members");
const dashboardRoutes = require("./routes/dashboard");
const productsRoutes = require("./routes/products");
const reviewsRoutes = require("./routes/reviews");
const restockRoutes = require("./routes/restock");
const pushRoutes = require("./routes/push");
const paymentsRoutes = require("./routes/payments");
const noticesRoutes = require("./routes/notices");
const outboxRoutes = require("./routes/outbox");
const handoffNotesRoutes = require("./routes/handoffNotes");
const calendarRoutes = require("./routes/calendar");
const usageLogRoutes = require("./routes/usageLog");
const staffRoutes = require("./routes/staff");
const alertsRoutes = require("./routes/alerts");
const accountRoutes = require("./routes/account");
const refundsRoutes = require("./routes/refunds");
const returnsRoutes = require("./routes/returns");
const reportsRoutes = require("./routes/reports");
/* 2026-11-09 구조 정리: 결제·주문·재고·쿠폰처럼 돈이 걸린 라우트까지 routes/*.js로 옮겼다(동작 변경 없음, 마운트 순서 그대로). */
const paymentWebhookRoutes = require("./routes/paymentWebhook");
const seoRoutes = require("./routes/seo");
const checkoutRoutes = require("./routes/checkout");
const adminLoginRoutes = require("./routes/adminLogin");
const customerOrdersRoutes = require("./routes/customerOrders");
const auditLogRoutes = require("./routes/auditLog");
const adminNotificationsRoutes = require("./routes/adminNotifications");
const adminOrdersRoutes = require("./routes/adminOrders");
const inventoryRoutes = require("./routes/inventory");
const couponsRoutes = require("./routes/coupons");
const clientErrorsRoutes = require("./routes/clientErrors");
const botDiagnosticsRoutes = require("./routes/botDiagnostics");
const supplierShipmentsRoutes = require("./routes/supplierShipments");
const supplierInvoicesRoutes = require("./routes/supplierInvoices");
const botAssistRoutes = require("./routes/botAssist");
const expensesRoutes = require("./routes/expenses");
const agentActionsRoutes = require("./routes/agentActions");
const { assertNoRouteShadowing } = require("./lib/routeShadowing");
const { htmlWithVersions, immutableAssets } = require("./lib/assetVersion");

const { adminGuard } = require("./lib/adminGuard");
const { staticGuard } = require("./lib/staticGuard");

/* SENTRY_DSN이 없으면 아무 것도 하지 않고 조용히 건너뛴다(로컬 개발 환경 포함) —
   README 02번 "에러를 관리자가 아니라 고객이 먼저 발견하는 구조"를 메우기 위한 최소 계측. */
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0 });
}
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
  Sentry.captureException(err);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  Sentry.captureException(err);
});

const PORT = process.env.PORT || 3000;
const SITE_DIR = path.join(__dirname, "..", "소스 코드");
const WORKS_DIR = path.join(__dirname, "..", "works");
const siteHtml = htmlWithVersions([SITE_DIR]);
const siteAssets = immutableAssets([SITE_DIR]);
const worksHtml = htmlWithVersions([WORKS_DIR, SITE_DIR]);
const worksAssets = immutableAssets([WORKS_DIR, SITE_DIR]);

const app = express();

/* Render/Railway 등은 자체 프록시를 한 단계 거쳐 요청을 전달한다.
   이 설정이 없으면 express-rate-limit이 모든 방문자를 프록시의 IP 하나로 착각해
   한 명이 많이 요청하면 전체 방문자가 같이 차단될 수 있다. 로컬 직접 실행 시에는 영향 없음. */
app.set("trust proxy", 1);

// gzip 압축 — i18n.js(125KB)·style.css·app.js가 압축 없이 나가던 것을 약 1/4로 줄인다
app.use(compression());

/* CSP — 빌드 도구 없는 정적 사이트라 인라인 <script>/<style>에 크게 의존하므로 'unsafe-inline'을
   허용한다(nonce 기반으로 바꾸려면 전 페이지에 빌드 단계가 필요해져 지금 구조와 안 맞음).
   완벽한 XSS 차단은 아니지만, 그래도 아래 두 가지는 확실히 막는다: ① 스크립트가 주입되더라도
   여기 허용목록에 없는 임의의 외부 도메인으로 데이터를 빼돌리는 것(connect-src/img-src) ②
   <object>/<embed> 삽입. 실제 쓰는 외부 도메인만 최소로 나열 — GA4(googletagmanager/
   google-analytics), 채널톡(channel.io), 포트원 결제 SDK(portone.io), Pretendard 폰트
   (jsDelivr), 다음 우편번호 검색(daumcdn), Cloudinary(상품 사진), Supabase(로그인·API).
   카카오 로그인(Supabase OAuth 리다이렉트)·포트원 카드 인증 팝업은 전부 새 창/최상위 이동이라
   CSP 대상이 아님. */
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://www.googletagmanager.com",
          "https://cdn.channel.io",
          "https://cdn.portone.io",
          "https://cdn.jsdelivr.net",
          "https://t1.daumcdn.net",
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdn.channel.io"],
        fontSrc: ["'self'", "data:", "https://cdn.jsdelivr.net", "https://cdn.channel.io"],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://res.cloudinary.com",
          "https://www.google-analytics.com",
          "https://*.google-analytics.com",
          "https://*.channel.io",
          "https://*.kakaocdn.net",
        ],
        connectSrc: [
          "'self'",
          "https://*.supabase.co",
          "wss://*.supabase.co",
          "https://www.google-analytics.com",
          "https://*.google-analytics.com",
          "https://*.analytics.google.com",
          "https://*.channel.io",
          "wss://*.channel.io",
          "https://*.portone.io",
          "https://t1.daumcdn.net",
        ],
        frameSrc: ["https://*.channel.io"],
        mediaSrc: ["'self'", "https://*.channel.io", "https://res.cloudinary.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  })
);

// 전체 API 남용 방지 (기본): IP당 15분에 1000회 — 용도별 세부 한도는 lib/rateLimiters.js
app.use("/api/", apiLimiter);

// 용도별 limiter(주문·조회·쿠폰·글쓰기·계정)는 lib/rateLimiters.js에서 가져온다 —
// routes/qna.js 등 분리된 라우트 파일과 반드시 같은 인스턴스를 써야 카운터가 안 나뉜다.

app.use(paymentWebhookRoutes);

app.use(express.json());

/* 모든 /api/admin/* 요청의 관문 — 로그인·관리자 확인, PIN(2단계), 직원별 영역 권한(lib/adminGuard.js) */
app.use("/api/admin", adminGuard);

/* 정적 폴더 안의 내부 문서(README.md·사용설명서.md 등)는 웹으로 내보내지 않는다 — 아래 두 static
   핸들러(works/, 소스 코드/)보다 반드시 먼저 걸려야 한다(lib/staticGuard.js 참고). */
app.use(staticGuard(path.join(SITE_DIR, "404.html")));

/* works.reiten.kr로 들어온 요청은 관리자 전용 정적 사이트(works/)를 먼저 찾는다.
   express.static은 파일을 못 찾으면 그냥 next()로 넘어가므로, works/에 없는 assets/*
   요청은 아래의 SITE_DIR static으로 자연스럽게 이어져 이미지·CSS·공용 JS를 공유한다
   (사이트별로 중복 보관하지 않음). API·인증·DB는 완전히 동일한 이 서버 인스턴스를 쓴다.
   works.localhost는 로컬 개발 전용 별칭이다(.localhost는 브라우저가 별도 설정 없이 항상
   127.0.0.1로 처리하는 예약 도메인이라 실제 인터넷에서는 접근 자체가 불가능함) — 예전엔
   `/__works-preview`라는 별도 경로로 로컬 미리보기를 우회했었는데, 그 경로는 프로덕션에서도
   인증 없이 그대로 열려 있어(works.reiten.kr 분기와 무관하게 항상 마운트돼 있었음) 관리자
   패널 화면이 누구에게나 노출되는 불필요한 표면이었다(실제 데이터 API는 여전히 requireAdmin이
   막지만, UI 셸 자체가 열리는 것만으로도 줄일 수 있는 노출). 2026-09-01, 이 분기 하나로 통합해
   프로덕션 노출은 없애고 로컬에서는 실제 호스트네임 분기 로직을 그대로 검증하도록 정리함
   (http://works.localhost:3000 으로 접속하면 됨). */
app.use((req, res, next) => {
  if (req.hostname === "works.reiten.kr" || req.hostname === "works.localhost") {
    // HTML은 CSS·JS 주소에 내용 지문(?v=)을 붙여 보내고, 지문 붙은 파일은 1년 캐시(lib/assetVersion.js, 2026-11-09)
    return worksHtml(req, res, () => worksAssets(req, res, () => express.static(WORKS_DIR)(req, res, next)));
  }
  next();
});

app.use(seoRoutes);

/* 고객 사이트 HTML·지문 붙은 CSS/JS(lib/assetVersion.js, 2026-11-09) — 아래 express.static보다 먼저 */
app.use(siteAssets);
app.use(siteHtml);

app.use(
  express.static(SITE_DIR, {
    setHeaders: (res, filePath) => {
      // 제품 사진은 파일명이 안 바뀌므로 7일 캐시. 지문(?v=) 없이 온 CSS/JS·HTML은 매번 확인(지문 붙은 것은 위 siteAssets가 1년 캐시).
      if (filePath.includes(`${path.sep}img${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=604800, immutable");
      }
    },
  })
);

app.use(checkoutRoutes);
/* 화면(브라우저) 자바스크립트 오류 보고 — Sentry·서버 로그로(2026-11-09) */
app.use(clientErrorsRoutes);
/* AI 비서 에이전트 전용 읽기 전용 진단(X-REITEN-BOT-KEY, 2026-11-09) */
app.use(botDiagnosticsRoutes);
/* 공급처 출고 송장 — 에이전트 기록(POST /api/bot/…) + Works 재고 탭 목록(2026-11-10, 마이그레이션 048) */
app.use(supplierShipmentsRoutes);
/* 매입 장부(피클 기록 + Works 확인)·피클 브리핑·문의 답변 초안(2026-11-10, 마이그레이션 050) */
app.use(supplierInvoicesRoutes);
app.use(botAssistRoutes);
/* 지출 장부·동업자 정산·정기 지출·예산·상품 마진(2026-11-11, 마이그레이션 052) */
app.use(expensesRoutes);
/* AI 승인함 — AI 제안 → 사람 승인 → 서버가 승인자 신분으로 실행(2026-11-11, 마이그레이션 054) */
app.use(agentActionsRoutes);

/* GET /health는 routes/health.js에서 가져온다 — UptimeRobot이 DB 연결까지 확인할 수 있는
   전용 엔드포인트(2026-09-01 추가, 위 0번 섹션 참고). */
app.use(healthRoutes);

app.use(adminLoginRoutes);

app.use(customerOrdersRoutes);

/* logAdminAction·logInventoryChange·logSystemError는 lib/adminLog.js로,
   applyKstDateRangeFilter는 lib/kst.js로 옮겨서 위 import에서 가져온다 — 여러 라우트 파일이
   공유하는 로그·필터 헬퍼라 한 곳에 있어야 한다(2026-09-01, 코드 크기 정리 1단계). */

app.use(auditLogRoutes);

/* 관리자 대시보드(GET /api/admin/dashboard·/dashboard/export, GA4 방문자 통계 /api/admin/analytics) —
   돈이 오가는 라우트가 아니라 읽기 전용 집계라 routes/dashboard.js로 분리했다(2026-09-01,
   라우트 분리 다음 라운드). computeDashboardStats도 그 파일로 함께 옮겼다. */
app.use(dashboardRoutes);

app.use(adminNotificationsRoutes);

/* 관리자 계정 관리(GET/POST /api/admin/admins, DELETE /api/admin/admins/:id) — 돈·재고를
   건드리지 않는 순수 CRUD라 routes/admins.js로 분리했다(2026-09-01, 라우트 분리 다음 라운드). */
app.use(adminsRoutes);
app.use(staffRoutes);
app.use(alertsRoutes);
app.use(accountRoutes);
/* 부분 반품·부분 취소 환불, 교환 재발송, 주문별 환불 이력(2026-10-02 — 금액 계산은 lib/refunds.js). */
app.use(refundsRoutes);
/* 정산 리포트 다운로드·재발송, 아침 요약 알림 테스트(2026-10-02) */
app.use(reportsRoutes);

/* 일반 회원 계정 관리(GET /api/admin/members, PATCH .../ban, DELETE) — admins.js와 같은
   이유로 별도 파일로 분리했다(2026-09-01, README "다음 세션이 가장 먼저 할 일" 19번). */
app.use(membersRoutes);

app.use(adminOrdersRoutes);

/* 반품·교환·주문취소 신청 관리자 라우트(목록·상태 저장·재고 복원)는 routes/returns.js로 옮겼다(2026-10-02 —
   유형별 처리 규칙을 테스트할 수 있게). 환불 실행은 routes/refunds.js + lib/refunds.js. */
app.use(returnsRoutes);

app.use(inventoryRoutes);

app.use(couponsRoutes);

/* 상품 관리자 CRUD(GET/POST/PATCH/DELETE·일괄 처리·사진 업로드) — 결제·재고와 얽히지 않는
   부분만 routes/products.js로 분리했다(공개 목록 GET /api/products는 결제 가격 검증이 쓰는
   캐시를 공유해 여기 그대로 둔다 — 2026-09-01, 라우트 분리 다음 라운드). */
app.use(productsRoutes);

/* 색상 팔레트(colors) · 룩북(lookbook) · 정보 탭(settings) 라우트는 routes/*.js로 분리됐다
   (2026-09-01) — 돈·재고를 건드리지 않는 순수 CRUD라 여기서는 마운트만 한다. */
app.use(colorsRoutes);
app.use(lookbookRoutes);
app.use(settingsRoutes);

/* 상품 리뷰(공개 GET/POST·공감·관리자 GET/PATCH/bulk-approve/DELETE) — 돈이 걸려 있지 않은
   도메인이라 통째로 routes/reviews.js로 분리했다(2026-09-01, 라우트 분리 다음 라운드). */
app.use(reviewsRoutes);

/* 품절 알림 신청 접수(POST /api/restock-subscriptions) — 실제 알림 발송은 routes/inventory.js의
   PATCH /api/admin/inventory/bulk 안에서 처리한다(재고 수량 변화를 아는 곳이 거기뿐이라). */
app.use(restockRoutes);

/* Works 브라우저 푸시 알림 구독 관리(GET public-key, POST/DELETE subscribe) — 실제 발송은
   새 주문 접수 시점(lib/orderFinalize.js·routes/checkout.js)에서 sendPushToAdmins()로 처리한다. */
app.use(pushRoutes);

/* 상품 Q&A + CS 빠른 답변 템플릿 라우트도 routes/qna.js로 분리됐다(2026-09-01) — 돈·재고를
   건드리지 않는 순수 CRUD라 여기서는 마운트만 한다. */
app.use(qnaRoutes);

/* 결제 트랜잭션 로그(조회 전용)·공지 게시판·알림 발송 실패 아웃박스(조회 전용) — 셋 다
   2026-09 신규 기능, 돈이 실제로 오가는 처리는 전혀 없어(트랜잭션 로그·아웃박스는 읽기 전용,
   공지는 순수 텍스트 CRUD) 처음부터 routes/*.js로 분리했다. */
app.use(paymentsRoutes);
app.use(noticesRoutes);
app.use(outboxRoutes);
app.use(handoffNotesRoutes);
app.use(calendarRoutes);
app.use(usageLogRoutes);

require("./lib/scheduledJobs");

assertNoRouteShadowing(app);

/* 404 — /api/*는 JSON, 그 외 페이지 요청은 브랜드 404 페이지 */
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "존재하지 않는 API입니다." });
  res.status(404).sendFile(path.join(SITE_DIR, "404.html"));
});

if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

/* 500 — 처리 안 된 예외는 스택을 고객에게 노출하지 않고 브랜드 오류 페이지(또는 JSON)로 응답 */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // 깨진 JSON·너무 큰 본문은 서버 고장이 아니라 잘못된 요청(400/413)
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "요청 형식이 올바르지 않습니다." });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "요청이 너무 큽니다." });
  console.error("[unhandled]", err);
  if (req.path.startsWith("/api/")) return res.status(500).json({ error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요." });
  res.status(500).sendFile(path.join(SITE_DIR, "500.html"));
});

require("./lib/internalDispatch").setPort(PORT);
app.listen(PORT, () => {
  console.log(`REITEN server running at http://localhost:${PORT}`);
});
