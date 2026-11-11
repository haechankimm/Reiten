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
- `main` = PR #36(`7e3c7a5`)까지 머지·배포됨(#34 문서 재설계, #35 화면 코드 정리, #36 구글 태그 CSP 허용). 작업 중: 브랜치 `claude/audit-2026-11-11`(전반 감사 수정 3건 + Works 편의 개선: 상품 사진·이름 눌러 수정, 공지·일정 폰 푸시, CS 템플릿 줄바꿈, 활동 로그 정리 — CHANGELOG (15)(16)).
- 2026-11-11 전반 감사: 운영 사이트 고객 페이지 18개 휴대폰·데스크톱·영어 화면 점검, 장바구니 담기~주문서까지 실제 조작(제출·결제는 안 함), 서버 핵심 로직·Works 효율 검토. 결과는 CHANGELOG 2026-11-11 (15).
- 서버 테스트 **340건 통과**(`cd server && npm test`, 약 4초).
- 화면 코드 정리 완료(2026-11-11, #35): 고객 페이지 인라인 스크립트 분리, Works index 탭별 분리, 큰 Works JS·독일어 사전 분리. 사용자가 Works 로그인 뒤 탭 화면 이상 없음 확인. 테스트 335건.
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
6. 🟡 **Works 데이터 정리(감사에서 실제 화면으로 확인 — 손님이 바로 보는 문제)**: ① 하트 후디 **검정 사진에 컬러 '블랙' 지정** — 지금은 검정을 고르면 장바구니·주문 사진이 노란 후디로 나온다. ② 하트 후디(풀오버)의 "지퍼 참 커스텀 가능" 해제 — Zip Studio 기본 상품이 풀오버로 뜬다. ③ 티셔츠: 한 줄 소개 오타 "드라이벌"→"트라이벌", 이름 오타 "리플랙티브"→"리플렉티브", 이름의 "Reiten"은 빼도 됨, 설명 "연출 할 수"→"연출할 수", 실측표 빈칸. ④ 두 상품 모두 **영어·일본어 번역 칸 비어 있음**(영어 화면에 한국어 설명이 그대로 나옴). ⑤ 룩북 8칸·참 갤러리 사진 전부 "사진 준비중".
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
- **[향후 개발 계획] 배송 예정 시간 표시**(사용자 결정 2026-11-11: 계획에만 두고 지금은 안 함): 스마트택배 응답의 `estimate`(예정 시간) 칸을 지금은 읽지 않는다(`lib/tracking.js` `parseTrackingResponse`). 하려면: 파싱 추가 → 주문에 저장(055 마이그레이션 또는 기존 `tracking_status` 옆 칸) → 고객 주문조회·마이페이지·Works 주문 상세에 표시. 키 발급 후 실제 응답으로 형식 확인 필요.
- 발주 초안(입금 확인 주문만, 승인 지문·중복 방지·금액 상한) — AI 승인함 작업 종류로 추가하는 방식 권장.
- AI 승인함 데이터가 쌓이면: 작업별 승인률·거절 사유 통계, 자동 승인 후보 추천.
- 활동 로그·대시보드도 "한 화면 배치"로 정리.
- 화면 코드 정리 후속(§5-2): CSP `'unsafe-inline'` 제거(실결제 확인 후), 장바구니·상품 계산 테스트.

- **[운영 검토] 보안 헤더 `Referrer-Policy: no-referrer`**(helmet 기본값): 외부 서비스로 가는 요청에 출처 주소를 전혀 안 붙인다. 결제창(포트원·KCP)·채널톡이 도메인 확인에 출처를 쓰면 문제가 될 수 있어, 실결제 테스트 때 이상이 있으면 `strict-origin-when-cross-origin`(브라우저 기본값)으로 바꾸는 것을 검토.
- **[운영 검토] 무료배송 기준**은 쿠폰·적립금 차감 **전** 상품 합계(10만 원)로 계산한다(`lib/orderPricing.js`). 의도와 다르면 정책 결정 필요.

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
| `소스 코드/` | 고객 사이트. HTML 20개 + `assets/`(`js/pages/` 페이지별 로직, `js/i18n-de/` Works 독일어). 이 문서·CHANGELOG·사용설명서도 여기(웹으로는 안 나감) |
| `works/` | 관리자 사이트. `index.html`(뼈대) + `tabs/`(탭 마크업 21) + `partials/`(사이드바·로그인·사진 편집기·독일어 목록) + `js/`(기능별 34) + `works.css` + `sw.js`(푸시) |
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
매시 00 미입금 자동취소 · 매시 15 배송조회 · 매시 30 결제 이탈 메일 · 매시 50 AI 제안 만료 · 03:40 구매확정 · 04:50 요청제한 정리 · 06:10 정기 지출 · 04:55 활동 로그 정리(AI 조회 기록 30일) · 08:57 아침 요약 · 09:00 오늘·내일 일정 푸시 · 11:00 리뷰 요청 메일 · 월 04:20 주간 백업 메일 · 월 09:00 장기 품절 알림 · 매월 1일 09:00 정산 리포트.
⚠️ Render 무료 플랜이 잠들면 그 시각 크론은 건너뛴다.

### 3-6. 환경변수 (Render / `server/.env`, 템플릿 `server/.env.example`)
필수: `SUPABASE_URL` `SUPABASE_ANON_KEY` `SUPABASE_SERVICE_ROLE_KEY` `RESEND_API_KEY` `RESEND_FROM` `ADMIN_NOTIFY_EMAIL` `CLOUDINARY_*`
결제: `PORTONE_STORE_ID` `PORTONE_CHANNEL_KEY` `PORTONE_API_SECRET` `PORTONE_WEBHOOK_SECRET` `PORTONE_VIRTUAL_ACCOUNT_*`
선택: `SENTRY_DSN` `REITEN_BOT_KEY`(피클, 32자+) `SWEETTRACKER_API_KEY` `TELEGRAM_BOT_TOKEN` `TELEGRAM_CHAT_ID` `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` `KAKAO_ALIMTALK_*` `GA4_PROPERTY_ID` `GA4_SERVICE_ACCOUNT_JSON` `ADMIN_PIN_SECRET`(없으면 서비스 키에서 파생)
끄기 스위치: `BACKUP_EMAIL=off` `MORNING_BRIEFING=off` `ABANDONED_CART_EMAIL` `REVIEW_REQUEST_EMAIL` · 증설 시: `RATE_LIMIT_SHARED=on`
(정확한 목록: `grep -rhoE "process\.env\.[A-Z_]+" server/lib server/routes server/server.js | sort -u`)

### 3-7. 고객 사이트 `소스 코드/`
- 빌드 도구 없음. 각 HTML은 `<head>`에서 `assets/js/site-init.js`(GA4 설정·채널톡, 전 페이지 공용)를 먼저, 본문 끝에서 `data.js`(상품 정적 폴백·사업자 정보·택배사) → `i18n.js`(ko/en/ja) → `app.js`(헤더·푸터·장바구니 공용) → **`assets/js/pages/<페이지>.js`(그 페이지 전용 로직)** 순으로 불러온다. HTML 안에 실행 스크립트는 없다(2026-11-11 분리, 상품 정보 JSON-LD만 서버가 넣음). 404·500은 어느 주소에서든 뜨므로 `/assets/...` 절대 경로.
- 서버가 있으면 상품·재고·리뷰는 API에서, 없으면 `data.js` 폴백.
- 정적 파일은 `lib/assetVersion.js`가 버전(`?v=`) 붙여 1년 캐시. CSP `script-src`의 `'unsafe-inline'`은 **아직 남겨 둠** — 우리 페이지에는 인라인 스크립트가 없지만, 결제창(포트원·KCP)·채널톡·우편번호 같은 외부 스크립트가 인라인을 쓰는지 실결제로 확인한 뒤 뺀다(§5-2).

### 3-8. 관리자 사이트 `works/`
- `index.html`(약 170줄)은 뼈대만. 탭 마크업은 `works/tabs/<탭>.html`(21개), 사이드바·로그인·사진 편집기·독일어 목록은 `works/partials/`. index의 `<!-- #include tabs/x.html -->` 줄을 **서버가 HTML을 보낼 때 그 파일 내용으로 바꿔 끼운다**(`lib/assetVersion.js` `expandIncludes`) — 브라우저가 받는 HTML은 나누기 전과 같다. 그래서 Works는 반드시 서버(`works.localhost:3000`)로 열어야 한다. 새 탭을 만들면 `tabs/`에 파일 + index에 include 한 줄(`test/worksIncludes.test.js`가 빠진 것을 잡는다).
- 탭 JS는 `js/<기능>.js`. 순서: `core.js`(API·공용) → `nav.js`(탭 전환·검색·상품명 번역 등록) → `pin.js`(PIN·권한 `READONLY_RULES`·`permLevelForTab`) → 탭 파일들 → `boot.js`. 상품은 `photo-editor` → `product-colors` → `product-media` → `products` 순서가 필요(products.js가 불러오자마자 사진 목록을 그림). 반품 `returns.js`·재고 `inventory.js`, 지출 `expenses.js` → `expense-margin.js`·`expense-import.js`.
- 문구는 한국어 원문 + 독일어 사전 `소스 코드/assets/js/i18n-de/<탭>.js`(그 탭에서만 쓰는 문구) · `_common.js`(두 탭 이상·메뉴·서버 응답 문구, `addDe` 정의). 새 사전 파일은 `works/partials/i18n-de.html`에 한 줄. `test/i18nCoverage.test.js`가 누락 검사.
- 권한 없는 메뉴·버튼은 숨김(서버도 같은 기준으로 거름).

---

## 4. 자주 하는 작업 — 어디를 고치나

| 작업 | 할 일 |
|---|---|
| DB 변경 | `server/migrations/055_*.sql`(여러 번 실행해도 안전) + `lib/opsCheck.js` `MIGRATION_CHECKS` 맨 아래 한 줄 + `reiten_schema_version()` 숫자 + `test/opsBackup.test.js` 가짜 버전 + 이 문서 §1 "다음 번호". |
| 새 API | 같은 도메인의 `routes/*.js`에 추가(없으면 새 파일 + `server.js` 연결). 공용 로직은 `lib/`에서 먼저 찾기. 테스트는 `test-helpers/fakeSupabase.js`로. 리터럴 경로는 `/:id`보다 먼저 등록(어기면 서버가 안 뜸). |
| Works 화면·문구 | 마크업 `works/tabs/<탭>.html` + 동작 `works/js/<기능>.js` + 독일어 `소스 코드/assets/js/i18n-de/<탭>.js`(여러 탭이면 `_common.js`). 권한 숨김은 `pin.js`. |
| AI 승인함 작업 추가 | `lib/agentActions.js`에 prepare(검증·전후 미리보기)·execute(기존 관리자 API 호출)만. DB 직접 쓰기 금지. `pickle-handoff.md` 갱신. |
| 상품·가격·재고 | 운영 데이터는 Works에서(즉시 반영). `data.js`는 서버 없을 때 폴백 + 사업자 정보. |
| 고객 화면 | 마크업은 HTML, 동작은 `assets/js/pages/<페이지>.js`(공용은 `app.js`), 모양은 `style.css`. HTML에 인라인 `<script>`를 다시 넣지 말 것. 수정 후 `node server/scripts/uiLayoutCheck.js`(Playwright 필요, CI `ui`도 같은 검사). |

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

### 5-2. 구조적 약점 (남은 개선 계획)
2026-11-11에 끝낸 것: 고객 페이지 인라인 스크립트 → `pages/*.js`, Works index → `tabs/`·`partials/`, 큰 Works JS 3개 → 기능별 9개, 독일어 사전 → 탭별 20개(CHANGELOG 2026-11-11 (13)).
1. **CSP `'unsafe-inline'` 제거**(script-src) — 실결제(PC·휴대폰) 1회 때 브라우저 콘솔에 CSP 위반이 없는지 보고 `server/server.js` `scriptSrc`에서 뺀다. 그 전에 빼면 결제창이 조용히 막힐 위험.
2. **고객 페이지 계산 로직 테스트** — `pages/cart.js`(610줄)·`pages/product.js`(476줄)의 가격·옵션 계산을 순수 함수로 뽑아 `server/test`에서 검사.
3. 큰 파일(나눌 후보): `pages/cart.js` 610 · `pages/product.js` 476 · `works/js/expenses.js` 465 · `works/js/inventory.js` 432 · `i18n-de/_common.js`(665개 문구) · `lib/mailer.js` 631 · `routes/supplierShipments.js` 563 · `lib/orderFinalize.js` 522(카드 확정 실패 분기 테스트 부족).
4. `npm audit` 잔여 low/moderate(`exceljs`·`node-cron` 내부 `uuid`) — 실제 영향 경로 없음, Dependabot으로 추적.
