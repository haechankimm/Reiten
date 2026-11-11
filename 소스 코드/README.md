# REITEN — AI 인수인계 문서 (현재 상태 · 구조)

> 리플렉티브 프린팅 라이딩 후디 쇼핑몰 `reiten.kr` + 관리자 사이트 Works `works.reiten.kr`. 운영자는 개발자가 아니다(설명은 쉽게, 한국어로).
> **이 문서는 "지금 사실"만 담는다.** 마지막 갱신: 2026-11-11 (main = PR #33 + 문서 재설계 커밋).

## 0. 문서 지도 — 무엇을 언제 읽나

| 문서 | 위치 | 언제 |
|---|---|---|
| `CLAUDE.md` | 저장소 루트 | **규칙.** 세션 시작 시 자동으로 읽힌다. 규칙은 거기에만 있다. |
| `README.md` (이 문서) | `소스 코드/` | **매 세션 시작 시 §1~§2를 읽고**, 코드를 만질 때 §3~§5. |
| `CHANGELOG.md` | `소스 코드/` | **평소엔 열지 않는다.** 아래 경우에만 `grep -n "키워드"`로 찾은 부분만 읽는다: ① 사용자가 과거 작업·결정 이유를 물을 때 ② 코드 주석만으로 "왜 이렇게 했는지" 모를 때 ③ 예전에 고친 버그가 다시 난 것 같을 때 ④ 옛 설정 절차(PG 켜기·도메인 연결 등)를 다시 해야 할 때. **CHANGELOG와 이 문서가 다르면 이 문서가 맞다.** |
| `pickle-handoff.md` | 저장소 루트 | 피클(AI 비서) API·역할을 바꿀 때. 바꾸면 맨 아래 "개정 이력"에 한 줄. |
| `reiten-monitoring-handoff.md` | 저장소 루트 | 피클이 쓴 모니터링 협업 문서(2026-11-10). 참고용. |
| `사용설명서.md` | `소스 코드/` | 운영자(대표·동업자)용 쉬운 설명서. 기능이 바뀌면 코드 용어 없이 갱신. |
| `git log` | — | 정확한 변경 내역. |

> 코드 주석에 나오는 "README 0번 섹션", "다음 세션이 가장 먼저 할 일 N번", "README 가상계좌 결제" 같은 표현은 **2026-11-11 이전 README**를 가리킨다. 그 글은 지금 `CHANGELOG.md` B~F부에 원문 그대로 있다 → `grep -n "가상계좌" "소스 코드/CHANGELOG.md"`처럼 찾는다.

작업을 마치면: 이 문서 §1·§2를 사실대로 고치고, `CHANGELOG.md` A부 맨 위에 기록 한 항목을 추가한다(§ 규칙은 `CLAUDE.md`).

---

## 1. 현재 상태 (2026-11-11 확인)

**코드·배포**
- `main` = PR #33(`7ca7936`)까지 + 이 문서 재설계 커밋. main의 GitHub Actions `test`·`ui`·`health-check` 통과(7ca7936).
- 서버 테스트 **331건 통과**(`cd server && npm test`, 약 4초).
- 마이그레이션 **001~054 전부 실행됨**(029 번호는 없음). **다음 번호 = 055.** Works 정보 탭 "지금 점검하기"가 "최신(054)까지 적용됨"이면 정상.
- 운영 확인(2026-11-11 실측): `/health` 200(`{"ok":true,"db":"ok"}`), `/README.md`·`/사용설명서.md` 404(정상 — `lib/staticGuard.js`), `/ep/naver.tsv` 200.
- **열린 PR = Dependabot 7개(#5~#11, 2026-11-09 생성)** — 처리 방침은 §2-3.
- 이 컴퓨터의 터미널은 GitHub 인증이 없어 `git push`가 실패한다(`gh`도 없음). push는 사용자가 **GitHub Desktop**으로 한다. 클라우드 세션은 직접 PR·머지 가능.

**외부 서비스**

| 서비스 | 상태 |
|---|---|
| GitHub | `haechankimm/Reiten`, 기본 브랜치 `main`. main에 머지 = Render 자동 배포. |
| Render | Web Service `Reiten`, Root Directory `server`, Auto-Deploy On Commit, **무료 플랜**(15분 무활동 시 잠듦 → 런칭 직후 Starter 전환 예정). 자동 배포가 조용히 안 걸린 적 있음 → Events 탭에서 커밋 해시 확인. |
| 도메인 | `reiten.kr`·`www`·`works.reiten.kr` → Render(후이즈 DNS), SSL 자동. |
| Supabase | 무료 플랜(런칭 때 Pro 전환 예정 — 체크리스트 §2-2). 키는 `server/.env`·Render 환경변수에만. |
| Resend(메일) | 해결됨: `RESEND_FROM=REITEN <order@reiten.kr>`, Supabase SMTP도 같은 키. |
| Sentry | 연결됨(서버 오류 + 고객 화면 JS 오류). |
| 결제 | 포트원 V2 + NHN KCP. 카드사 심사 완료. **실결제 테스트(PC·휴대폰·부분취소) 아직.** |
| 배송조회 | 스마트택배 `SWEETTRACKER_API_KEY` **미발급**(런칭 직전 예정). 없으면 배송완료 자동 감지만 꺼짐. |
| 알림 | Works 폰 푸시 동작. 텔레그램 **미연결**(`TELEGRAM_CHAT_ID` 없음). |
| UptimeRobot | 2026-08에 모니터 연결 기록 있음. **`/health` 5분 주기인지는 미확인** — Render가 잠들지 않게 하는 용도라 확인 필요. |
| GA4·채널톡·네이버 서치어드바이저 | 연결됨. 네이버쇼핑 EP 등록은 아직. |

**사람**: 마스터 관리자 `haechankimm@gmail.com`(`lib/auth.js` `MASTER_ADMIN_EMAIL`), 직원 `alinaschool@web.de`(권한 제한, 환불 권한 기본 꺼짐). 피클 = 사용자의 AI 비서(관리자 계정 없음, 봇 키로만 접근).

---

## 2. 남은 일

### 2-1. 사용자가 직접 할 일 (우선순위 순)
1. 🟠 피클에게 최신 `pickle-handoff.md` 전달(AI 승인함 반영본). 피클이 "확인 필요"를 보고하면 은행 입금 알림 라벨·카드 뒤 4자리 대응표 챙기기.
2. 🟠 UptimeRobot 모니터가 `https://reiten.kr/health` **5분 주기**인지 확인(아니면 추가).
3. 🟠 Dependabot PR 정리(§2-3) + GitHub Settings → Advanced Security에서 **보안 알림(Dependabot alerts)** 켜기(버전 업데이트 PR은 이미 오고 있음).
4. 🟡 Works 휴대폰 알림 켜기(AI 승인 요청 푸시) · 텔레그램 연결(봇에 /start → 24시간 안에 Works "채팅 ID 찾기" → Render `TELEGRAM_CHAT_ID`) · 카드 실결제 테스트(PC 1·휴대폰 1·부분취소 1) · 네이버쇼핑 EP 등록(`https://reiten.kr/ep/naver.tsv`) · 피클 Gmail 보안 설정(발송은 대표 본인 주소만·알림 라벨만 읽기).
5. 🟡 Works 컬러 관리에서 독일어/영어 이름 빈 컬러 채우기(예: 크림 옐로우) — 비면 독일어 화면에 한글이 남음.
6. 🟡 Works 데이터 정리: 하트 후디(풀오버)의 "지퍼 참 커스텀 가능" 해제, 상품 사진 컬러 지정, 티셔츠 실측표·이름 오타(리플랙티브), 룩북 빈 칸.
7. 🟢 런칭 시: 스마트택배 키 → Render `SWEETTRACKER_API_KEY`, Render Starter, Supabase Pro(§2-2), 서버 2대 이상이면 Render `RATE_LIMIT_SHARED=on`.

### 2-2. Supabase Pro 전환 체크리스트 (런칭 당일)
Billing에서 Pro(코드·키 변경 없음) → Spend cap 켜기 → Database → Backups에 매일 백업 보이는지 → PITR는 매출 보고 결정 → 주간 메일 백업은 유지(부담되면 `BACKUP_EMAIL=off`) → 복원 화면 위치 미리 확인.

### 2-3. 열린 Dependabot PR 처리 방침
| PR | 내용 | CI | 권장 |
|---|---|---|---|
| #7 | minor/patch 6개 묶음 | 통과 | 머지 |
| #5·#6 | actions/checkout·setup-node 4→7 | 통과 | 머지 |
| #10 | dotenv 16→18 | 통과 | 변경점 확인 후 머지(동작 영향 작음) |
| #9 | node-cron 3→4 (메이저) | 통과 | **보류** — 크론 API 변경 가능. `lib/scheduledJobs.js`로 검토 후 |
| #11 | resend 4→6 (메이저) | 통과 | **보류** — 메일 발송은 테스트로 다 못 잡음. 실제 발송 1건 확인 후 |
| #8 | express 4→5 (메이저) | **실패** | **닫기** — 라우트 문법·`_router` 내부 구조(`lib/routeShadowing.js`)가 바뀜. 별도 작업으로만 |

### 2-4. 다음 개발 후보 (하려면 먼저 추천·승인)
- 발주 초안(입금 확인 주문만, 승인 지문·중복 방지·금액 상한) — AI 승인함 작업 종류로 추가하는 방식 권장.
- AI 승인함 데이터가 쌓이면: 작업별 승인률·거절 사유 통계, 자동 승인 후보 추천.
- 활동 로그·대시보드도 "한 화면 배치"로 정리.
- 화면 코드 정리(§5-2의 계획).

### 2-5. 실계정으로 아직 확인 안 된 것 (가짜 데이터로만 검증)
직원 로그인→PIN→권한 제한 / PIN 6회 잠금→마스터 해제 / 고객 셀프 탈퇴 / 리뷰 요청 메일 / 컬러별 사진·영상 업로드 / 반품 환불 1건 / 사진 리뷰 승인→적립금 / 사이즈 추천 정확도 / 결제창 CSP 위반 여부.

---

## 3. 구조

### 3-1. 한 장 요약
```
브라우저 ──▶ Render: Express 서버 1대 (server/server.js)
              ├─ 호스트 reiten.kr        → 정적 파일 `소스 코드/`  (고객 사이트, 빌드 없음)
              ├─ 호스트 works.reiten.kr  → 정적 파일 `works/`      (관리자 사이트, 로컬은 works.localhost:3000)
              ├─ /api/*                  → server/routes/*.js → server/lib/*.js → Supabase(Postgres)
              ├─ staticGuard             → .md·.sql·.env 등 웹 확장자 아닌 파일은 404
              └─ 크론(lib/scheduledJobs.js, 여러 대여도 app_locks로 1회만)
외부: 포트원/KCP(결제·웹훅) · Resend(메일) · Cloudinary(사진) · 스마트택배 · Sentry · 웹푸시 · 텔레그램 · GA4
피클(AI 비서) ──X-REITEN-BOT-KEY──▶ /api/bot/* (읽기 진단 + 정해진 쓰기 + AI 승인함 "제안")
```

### 3-2. 저장소 폴더 (`나/Reiten/` = git 루트)
| 경로 | 내용 |
|---|---|
| `CLAUDE.md` | 규칙 |
| `소스 코드/` | 고객 사이트. HTML 20개 + `assets/`. 이 문서·CHANGELOG·사용설명서도 여기(웹으로는 안 나감) |
| `works/` | 관리자 사이트. `index.html`(탭 약 21개 마크업) + `js/`(탭별 28개) + `works.css` + `sw.js`(푸시) |
| `server/` | Node(Express) 서버. `server.js`(연결만, 333줄) · `lib/`(공용 로직 67) · `routes/`(API 41) · `migrations/`(001~054) · `test/`(53파일) · `test-helpers/fakeSupabase.js` · `scripts/uiLayoutCheck.js`(CI `ui` 작업) |
| `.github/` | `workflows/test.yml`(test·ui), `post-deploy-health-check.yml`, `dependabot.yml` |
| `레퍼런스/` | 원본 참고 이미지(건드리지 않음) |
| `디자인 시안/` | 로컬 검토용(git 제외) |
| `pickle-handoff.md`·`reiten-monitoring-handoff.md` | 피클 관련 |

### 3-3. server/lib — 기능별 묶음 (새 로직 전에 여기부터 찾을 것)
- **주문·결제**: `orderPricing` `pricing` `orderRules` `orderFinalize`(카드 확정) `orderCancel` `orderLock` `orderNotify` `orderExport` `customerOrders` `portone` `pgErrors` `refunds` `purchaseConfirm` `coupons` `thanksCoupons` `thanksCouponIssue` `loyaltyPoints` `abandonedCart`
- **상품·재고·배송**: `products` `productIds` `catalog` `colors` `inventory` `lookbook` `carriers` `tracking` `trackingBudget` `supplierShipments`
- **돈 관리**: `expenses` `settlement`
- **관리자·보안**: `auth`(requireAuth·마스터) `adminGuard`(PIN·권한) `adminLog`(감사·재고·시스템 오류 로그) `rateLimiters`(**writeLimiter는 이것만 사용**) `rateLimitStore` `bans` `botAuth` `staticGuard` `routeShadowing` `dbLock` `accountDeletion`
- **AI 승인함**: `agentActions`(작업 종류 정의: prepare/execute) `internalDispatch`(승인자 신분으로 기존 API 내부 호출)
- **알림·메일**: `mailer` `push` `telegram` `criticalAlert` `adminWebhook` `kakao` `reviewRequest` `reviewRewards` `briefing`
- **운영**: `scheduledJobs`(크론) `opsCheck`(마이그레이션 점검 `MIGRATION_CHECKS`) `diagnostics` `backup` `analytics` `seo` `assetVersion` `kst`(KST 날짜) `pagination` `bulk` `dbUpdate` `asyncErrors` `phone` `cloudinary` `supabase`

### 3-4. server/routes — API 파일
고객: `checkout`(주문·결제) `payments` `paymentWebhook` `customerOrders` `account` `reviews` `qna` `returns` `restock` `products` `colors` `lookbook` `seo` `clientErrors` `health`
관리자: `adminLogin` `adminOrders` `refunds` `inventory` `products` `coupons` `members` `admins` `staff` `dashboard` `reports` `settings` `notices` `outbox` `handoffNotes` `calendar` `usageLog` `auditLog` `adminNotifications` `alerts` `push` `expenses` `supplierShipments` `supplierInvoices` `agentActions`
피클(봇): `botDiagnostics`(**읽기 전용 — 쓰기 추가 금지**) `botAssist` `supplierShipments`(봇 쓰기) `agentActions`(제안)

### 3-5. 크론 (KST, `lib/scheduledJobs.js`)
매시 00 미입금 자동취소 · 매시 15 배송조회 · 매시 30 결제 이탈 메일 · 매시 50 AI 제안 만료 · 03:40 구매확정 · 04:50 요청제한 정리 · 06:10 정기 지출 · 08:57 아침 요약 · 11:00 리뷰 요청 메일 · 월 04:20 주간 백업 메일 · 월 09:00 장기 품절 알림 · 매월 1일 09:00 정산 리포트.
⚠️ Render 무료 플랜이 잠들면 그 시각 크론은 건너뛴다.

### 3-6. 환경변수 (Render / `server/.env`, 템플릿 `server/.env.example`)
필수: `SUPABASE_URL` `SUPABASE_ANON_KEY` `SUPABASE_SERVICE_ROLE_KEY` `RESEND_API_KEY` `RESEND_FROM` `ADMIN_NOTIFY_EMAIL` `CLOUDINARY_*`
결제: `PORTONE_STORE_ID` `PORTONE_CHANNEL_KEY` `PORTONE_API_SECRET` `PORTONE_WEBHOOK_SECRET` `PORTONE_VIRTUAL_ACCOUNT_*`
선택: `SENTRY_DSN` `REITEN_BOT_KEY`(피클, 32자+) `SWEETTRACKER_API_KEY` `TELEGRAM_BOT_TOKEN` `TELEGRAM_CHAT_ID` `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` `KAKAO_ALIMTALK_*` `GA4_PROPERTY_ID` `GA4_SERVICE_ACCOUNT_JSON` `ADMIN_PIN_SECRET`(없으면 서비스 키에서 파생)
끄기 스위치: `BACKUP_EMAIL=off` `MORNING_BRIEFING=off` `ABANDONED_CART_EMAIL` `REVIEW_REQUEST_EMAIL` · 증설 시: `RATE_LIMIT_SHARED=on`
(정확한 목록: `grep -rhoE "process\.env\.[A-Z_]+" server/lib server/routes server/server.js | sort -u`)

### 3-7. 고객 사이트 `소스 코드/`
- 빌드 도구 없음. 각 HTML이 `assets/js/data.js`(상품 정적 폴백·사업자 정보·택배사) → `i18n.js`(ko/en/ja) → `app.js`(헤더·푸터·장바구니 공용) 순으로 불러오고, **페이지 고유 로직은 HTML 안 `<script>`에 있다**(cart 621줄·product 487줄·account 379줄 등).
- 서버가 있으면 상품·재고·리뷰는 API에서, 없으면 `data.js` 폴백.
- 정적 파일은 `lib/assetVersion.js`가 버전 붙여 캐시. CSP는 `'unsafe-inline'` 허용(인라인 스크립트 때문).

### 3-8. 관리자 사이트 `works/`
- `index.html`에 탭 약 21개 마크업, 탭마다 `js/<탭>.js`. 순서: `core.js`(API·공용) → `nav.js`(탭 전환·검색·상품명 번역 등록) → `pin.js`(PIN·권한 `READONLY_RULES`·`permLevelForTab`) → 탭 파일들 → `boot.js`.
- 문구는 한국어 원문 + 독일어 사전 `소스 코드/assets/js/i18n.de.js`(`test/i18nCoverage.test.js`가 누락 검사).
- 권한 없는 메뉴·버튼은 숨김(서버도 같은 기준으로 거름).

---

## 4. 자주 하는 작업 — 어디를 고치나

| 작업 | 할 일 |
|---|---|
| DB 변경 | `server/migrations/055_*.sql`(여러 번 실행해도 안전) + `lib/opsCheck.js` `MIGRATION_CHECKS` 맨 아래 한 줄 + `reiten_schema_version()` 숫자 + `test/opsBackup.test.js` 가짜 버전 + 이 문서 §1 "다음 번호". |
| 새 API | 같은 도메인의 `routes/*.js`에 추가(없으면 새 파일 + `server.js` 연결). 공용 로직은 `lib/`에서 먼저 찾기. 테스트는 `test-helpers/fakeSupabase.js`로. 리터럴 경로는 `/:id`보다 먼저 등록(어기면 서버가 안 뜸). |
| Works 화면·문구 | `works/index.html` 마크업 + `works/js/<탭>.js` + 독일어를 `i18n.de.js`에. 권한 숨김은 `pin.js`. |
| AI 승인함 작업 추가 | `lib/agentActions.js`에 prepare(검증·전후 미리보기)·execute(기존 관리자 API 호출)만. DB 직접 쓰기 금지. `pickle-handoff.md` 갱신. |
| 상품·가격·재고 | 운영 데이터는 Works에서(즉시 반영). `data.js`는 서버 없을 때 폴백 + 사업자 정보. |
| 고객 화면 | 해당 HTML 안 `<script>` 또는 `assets/js/app.js`·`style.css`. 수정 후 `node server/scripts/uiLayoutCheck.js`(Playwright 필요). |

로컬 실행: `.claude/launch.json`의 `reiten-server`(npm --prefix server start, :3000, Works는 `http://works.localhost:3000`) 또는 `reiten-static`(정적만, :8777).

---

## 5. 함정과 알려진 약점

### 5-1. 함정 (실제로 사고 났던 것)
- **라우트 가로채기**: `/:id`가 `/bulk-active`보다 먼저 등록되면 가로챔 → `lib/routeShadowing.js`가 서버 기동을 막는다.
- **복붙 로직**: 재고 차감이 두 곳에 복사돼 한쪽만 고친 사고 → 새 로직 전에 `lib/` 검색.
- **writeLimiter 새로 만들기 금지**: 파일마다 만들면 제한이 나뉘어 느슨해진다.
- **Render 자동 배포 누락**: 웹훅이 끊겨 며칠 배포 안 된 적 → 머지 후 Events 확인.
- **무료 플랜 잠듦**: 크론 건너뜀 + 깨는 30~60초 동안 웹훅·주문 실패 가능.
- **`014` 마이그레이션은 재고를 전부 지운다**(이미 실행됨 — 다시 돌리지 말 것).
- **`047` + `RATE_LIMIT_SHARED=on`**은 서버 2대 이상일 때만(1대면 느려지기만 함). `045`(app_locks)는 증설 전 필수(실행됨).
- **결제 금액은 서버가 상품 ID로 다시 계산**(`lib/orderPricing.js`). 브라우저 금액을 믿지 말 것.
- **푸시 불가**: 로컬 터미널은 GitHub 인증이 없다 → 사용자에게 GitHub Desktop으로 push 요청.

### 5-2. 구조적 약점 (개선 계획)
1. **고객 페이지 로직이 HTML 인라인 스크립트**(약 3,000줄) → 테스트 불가, CSP `'unsafe-inline'` 필요. 계획: 페이지별 `assets/js/pages/<page>.js`로 옮기기(동작 변경 없이), 순수 계산은 `server/test`에서 테스트, 다 옮기면 CSP에서 `'unsafe-inline'` 제거.
2. **Works `index.html` 1,357줄**(탭 약 21개 마크업이 한 파일) → 탭 마크업을 `works/js/<탭>.js`가 그리게 하거나 `works/tabs/<탭>.html`을 처음 열 때 불러오기. 한 번에 한 탭씩.
3. **`works/js` 큰 파일**: `products.js` 797 · `expenses.js` 718 · `returns-inventory.js` 640(두 기능이 한 파일) → 기능 단위로 나누기.
4. **`i18n.de.js` 1,658줄 단일 사전** → 탭별 파일로 나누면 충돌·누락 관리 쉬움(커버리지 테스트는 유지).
5. 큰 서버 파일: `lib/mailer.js` 631 · `routes/supplierShipments.js` 563 · `lib/orderFinalize.js` 522(카드 확정 실패 분기 테스트 부족).
6. `npm audit` 잔여 low/moderate(`exceljs`·`node-cron` 내부 `uuid`) — 실제 영향 경로 없음, Dependabot으로 추적.
