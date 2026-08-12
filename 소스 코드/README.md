# REITEN — 웹사이트 소스 문서

> **Reiten** [ˈʁaɪtn̩] — 독일어로 '타다'.
> 리플렉티브(스카치 전사) 프린팅 라이딩 후디 · 후드집업 · 크롭 후디를 파는 온라인 스토어.
> 남녀공용 · 프리미엄 · 오프화이트 미니멀.

프런트엔드는 빌드 도구가 필요 없는 **정적 사이트**입니다(HTML/CSS/바닐라 JS). 폴더를 그대로
호스팅에 올리면 그것만으로 완결된 쇼핑몰이 동작합니다. 여기에 더해 `server/`에 **선택적** Node.js
백엔드를 하나 얹어뒀는데, 이건 주문 가격 서버측 검증 · 리뷰 등록처럼 브라우저만으로는 안전하게 할 수
없는 일을 맡습니다. 서버가 없어도 사이트는 그대로 동작하고(자동 폴백), 서버가 있으면 기능이 하나
늘어나는 구조입니다 — 자세한 내용은 [12번](#12-nodejs-백엔드-서버-선택)을 보세요.

---

## 0. 현재 배포 상태 (다음 작업 전에 이 섹션부터 읽으세요)

> 이 섹션은 실제 운영 환경(GitHub·Render·Supabase·도메인)이 어디까지 설정됐는지 기록해두는
> 곳입니다. Claude와의 대화는 세션이 바뀌면 이전 대화 내용을 기억하지 못하므로, "지금 뭐가
> 되어 있고 뭐가 안 되어 있는지"는 대화가 아니라 **이 섹션을 최신 상태로 유지하는 것**으로
> 인수인계하세요.
>
> **⚠️ 운영 규칙: 의미 있는 패치(기능 추가·버그 수정·설정 변경)를 커밋할 때마다, 같은 작업
> 안에서 반드시 이 0번 섹션의 표와 "최근 작업 이력"을 함께 업데이트한다.** 코드만 고치고
> README를 안 고치면, 다음 세션(또는 다른 사람)은 지금 상태를 다시 처음부터 추측해야 합니다.

| 항목 | 상태 |
|---|---|
| **GitHub** | `https://github.com/haechankimm/Reiten`, `main` 브랜치. 로컬에서 push하려면 **GitHub Desktop**으로 해야 함(터미널 `git push`는 이 컴퓨터에 인증정보가 없어서 항상 실패함 — GitHub Desktop 열어서 Push origin 클릭) |
| **Render** | Web Service 이름 `Reiten` (Service ID `srv-d9q5bndbedkc73b4c3q0`), Root Directory `server`, `main` 브랜치 연결, Auto-Deploy `On Commit`. 기본 주소 `https://reiten.onrender.com`. **주의**: GitHub 웹훅이 한 번 끊겨서 push해도 자동 배포가 며칠간 안 걸린 적이 있음 — push 후 Render **Events** 탭에서 최신 커밋 해시로 "Deploy live"가 떴는지 꼭 확인할 것. 안 걸렸으면 우측 상단 **Manual Deploy → Deploy latest commit**으로 강제 배포(Settings → Deploy에 있는 Deploy Hook으로 API 트리거도 가능, 키는 레포에 올리지 말 것). 무료 플랜이라 무활동 시 슬립됨(첫 방문자 30~50초 지연) |
| **도메인** | `reiten.kr` · `www.reiten.kr` (후이즈도메인 구매) → Render 연결 **완료**. A레코드(`reiten.kr` → `216.24.57.1`) + CNAME(`www.reiten.kr` → `reiten.onrender.com`)를 후이즈 "네임서버 고급설정 → A 레코드 관리 / CNAME 레코드 관리"에 등록. Render Custom Domains에서 둘 다 Verified·Certificate Issued 확인됨(SSL은 Render가 자동 발급·자동 갱신 — 사용자가 인증서를 따로 저장·관리할 필요 없음) |
| **Supabase** | 프로젝트 URL `https://oyzqsdcstliknqlmfejr.supabase.co`. 키 값은 로컬 `server/.env`와 Render 환경변수에 있음(레포에는 안 올라감). Authentication → URL Configuration → Redirect URLs에 `https://reiten.kr/account.html`, `https://reiten.kr/**`, `https://reiten.onrender.com/account.html` 등록 완료 |
| **관리자 계정** | `haechankimm@gmail.com` → `profiles.role = 'admin'`으로 승격 완료. 새 관리자를 추가하려면: ① 해당 사람이 `account.html`에서 회원가입 → ② Supabase 대시보드 SQL Editor에서 `update profiles set role = 'admin' where id = '해당 UUID';` |
| **사업자 정보** | `assets/js/data.js`의 `SITE.biz` 전부 채움(상호 Reiten · 대표 김해찬 · 사업자등록번호 154-44-01222 · 통신판매업신고 제-2026-용인기흥-00638 호 · 주소 · 전화번호 010-9399-6861). `SITE.order.kakao`(카카오톡 채널) · `SITE.order.instagram`(인스타그램 계정)은 아직 자리표시자 |
| **법적 필수 페이지** | `privacy.html`(개인정보처리방침) · `terms.html`(이용약관) 작성 및 배포 완료. Claude가 초안 작성한 것이라 법률 자문은 아님 — 실제 운영 방식이 바뀌면(카드결제 도입 등) 같이 갱신 필요 |
| **참(charm)** | 가격 0원(무료)으로 변경됨. "이미 집업이 있으면 참만 구매" 기능은 무료 상품 무제한 주문 악용 우려로 숨김 처리(코드는 남아있어 필요시 재활성화 가능) |
| **상품 색상 · 사이즈** | 색상 팔레트를 6종(블랙·화이트·핑크·딥블루·스카이블루·클레이)으로 단순화, 사이즈는 전 상품 XS·S·M·L·XL 고정 + 관리자 패널에서 사이즈별 체크박스로 품절 처리(자유 텍스트 입력 방식 폐지). 기존에 카키·옐로우·포레스트·차콜 색상으로 촬영해뒀던 사진들은 새 팔레트와 안 맞아 전부 내림(재촬영 필요) — **Supabase에는 아직 반영 안 됨**, 아래 "지금 막혀 있는 것" 2번 참고 |
| **상품 타입 · 카테고리 · 룩북 폼** | 관리자 패널의 상품 등록 폼에서 "타입"·"카테고리"가 자유 텍스트 입력에서 선택란(카테고리는 목록에 없으면 "직접 입력"으로 새 카테고리 추가 가능 — 한 번이라도 저장된 카테고리는 다음부터 자동으로 선택지에 뜸)으로 바뀜. 상품 사진 업로드 칸의 라벨도 컬러 선택 순서에 안 맞춰도 되도록 "상품사진 1~4"로 고정(컬러 클릭 시 사진이 자동으로 바뀌던 연결도 제거). 룩북 등록 폼의 "가로세로 비율"도 프리셋 선택 + 직접입력으로 바뀌었고, 실제 룩북 타일과 똑같은 모양의 실시간 미리보기가 추가됨. 상품 타입에 `tshirt`(티셔츠) 추가 — 참(charm) 커스텀은 기본 꺼짐 상태로 두면 됨(지퍼가 없어서 스튜디오 베이스 목록에 자동으로 안 뜸). 티셔츠 실측표(`SIZE_TABLES.tshirt`)는 아직 빈 칸(실측 전) |
| **관리자 테마** | 초록(grass) 테마가 너무 밝다는 피드백으로 훨씬 어둡고 채도 낮은 다크 그린 톤으로 전면 톤다운(버튼·배지·로밍 말 배경 전부) |
| **다국어** | 고객 화면: 한국어/English/日本語(헤더에서 전환). 관리자 패널: 한국어/Deutsch(계정 페이지의 관리자 패널 안쪽에서만 전환 — 독일인 동업자용, 헤더 언어 메뉴에는 안 나옴). 장바구니는 담을 때 언어가 아니라 볼 때마다 현재 언어로 다시 번역되도록 수정됨. 관리자 패널을 Deutsch로 봤을 때 한글로 새던 몇몇 포인트(사진 선택 버튼, 반품·교환 신청, 룩북 "w12 (전체)" 옵션 등) 번역 보완 완료 |
| **관리자 로그인 표시** | `account.html`에서 role=admin으로 로그인하면(특정 계정이 아니라 admin 전원 공통) ①"내 계정" 옆 초록 배지 ②인사말 앞 "(Admin)" 접두어 ③페이지 전체가 초록(grass) 테마로 전환 ④화면 하단 숲길(나무·풀 다수)을 로밍하는 말 애니메이션(가끔 멈춰서 풀을 뜯음)이 함께 뜸. 말 모양은 `logo-mark.png`(로고의 말 실루엣) 좌표를 옮겨 그린 것 — 몸통/꼬리는 한 덩어리, 다리 4개만 따로 움직여 걷는 동작을 냄(다리가 축 늘어지지 않도록 디딤·회복 구간을 다르게 타이밍). `account.html` 한 페이지에만 적용되고 다른 페이지는 영향 없음(의도적 범위 제한 — 다른 페이지까지 넓히려면 지금은 5개 페이지에서만 불러오는 Supabase 로그인 확인을 전체 16페이지로 확장해야 해서 보류) |
| **비밀번호 재설정** | 계정 페이지에 이메일 링크 방식으로 구현 완료(Supabase Auth 내장 기능). Redirect URL 등록 완료로 정상 동작 |
| **주문서** | 우편번호는 다음(카카오) 우편번호 API로 검색해서 채우는 방식(직접 입력 불가). 배송 메모는 프리셋 선택 + 없음 + 직접입력 드롭다운 |
| **운영 자동화** | ① 관리자가 운송장번호를 처음 입력하면 고객에게 배송 시작 메일 자동 발송 ② 주문으로 재고가 0이 되는 조합이 생기면 관리자에게 알림 메일 ③ push/PR마다 `server/test`의 기존 테스트를 자동 실행하는 GitHub Actions 워크플로(`.github/workflows/test.yml`) 추가 — 실패해도 Render 배포를 막지는 않고 GitHub에 초록/빨강 표시만 남김 ④ Sentry(`@sentry/node`) 연동 완료 — `SENTRY_DSN`을 로컬 `.env`·Render 환경변수에 설정, 테스트 이벤트 전송까지 확인됨 ⑤ UptimeRobot 연결 완료(테스트 알림 수신 확인) ⑥ Resend `reiten.kr` 도메인 인증 완료(대시보드 Verified 배지 확인) → `RESEND_FROM`을 `order@reiten.kr`로 변경, 고객이 답장하면 실제 CS 메일(`Reiten.customersupport@gmail.com`)로 가도록 `replyTo` 추가 |
| **Reiten Works (관리자 전용 사이트)** | 소비자 사이트(`reiten.kr`)와 도메인을 분리한 관리자 전용 사이트 — 별도 서버·별도 배포가 아니라 **같은 Express 서버가 호스트네임으로 분기**하는 구조(`server.js`의 `WORKS_DIR` 분기, `works/index.html`). API(`/api/admin/*`)는 그대로 재사용해 CORS·추가 인증 로직이 필요 없음. DNS·Render Custom Domain·Supabase Redirect URL 전부 등록 완료, 실제 로그인 후 주문·재고·상품 데이터까지 정상 노출 확인됨. UI는 사이드바 대시보드(좌측 내비게이션 + 상단바: 로고·라이트/다크·KO/DE·로그인한 관리자 표시, 라이트=흰색/다크=디스코드 톤/포인트=스페이스블루)로 재설계 완료. "전체 주문"은 목록+상세패널 구조. `works.reiten.kr`에서 로그인 후 실제 데이터까지 다시 확인되면 `account.html`의 기존 관리자 패널과 `/__works-preview` 임시 경로를 정리할 예정(안전장치로 아직 유지 중) |
| **Works 추가 기능(2026-08-12)** | ① 로그인 화면에 "이메일 저장" 체크박스 추가(Works·소비자 계정 페이지 둘 다, localStorage에만 저장·비밀번호는 저장 안 함) ② 상품 목록을 세로로 긴 리스트에서 **썸네일 위주 그리드**로 변경(한눈에 훑어보기 쉽게) ③ 룩북 편집을 "몇 번 칸인지 글로 고르기"에서 **실제 배치를 그대로 재현한 미리보기에서 칸을 클릭해 선택**하는 방식으로 변경 ④ 새 **"정보" 탭** 추가 — 사업자 정보 요약이나 Supabase·Render 같은 운영 사이트 링크를 관리자가 직접 적어두고 보는 곳(민감정보는 넣지 않는 용도). `admin_settings` 테이블이 새로 필요해서 **`server/migrations/007_admin_settings.sql`을 Supabase에서 아직 실행 안 하면 "정보" 탭이 계속 빈 목록에 저장 실패 토스트만 뜸** — 아래 "지금 막혀 있는 것" 참고 |

### 지금 막혀 있는 것 (다음에 이어서 할 일)
1. `SITE.order.kakao` · `SITE.order.instagram` 자리표시자 교체 (카카오톡 채널·인스타그램 계정 개설 후)
2. **상품 8종 전부 관리자 패널에서 재저장 필요** — 색상 팔레트를 6종(블랙·화이트·핑크·딥블루·스카이블루·클레이)으로 줄이고 사이즈를 XS~XL 고정으로 바꾸면서 `data.js`(정적 폴백)는 이미 새 값으로 바뀌었지만, `server/`가 떠 있으면 실제 사이트는 Supabase `products` 테이블 값을 쓴다 — 그 테이블은 옛날 색상(카키·옐로우·포레스트·차콜 등)·사진 그대로 남아있으므로, 8개 상품을 관리자 패널 "상품" 탭에서 하나씩 열어(수정 폼에 새 색상·사이즈 체크박스가 이미 반영돼 있음) 저장 버튼만 눌러줘야 실제 반영됨(사진은 전부 내려간 상태라 새로 촬영해 업로드하기 전까진 "사진 준비중"으로 보임)
3. 상품 가격 · 재고(`inventory`) 초기값 최종 확인 — 사이즈가 XS/XL까지 늘어났으므로 그만큼 재고 행도 추가 필요, 비어있는 사이즈는 주문이 막힘
4. 실제 기기(아이폰/안드로이드)로 주문 흐름 1회 테스트
5. (선택, 오픈 임박 시) Render 무료 → Starter(월 7달러) 업그레이드로 슬립 방지
6. 티셔츠: 실제 상품(상품명·설명·가격·사진) 관리자 패널에서 등록 + `SIZE_TABLES.tshirt` 실측값 채우기(코드에는 카테고리/타입만 준비해뒀고 실제 상품은 아직 없음)
7. **works.reiten.kr에서 새 UI로 실제 로그인 재확인** — 로컬에서는 검증했지만 실제 배포 후 로그인까지 확인 필요. 확인되면 다음 항목 진행
8. **정리 작업 (7번 확인 후)** — `account.html`의 관리자 패널 섹션(`#admin-panel`)과 `server.js`의 `/__works-preview` 임시 경로 제거. `works.reiten.kr`가 완전히 자리잡을 때까지 안전장치로 일부러 남겨둔 것들
9. (선택) 반품·QnA·리뷰 탭도 "전체 주문"과 같은 목록+상세패널 구조로 통일 — 지금은 주문 탭만 새 구조이고 나머지는 기존 카드 UI(색상만 새 팔레트). 필요하면 다음 단계로 진행
10. (선택, 다음 단계로 권장) 관리자 감사 로그(`admin_id`·`action`·`target`·`at`) — Works를 다시 만드는 김에 추가하면 좋은데 이번 작업 범위에서는 뺌(새 마이그레이션 + Supabase 실행이 필요해서 별도로 진행하는 게 나음)
11. **`server/migrations/007_admin_settings.sql`을 Supabase SQL Editor에서 실행** — Works "정보" 탭이 쓰는 `admin_settings` 테이블 생성. 001~006과 같은 방식으로 전체 복사해서 실행하면 됨
12. (아이디어 단계, 조사 필요) 택배사 발주 자동화 — CJ대한통운·한진 등 택배사 API는 보통 계약 화주에게만 열려 있어서, 코드보다 먼저 "직접 계약" 또는 "스마트택배 같은 배송 API 대행 서비스 가입" 중 하나를 정해야 함. 정해지면 그 API로 연동하는 건 어렵지 않음

### 관리자 패널 변경 vs 코드 변경 — 반영되는 방식이 다릅니다
- **관리자 패널(상품·재고·룩북·리뷰 승인 등)에서 하는 수정**은 Supabase 데이터베이스 변경입니다. 사이트가 켜져 있는 한 새로고침만 해도 바로 반영되고, 이건 어떤 대화 세션에서 하든 항상 동일하게 즉시 반영됩니다.
- **코드 자체를 고치는 작업**(디자인·기능·문구 등)은 파일 수정 → git commit → GitHub push(GitHub Desktop) → Render 자동 재배포 순서를 거쳐야 실제 사이트에 반영됩니다. 이 절차는 대화 세션이 바뀌어도 동일하지만, 새 세션의 Claude는 이 대화를 기억하지 못하므로 무엇이 되어 있고 안 되어 있는지는 이 README(특히 이 0번 섹션)를 통해서만 전달됩니다. **push 후에는 Render Events에서 실제로 최신 커밋이 배포됐는지 항상 확인할 것** (위 "Render" 항목 참고 — 자동배포가 조용히 안 걸릴 수 있음).

### 최근 작업 이력 (최신이 위)
> 전체 변경 내역은 `git log`가 정확하지만, 매번 명령어를 돌리기보다 여기서 최근 흐름만
> 빠르게 훑을 수 있게 요약해둡니다. 오래된 항목은 가끔 정리(요약/삭제)해도 됩니다.

- **2026-08-12** — Works 사용성 개선 4종: 로그인 "이메일 저장" 체크박스(Works+계정 페이지), 상품 목록을 그리드 카드로, 룩북을 실제 배치 클릭형 미리보기로, 사업자 정보·운영 링크를 관리자가 직접 적어두는 "정보" 탭 신설(`admin_settings` 테이블, `007_admin_settings.sql` — Supabase에서 실행 필요). 작업 중 `resetLookbookForm()`이 아직 선언되기 전인 `lookbookState`를 참조해서 페이지 전체가 죽던 순서 버그를 발견·수정(선언을 위로 이동)

- **2026-08-12** — Works UI를 사이드바 대시보드로 전면 재설계: 좌측 사이드바 내비게이션 + 상단바(로고·라이트/다크·KO/DE·로그인 관리자 표시), 라이트=흰색/다크=디스코드 톤 회색/포인트=스페이스블루 팔레트, "전체 주문" 탭은 목록+상세패널 구조로 새로 짬. `style.css`의 기존 컴포넌트(.btn/.panel/.field 등)는 그대로 재사용하되 참조하는 토큰만 새 팔레트로 덮어써서 반품·재고·QnA·상품·리뷰·룩북 탭도 자동으로 같은 톤이 되게 함. `<html lang="ko" data-theme="light">`처럼 요소에 `hidden`과 `display`를 같이 주면(인라인이든 클래스든) 브라우저 기본 규칙보다 이 파일의 CSS가 이겨서 오히려 보여버리는 문제를 `[hidden]{display:none!important}` 한 줄로 전부 해결. 로고는 기존 `logo-mark.png`(말+오토바이 실루엣, 이미 투명 배경)를 그대로 사용, 다크모드에서는 `filter:invert`로 흰색으로 반전. 사이드바 항목에 실수로 남겨뒀던 빈 `data-i18n-attr=""`가 독일어 전환 시 `applyI18n()`을 죽이던 버그도 발견해서 제거
- **2026-08-12** — `works.reiten.kr` DNS·Render Custom Domain·Supabase Redirect URL 등록 완료, 실제 로그인 + 주문/재고/상품 데이터 노출까지 확인됨. 로그인 전에도 로그아웃·언어 버튼이 보이던 표시 버그 발견·수정(`hidden` 속성과 인라인 `display:flex`를 같이 써서 인라인 스타일이 우선 적용되던 문제)
- **2026-08-12** — Reiten Works(관리자 전용 사이트) 1차 구현: 같은 서버가 호스트네임(`works.reiten.kr`)으로 분기해 관리자 전용 정적 사이트를 서빙하도록 `server.js` 수정, `account.html`의 관리자 패널을 `works/index.html`로 이관(소비자용 장식 요소는 뺌). 아직 DNS/Render Custom Domain/Supabase Redirect URL 미설정이라 실제 접속은 안 됨(위 "지금 막혀 있는 것" 참고). Resend `RESEND_FROM`을 인증된 `order@reiten.kr`로 변경 + `replyTo`로 실제 CS 메일 연결. Sentry DSN·UptimeRobot 설정 완료 확인
- **2026-08-12** — 운영 자동화 1차: 배송 시작 자동 메일, 재고 소진 시 관리자 알림 메일, GitHub Actions로 push마다 테스트 자동 실행, Sentry 에러 모니터링 연동(DSN 없으면 비활성) 추가. `.env.example`에 실수로 남아있던 개인 이메일 제거
- **2026-08-09** — 관리자 상품/룩북 등록 폼 개선: 타입·카테고리를 자유 텍스트에서 선택란으로(카테고리는 "직접 입력"으로 새 값 추가 가능, 한 번 저장되면 다음부터 목록에 뜸), 룩북 "가로세로 비율"도 프리셋+직접입력 선택란으로, 룩북 실시간 미리보기 추가. 상품 타입에 `tshirt`(티셔츠) 추가. 관리자 초록 테마가 너무 밝다는 피드백으로 훨씬 어두운 다크 그린 톤으로 전면 톤다운
- **2026-08-09** — 상품 색상 팔레트를 6종(블랙·화이트·핑크·딥블루·스카이블루·클레이)으로 단순화, 사이즈를 전 상품 XS~XL 고정 + 관리자 패널 체크박스 방식으로 변경(자유 텍스트 입력 폐지). 관리자 상품 사진 업로드 칸이 컬러 선택 순서에 맞춰 라벨이 바뀌던 걸 없애고 "상품사진 1~4"로 고정해 순서 안 맞춰도 되게 함(컬러↔사진 인덱스 연결도 함께 제거, 고객 페이지에서 컬러 클릭 시 사진이 자동으로 안 바뀜). 새 팔레트에 없는 색상으로 촬영해뒀던 사진은 전부 내림
- **2026-08-07** — 관리자 로그인 시각적 표시 추가: 배지 + "(Admin)" 인사말 접두어 + 초록(grass) 테마 + 숲길을 로밍하는 말 애니메이션(`account.html` 한정, role=admin 전원 공통). 말 모양을 로고(`logo-mark.png`) 실루엣으로 다시 그리고, 다리가 축 늘어져 보이던 걸 디딤/회복 구간이 다른 걸음걸이로 교체, 바닥에 나무·풀을 늘려 숲처럼 보이게 함. 관리자 패널 독일어(Deutsch) 번역 누락분(사진 선택·반품 신청·룩북 옵션 등) 보완
- **2026-08-07** — 로그인 세션 만료 방지: 비활성 탭에서 브라우저가 타이머를 늦춰 supabase-js 자동 갱신이 늦어지는 문제 → `getFreshSession()`에서 만료 1분 전이면 즉시 `refreshSession()` 호출하도록 수정
- **2026-08-07** — `reiten.kr` 도메인을 Render에 최종 연결(A/CNAME 등록, SSL 발급 확인). Render 자동배포가 며칠간 안 걸리던 문제 발견 → Manual Deploy로 해결, Deploy Hook을 백업 수단으로 확보
- **2026-08-07** — 우편번호 검색(다음 API), 배송 메모 프리셋 드롭다운 추가. 장바구니가 담을 때 언어로 고정되던 버그 수정. 룩북 페이지의 개발자용 안내문 제거
- **2026-08-06** — `privacy.html`(개인정보처리방침) · `terms.html`(이용약관) 작성 및 배포
- **2026-08-06** — 관리자 패널 저장 실패 시 원인(세션 만료 등)을 구체적으로 표시하도록 개선
- **2026-08-06** — 비밀번호 재설정 기능(이메일 링크) 추가, 번역 누락 다수 보완, `sitemap.xml` 도메인 확정 반영
- **2026-08-06** — 아이클라우드 동기화 충돌로 생긴 중복 폴더·백업 zip을 저장소에서 정리
- **2026-08-06** — TM 마크(REITEN™) 표기, 대표자 연락처 반영
- **2026-08-06** — GitHub 저장소(`haechankimm/Reiten`) 연결, Render Web Service 최초 배포
- **2026-08-06** — 번역 누락 전면 보완(상품 4종 + 페이지 다수), 참(charm) 무료화, 사업자정보·주문/CS 이메일 분리 반영, 관리자 패널 독일어 지원 추가

---

## 목차

1. [빠른 시작](#1-빠른-시작)
2. [폴더 구조](#2-폴더-구조)
3. [파일별 역할](#3-파일별-역할)
4. [데이터 모델](#4-데이터-모델)
5. [화면 흐름](#5-화면-흐름)
6. [구현 완료된 기능](#6-구현-완료된-기능)
7. [미완성 · 앞으로 할 일](#7-미완성--앞으로-할-일)
8. [알려진 제약과 주의사항](#8-알려진-제약과-주의사항)
9. [커스터마이징 가이드](#9-커스터마이징-가이드)
10. [주문 자동 수신 연결](#10-주문-자동-수신-연결)
11. [카드결제(PG) 붙이기](#11-카드결제pg-붙이기)
12. [Node.js 백엔드 서버 (선택)](#12-nodejs-백엔드-서버-선택)
13. [배포](#13-배포)

---

## 1. 빠른 시작

### 정적 사이트만 볼 때

`소스 코드/` 폴더에서:

```bash
python3 -m http.server 8777
```

브라우저에서 `http://localhost:8777` 을 엽니다.

> ⚠️ HTML 파일을 **더블클릭해서 여는 방식(`file://`)은 쓰지 마세요.**
> 브라우저 보안 정책 때문에 일부 기능이 막힙니다. 반드시 위 서버 방식으로 확인하세요.

### 주문 가격 검증·리뷰까지 켜서 볼 때

`server/` 폴더에서:

```bash
cd server
npm install
npm start
```

`http://localhost:3000`에서 사이트가 그대로 뜨고, 주문서 제출과 리뷰 등록이 서버로 처리됩니다.
자세한 내용은 [12번](#12-nodejs-백엔드-서버-선택) 참고.

**왜 프런트는 정적 사이트인가**
프레임워크·번들러를 쓰면 로컬에서 빌드 과정 없이 바로 확인하기 어렵고, Netlify/Vercel 같은 곳에
폴더째 드래그해서 배포하는 것도 안 됩니다. 정적 파일이면 명령 한 줄로 미리보고 그대로 배포할 수
있습니다. 뒤로 갈수록 필요해진 기능(가격 검증, 리뷰 저장)만 `server/`라는 별도 계층으로 얹었고,
프런트 자체의 정적 배포 방식은 바꾸지 않았습니다.

---

## 2. 폴더 구조

```
나/Reiten/
├── 소스 코드/                    ← 웹사이트 (이 폴더)
│   ├── README.md                 이 문서
│   ├── index.html                홈
│   ├── shop.html                 전체 상품 (카테고리 필터)
│   ├── product.html              상품 상세      ?id=상품아이디
│   ├── customizer.html           지퍼 참 스튜디오 ?id=&charm=
│   ├── charms.html               참 갤러리 (실물 사진, 준비되는 대로 채움)
│   ├── lookbook.html             룩북 / 라이딩 필름
│   ├── about.html                브랜드 스토리 · 관리법 · 정책 · 판매자정보
│   ├── reviews.html              상품 리뷰 ?product=상품아이디 (사진 첨부·인스타 태그 지원)
│   ├── cart.html                 장바구니 + 주문서
│   ├── order-complete.html       주문 접수 완료
│   ├── order-lookup.html         비회원 주문 조회 (주문번호 + 연락처)
│   ├── account.html              회원 로그인·가입, 주문내역, 관리자 패널(role=admin일 때만)
│   ├── return-request.html       반품 · 교환 신청
│   ├── qna.html                  상품 문의(Q&A), 비밀글 지원
│   ├── privacy.html              개인정보처리방침
│   ├── terms.html                이용약관
│   └── assets/
│       ├── css/style.css         디자인 토큰 + 전체 스타일
│       ├── js/data.js         ★  상품·가격·계좌·사업자정보·택배사(COURIERS) (여기만 고치면 됨)
│       ├── js/app.js             공용 런타임 (헤더/푸터/장바구니/참 SVG/시동 진동)
│       ├── js/i18n.js            다국어(한국어/영어/일본어) 엔진
│       ├── js/hoodie.js          스튜디오용 후드집업 벡터 그림
│       ├── js/auth-client.js     회원 로그인 세션 공용 헬퍼 (Supabase JS 지연 로드)
│       └── img/                  로고 3종 + 제품컷 5종 (WebP)
│
├── server/                       (선택) Node.js 백엔드 — 12번 참고
│   ├── package.json
│   ├── server.js                 정적 사이트 서빙 + 주문/리뷰/반품/관리자 API
│   ├── .env.example              복사해서 .env로 채울 환경변수 템플릿
│   ├── lib/
│   │   ├── supabase.js           service role 클라이언트
│   │   ├── auth.js               requireAuth / optionalAuth / requireAdmin 미들웨어
│   │   ├── mailer.js             Resend로 주문 알림 메일 발송(관리자용 + 고객용 접수/입금확인 메일)
│   │   ├── cloudinary.js         리뷰 · 상품 · 룩북 사진 업로드(업로드 즉시 리사이즈 + 포맷/화질 자동 최적화)
│   │   ├── pricing.js            가격 재계산(priceItem) · 배송비(shippingFor) · 주문번호(orderNo) — 순수 함수, 단위 테스트 대상
│   │   ├── products.js           상품 DTO 변환 · 관리자 입력값 검증 — 순수 함수, 단위 테스트 대상
│   │   ├── lookbook.js           룩북 DTO 변환 · 관리자 입력값 검증 — 순수 함수, 단위 테스트 대상
│   │   └── pagination.js         관리자 목록 API 공용 페이지네이션 헬퍼
│   ├── test/                     서버 핵심 로직 단위 테스트 (`npm test`, Node 내장 테스트러너 사용 — 별도 패키지 불필요)
│   └── migrations/
│       ├── 001_init.sql          Supabase 초기 스키마 (SQL Editor에 붙여넣어 실행)
│       ├── 002_reviews_helpful_and_qna.sql   리뷰 공감 수 + Q&A 테이블 (001 다음에 실행)
│       ├── 003_tracking.sql      주문에 택배사·운송장번호 컬럼 추가 (001 다음에 실행)
│       ├── 004_products.sql      상품 테이블 + data.js 상품 8종 시드 (001 다음에 실행, 관리자 상품 관리에 필요)
│       ├── 005_reviews_approval.sql   리뷰에 approved 컬럼 추가 (001 다음에 실행, 리뷰 승인제에 필요)
│       └── 006_lookbook.sql      룩북 테이블 + data.js 룩북 8칸 시드 (001 다음에 실행, 관리자 룩북 관리에 필요)
│
└── 레퍼런스/                     원본 참고 이미지 (건드리지 않음, 후디/후드집업/크롭 후디/로고 폴더)
```

### 의존성

| 항목 | 내용 |
|---|---|
| 프런트 런타임 의존성 | **없음** (프레임워크·번들러·패키지 매니저 모두 불필요) |
| 외부 리소스 | Pretendard 폰트 1개 (jsDelivr CDN) — 실패해도 시스템 폰트로 폴백. `account.html`은 로그인 시에만 Supabase JS를 jsDelivr에서 추가로 불러옴 |
| 브라우저 요구사항 | ES2020, CSS `color-mix()`, `mix-blend-mode`, IntersectionObserver, Web Animations API |
| `server/` 의존성 | Node.js + `express`, `@supabase/supabase-js`, `resend`, `cloudinary`, `multer`, `dotenv` (선택 실행 시에만 필요, [12번](#12-nodejs-백엔드-서버-선택)) |
| `server/` 실행 시 추가로 필요한 것 | Supabase 프로젝트, Resend 계정, Cloudinary 계정 (모두 무료 티어로 충분, [12번](#12-nodejs-백엔드-서버-선택)) |

---

## 3. 파일별 역할

### 3-1. 페이지 (HTML 16개)

모든 페이지는 같은 골격입니다 — `<main>` 안에 페이지 고유 마크업만 두고,
헤더·푸터·상품 카드 같은 반복 요소는 `app.js`가 JS로 그립니다.
페이지 하단 인라인 `<script>`가 그 페이지의 로직을 담당하며, 공통적으로
`applyI18n()` → `renderHeader()` → (페이지 로직) → `renderFooter()` 순서로 부팅합니다.

| 파일 | 역할 | 로드하는 JS |
|---|---|---|
| `index.html` | 홈. 히어로 → 마퀴 → 리플렉티브 설명 → 컬렉션 그리드 → 스튜디오 프로모 → 룩북 티저 | data, i18n, app |
| `shop.html` | 전체 상품. 카테고리 칩 필터, 선택 상태를 URL(`?cat=`)과 동기화 | data, i18n, app |
| `product.html` | 상품 상세. `?id=`로 상품을 찾아 갤러리·옵션·아코디언(제품정보/사이즈/세탁/배송)을 통째로 렌더 | data, i18n, app |
| `customizer.html` | **지퍼 참 스튜디오.** 좌: 벡터 미리보기 / 우: 컬러·참·마감·추가아이템·사이즈·수량 / 하단: 참 카탈로그 | data, i18n, app, **hoodie** |
| `charms.html` | 참 8종 + 추가 아이템 2종을 **실물 사진**으로 보여주는 갤러리. 사진 없으면 "사진 준비중" | data, i18n, app |
| `lookbook.html` | `LOOKBOOK` 배열대로 비율 슬롯을 배치. `src`가 없으면 회색 "사진 준비중" 칸 | data, i18n, app |
| `about.html` | 브랜드 스토리, 소재/세탁/프린트 보호, 정책 아코디언(배송·교환·사이즈·판매자정보 + 보호대 사이즈 가이드) | data, i18n, app |
| `reviews.html` | 상품 리뷰. `server/`가 있으면 실제 등록·조회(+사진 첨부·인스타 태그), 없으면 정적 폴백 | data, i18n, app, **auth-client** |
| `cart.html` | 장바구니 + 주문서 폼. 검증 → `/api/order` 시도(재고 차감 포함) → 재고 소진 시 안내, 그 외 실패는 클라이언트 계산으로 폴백 → 완료 페이지 | data, i18n, app, **auth-client** |
| `order-complete.html` | 주문번호 발급 결과, 입금 안내, 주문 내역표, 주문서 원문/복사/mailto | data, i18n, app |
| `order-lookup.html` | 비회원 주문 조회. 주문번호+연락처가 일치하면 상태·배송조회 링크·주문 내역을 보여줌(`/api/orders/lookup`) | data, i18n, app |
| `account.html` | 회원 로그인·가입(Supabase Auth), 로그인 후 내 주문내역(배송조회 링크 포함)·반품신청 링크, 비로그인 시 비회원 주문조회 안내. **role이 admin이면** 전체 주문/CS/재고 관리 패널이 추가로 열림(주문 카드에서 상태 변경 + 택배사/운송장번호 저장) | data, i18n, app, **auth-client** |
| `return-request.html` | 반품·교환 신청 폼(주문번호·연락처·사유). `/api/returns`로 접수, 비회원도 가능 | data, i18n, app, **auth-client** |
| `qna.html` | 상품 문의. 목록 + 작성 폼(비밀글 체크 시 작성자·관리자만 내용 열람), 관리자는 `account.html` 관리자 패널에서 답변 | data, i18n, app, **auth-client** |
| `privacy.html` | 개인정보처리방침 전문 | data, i18n, app |
| `terms.html` | 이용약관 전문 | data, i18n, app |

> `product.html`은 헤더에서 **Shop** 메뉴가 활성으로 표시됩니다(`renderHeader("shop.html")`).
> `charms.html`·`reviews.html`·`cart.html`·`order-complete.html`·`order-lookup.html`·`account.html`·`return-request.html`·`qna.html`·`privacy.html`·`terms.html`은 활성 메뉴가 없습니다(`renderHeader("")`).
> `server/`가 꺼져 있으면 `account.html`은 로그인 기능이, `return-request.html`/`qna.html`은 등록 제출이 안내 문구와 함께 비활성화됩니다(정적 배포는 그대로 동작).

### 3-2. `assets/css/style.css`

디자인 시스템 전체. 섹션 주석으로 나뉘어 있습니다.

```
design tokens  →  base/타이포  →  buttons  →  header(+언어 드롭다운)  →  hero
→  shot(스포트라이트)  →  placeholder  →  marquee  →  sections
→  product grid  →  product detail  →  customizer/studio
→  라이더 사이즈 가이드  →  lookbook  →  cart/forms  →  footer  →  reveal
```

**핵심 토큰** (`:root`에서 관리, `html[data-theme="night"]`이 값만 교체)

| 토큰 | 라이트 | 야간 | 용도 |
|---|---|---|---|
| `--paper` | `#efede7` | `#0c0c0a` | 본문 배경 |
| `--ink` | `#15150f` | `#f2f0e9` | 본문 글자 |
| `--muted` | `#6b6758` | `#9a9585` | 보조 텍스트 (WCAG AA 통과값) |
| `--line` | `#d9d5c9` | `#2a2823` | 경계선 |
| `--plate` | `#fbfaf8` | `#ecebe5` | **제품컷 배경** |

> `--plate`는 아무 값이나 넣으면 안 됩니다. 제품 사진을 `mix-blend-mode: multiply`로
> 합성해서 사진의 흰 배경을 종이색에 녹이는데, 이 값이 곧 "사진의 흰색이 변환될 색"입니다.
> 야간 모드에서도 사진판만 밝게 유지해 어두운 갤러리 속 라이트박스처럼 보이게 했습니다.

`body`에는 `transition: background-color var(--t), color var(--t)`(0.4s)가 걸려 있어서
테마를 바꾸면 팔레트가 부드럽게 페이드됩니다. 이 전환은 `app.js`의 "시동 진동" 애니메이션과
같은 타이밍에 재생됩니다(6번 참고).

### 3-3. `assets/js/data.js` — **운영자가 만지는 유일한 파일**

| 상수 | 내용 |
|---|---|
| `SITE` | 브랜드명, **입금 계좌**, 연락처, **사업자 정보**, 배송비 정책, 주문 수신 엔드포인트 |
| `COURIERS` | 택배사 목록(`key`/`label`/`urlTemplate`). `{tracking}`을 운송장번호로 치환해 조회 페이지 링크를 만듦(사이트 내 실시간 조회는 하지 않음) |
| `COLORS` | 제품 공통 컬러 팔레트 8종 (`key` / `label` / `hex`) |
| `SIZE_TABLES` | 사이즈 실측표 (`hoodie`, `crop`) — 상품 상세와 About에 동시 반영 |
| `PROTECTOR_GUIDE` | 이너 프로텍터 착용 시 권장 사이즈 가이드 (`hoodie`, `crop`). 실측값 칸은 채우기 전까지 빈 문자열 |
| `PRODUCTS` | 상품 8종 (**정적 배포용 폴백**). `server/`가 떠 있으면 페이지가 부팅 시 `/api/products`로 이 배열의 내용을 관리자가 등록·수정한 DB 목록으로 통째로 교체합니다 — 자세한 내용은 [6번](#6-구현-완료된-기능)의 "회원 · 관리자 · CS"와 [12번](#12-nodejs-백엔드-서버-선택) 참고 |
| `CHARM_PRICE` | 참 가격 (현재 0원 — 무료. 무제한 무료 주문 악용 우려로 "참만 담기" 단품 구매는 숨김 처리됨) — 한 곳에서 관리 |
| `FINISHES` | 참 마감 3종 (리플렉티브 실버 / 매트 블랙 / 컬러) |
| `CHARMS` | 참 9종 (없음 + 8개). 각각 SVG path 데이터. `image`를 채우면 `charms.html`에 실물 사진으로 표시 |
| `EXTRA_PRICE` / `EXTRAS` | 추가 아이템(인형·DIY 팔찌 등) 가격(9,000원)과 목록 — 벡터가 아닌 실물 사진(`image`)으로만 보여주는 add-on |
| `LOOKBOOK` | 룩북 슬롯 8칸 (span / ratio / label / note / src) — **정적 배포용 폴백**. `server/`가 떠 있으면 `PRODUCTS`와 마찬가지로 `/api/lookbook`이 관리자가 등록·수정한 DB 목록으로 통째로 교체함 |
| `REVIEWS` | 정적 배포용 리뷰 폴백 목록 (서버가 없을 때만 사용, 기본은 빈 배열 — 가짜 후기 금지) |

파일 끝에 `module.exports`가 있어서 `server/server.js`가 **같은 파일을 그대로** `require()`합니다.
브라우저에는 `module`이 없으므로 이 한 줄은 프런트 동작에 아무 영향이 없습니다.

### 3-4. `assets/js/app.js` — 공용 런타임

전 페이지가 로드합니다(`data.js`, `i18n.js` 다음). 전역에 아래 함수/객체를 노출합니다.

**유틸**

| 이름 | 설명 |
|---|---|
| `$(sel)` / `$$(sel)` | querySelector / querySelectorAll(배열) |
| `money(n)` | 언어에 따라 `"89,000원"`(ko) 또는 `"₩89,000"`(en/ja)로 포맷 |
| `esc(s)` | **HTML 이스케이프.** 화면에 문자열을 넣을 땐 반드시 통과시킬 것 (XSS 방어) |
| `qs(key)` | URL 쿼리 파라미터 읽기 |
| `getProduct(id)` / `getCharm(key)` / `getFinish(key)` | 데이터 조회 |
| `uid()` | 장바구니 아이템 고유키 생성 |
| `loadProducts()` | `/api/products`가 있으면 그 응답으로 `PRODUCTS` 배열 내용을 통째로 교체(`await`로 렌더 전에 호출). 실패하거나 서버가 없으면 `data.js`의 정적 목록이 그대로 남음 — 상품을 그리는 페이지(`index`/`shop`/`product`/`customizer`/`reviews`/`qna`)는 부팅 스크립트 맨 앞에서 이걸 기다린 뒤 렌더함 |
| `loadLookbook()` | 같은 방식으로 `/api/lookbook` 응답으로 `LOOKBOOK` 배열을 교체. `index`(룩북 티저)와 `lookbook.html`이 렌더 전에 기다림 |

**테마 + 시동 진동** — `applyTheme("light"|"night")`, `initTheme()`. `localStorage.reiten_theme`에 유지.
헤더의 `.js-theme` 버튼을 누르면 `applyTheme()` 직후 `kickEngine()`이 실행되어, `<html>` 전체가
바이크 시동을 거는 듯한 560ms짜리 3단 진동(크랭크 → 캐치·레브 → 아이들)을 탑니다. 밝기(`filter`)도
같은 타이밍에 살짝 흔들려 점화되는 느낌을 더합니다. `prefers-reduced-motion`이면 자동으로 생략됩니다.

**장바구니** — `Cart` 객체. `localStorage.reiten_cart_v1`에 저장.

| 메서드 | 설명 |
|---|---|
| `Cart.read()` / `write(items)` | 원본 배열 읽기/쓰기 |
| `Cart.add(item)` | `sig`가 같으면 수량 합산, 다르면 새 줄 추가 |
| `Cart.setQty(key, n)` / `Cart.remove(key)` / `Cart.clear()` | 수량·삭제·비우기 |
| `Cart.count()` | 총 수량 (헤더 배지) |
| `Cart.subtotal()` / `shipping()` / `total()` | 금액 계산. 배송비는 `SITE.shipping` 기준 자동 |
| `Cart.paint()` | 헤더 배지 갱신 (모든 변경 후 자동 호출) |

**UI**

| 이름 | 설명 |
|---|---|
| `renderHeader(activeHref)` | 상단 헤더 + 언어 드롭다운 + 모바일 메뉴 주입. 인자로 넘긴 파일명이 활성 메뉴 |
| `renderFooter()` | 푸터 주입. `SITE.biz` / `SITE.order` 값을 그대로 노출 |
| `productCard(p, delay)` | 상품 카드 HTML 문자열 반환 (홈·목록·추천에서 공용) |
| `charmSVG(charmKey, finishKey, opts)` | 참 SVG 문자열 생성. 실버는 `.reflective`(강한 발광), 컬러는 `.reflective-soft`(은은한 발광) 클래스 부여 |
| `rideGuideHTML(sizeTableKey)` | `PROTECTOR_GUIDE`를 사이즈 아코디언용 HTML로 렌더 (`about.html`, `product.html`에서 사용) |
| `toast(msg)` | 하단 알림 |
| `initReveal()` | 스크롤 등장 애니메이션 (+1.5초 안전장치로 반드시 표시) |
| `initBeams(root)` | 제품컷 위 커서 스포트라이트 |

> DOM을 새로 그린 뒤에는 `initReveal()` / `initBeams()`를 다시 호출해야 합니다.

### 3-5. `assets/js/i18n.js` — 다국어 엔진

한국어 원문 자체를 딕셔너리 키로 쓰는 방식입니다. `ko` 상태에서는 아무것도 치환하지 않고
마크업 그대로 보여주고, `en`/`ja`일 때만 `I18N` 딕셔너리에서 번역을 찾습니다(없으면 한국어로 폴백).

| 이름 | 설명 |
|---|---|
| `getLang()` / `setLang(lang)` | 현재 언어 읽기 / 변경(변경 시 `location.reload()`로 전체 페이지 재적용) |
| `t(key, vars?)` | 번역 조회. `vars`로 `{placeholder}` 치환 (예: `t("{n}개 선택", {n: 2})`) |
| `applyI18n(root?)` | 정적 HTML의 `data-i18n` / `data-i18n-html` / `data-i18n-attr` 요소를 일괄 치환. 각 페이지 스크립트 맨 앞에서 한 번 호출 |
| `LANGS` / `LANG_LABEL` | 지원 언어 목록(`ko`,`en`,`ja`)과 헤더 드롭다운에 쓰는 표시 이름 |

- 정적 텍스트: `<h1 data-i18n="한국어 원문">한국어 원문</h1>`
- HTML 태그가 섞인 텍스트: `data-i18n-html` 속성 추가
- 속성 번역: `data-i18n-attr="aria-label:키|placeholder:다른 키"`
- JS로 그리는 문자열은 `t("...")`를 직접 호출

새 언어(독일어 등)를 추가하려면 `I18N`의 각 항목에 `de: "..."`만 채우고 `LANGS`/`LANG_LABEL`에
`"de"`를 더하면 됩니다.

### 3-6. `assets/js/hoodie.js` — 스튜디오 벡터 그림

`hoodieSVG({ colorHex, charmKey, finishKey })` → SVG 문자열.

- 좌표계: `viewBox="100 46 600 660"` (원 설계 좌표는 800×820 기준, 여백을 잘라낸 값)
- 레이어 순서: 후드 뒤판 → 소매 → 몸판 → **소매 옆선(몸판 위)** → 밑단 립 → 주머니 → 칼라 → 지퍼 → 소매 로고 → 참
- 소매는 몸판 **아래**에 그리고 옆선만 위에 얹습니다. 그래야 소매가 앞으로 나와 보입니다.
- 원단 색은 `colorHex` 하나로 통일하고, 음영은 전부 `rgba(0,0,0,x)` / `rgba(255,255,255,x)` 오버레이라
  **어떤 색을 넣어도 자동으로 자연스럽게 보입니다.**
- **지퍼 하드웨어(슬라이더·고리·연결선) 색은 `zipperHardwareFill(finishKey, charmKey)`가 결정합니다** —
  실버는 금속 그라디언트, 블랙은 어두운 금속 그라디언트, 컬러는 참의 `accent` 색을 그대로 씁니다.
  참이 "없음"이면 항상 실버 금속.
- CSS 클래스로 야간 연출을 제어합니다.

| 클래스 | 야간(`.stage.dark`)일 때 |
|---|---|
| `.fabric` | `brightness(0.3)` — 옷이 어둠에 묻힘 |
| `.hardware` | `brightness(0.42)` — 지퍼·라벨도 어두워짐 |
| `.reflective` | `url(#glow) brightness(1.5)` — **참(실버 마감)·소매 로고 강하게 발광** |
| `.reflective-soft` | `url(#glow) brightness(1.15) saturate(1.3)` — **참(컬러 마감) 은은하게 발광** |
| `.beam-bg` | 헤드라이트 형태의 방사형 그라디언트 등장 |

| 상수 | 값 | 의미 |
|---|---|---|
| `SLIDER_Y` | 300 | 지퍼 슬라이더 상단 y좌표 |
| `RING_Y` | 340 | 슬라이더 고리 중심 (참이 여기 매달림) |
| `CHARM_W` | 62 | 참 렌더 폭 |

### 3-7. `server/server.js` — Node 백엔드 (선택)

`express`로 짠 서버. `소스 코드/`를 정적으로 서빙하면서 아래 API를 추가로 제공합니다. 데이터는
`server/orders.json`/`reviews.json` 같은 파일이 아니라 **Supabase(Postgres)** 에 저장됩니다 — 동시에
여러 주문이 들어와도 재고가 꼬이지 않도록 하기 위함입니다(8번의 재고 동시성 항목 참고).
자세한 배경과 실행 방법은 [12번](#12-nodejs-백엔드-서버-선택) 참고.

| 엔드포인트 | 인증 | 설명 |
|---|---|---|
| `GET /api/products` | 없음 | 공개 상품 목록(`active=true`만). `products` 테이블 조회가 실패하면(예: 004 마이그레이션 미실행) `data.js`의 정적 `PRODUCTS`로 자동 폴백 |
| `GET /api/lookbook` | 없음 | 공개 룩북 목록(`active=true`만). `lookbook` 테이블 조회가 실패하면(예: 006 마이그레이션 미실행) `data.js`의 정적 `LOOKBOOK`으로 자동 폴백 |
| `POST /api/order` | 선택(로그인 시 주문에 연결) | `{ customer, items }`을 받아 `productId`/`charm`/`extras`만으로 서버에서 가격을 재계산(상품 가격은 `products` 테이블 기준), `decrement_inventory` RPC로 재고를 원자적으로 차감(부족하면 `409 OUT_OF_STOCK`), `orders` 테이블에 저장, Resend로 **관리자 알림 메일 + 고객 주문접수 확인 메일**을 각각 발송(둘 다 실패해도 주문은 성공 처리) |
| `GET /api/config` | 없음 | 브라우저가 Supabase 클라이언트를 초기화할 `supabaseUrl`/`supabaseAnonKey` 반환 |
| `POST /api/orders/lookup` | 없음 | 비회원 주문 조회. `{ orderNo, tel }`이 저장된 주문과 일치할 때만 상태·배송정보·내역을 반환(연락처는 숫자만 비교). 불일치 시 어느 쪽이 틀렸는지 알려주지 않고 `404` |
| `GET /api/my/orders` | 로그인 필요 | 로그인한 회원 본인의 주문내역(배송정보 포함) |
| `POST /api/returns` | 선택 | 반품·교환 신청 접수(비회원도 가능) |
| `GET/PATCH /api/admin/orders`, `/api/admin/returns` | **관리자만**(role=admin) | 전체 주문/반품신청 조회 및 상태 변경(**목록은 페이지네이션**, 아래 참고). 주문 `PATCH`는 `status`와 `courier`/`trackingNo`(택배사·운송장번호)를 함께 또는 따로 받으며, **`status`가 정확히 `"입금확인"`으로 바뀌는 순간에만** 고객에게 입금 확인 메일을 발송 |
| `GET/PATCH /api/admin/inventory` | **관리자만**(role=admin) | 재고 수량 조회·수정 |
| `GET/POST /api/reviews` | 없음 | 리뷰 조회(승인된 것만, 아래 참고), 등록(사진 첨부 시 Cloudinary 업로드 후 `photoUrl` 저장, 인스타 아이디는 `instagramHandle`로 저장 — `reviews.html`이 `https://instagram.com/{아이디}` 링크로 렌더). 새로 등록된 리뷰는 승인 전까지 이 목록에 보이지 않음 |
| `POST /api/reviews/:id/helpful` | 없음 | 리뷰 "도움돼요" 카운트를 원자적으로 +1(`increment_helpful` RPC). 중복 클릭 방지는 브라우저 `localStorage`(`reiten_liked_reviews`) 기준이라 완벽하진 않음 |
| `GET /api/admin/reviews`, `PATCH/DELETE /api/admin/reviews/:id` | **관리자만**(role=admin) | **리뷰 승인 큐**(목록은 페이지네이션). `GET`은 승인 대기 중인 리뷰가 먼저 오도록 정렬해서 전부 반환. `PATCH`로 `{ approved: true/false }`를 보내 승인·숨김을 전환, `DELETE`로 스팸 리뷰를 영구 삭제 |
| `GET/POST /api/qna` | 선택 | 상품 문의 조회·등록. 비밀글(`secret:true`)은 작성자 본인(로그인 시) 또는 관리자가 아니면 `question`/`answer`가 `null`로 가려져서 내려감 |
| `GET/PATCH /api/admin/qna` | **관리자만**(role=admin) | 전체 문의 조회(비밀글 포함, **목록은 페이지네이션**), 답변 등록 시 상태가 자동으로 `답변완료`로 바뀜 |
| `GET/POST /api/admin/products`, `PATCH/DELETE /api/admin/products/:id` | **관리자만**(role=admin) | 상품 등록·수정·삭제(**목록은 페이지네이션**). `GET`은 비공개(`active=false`) 상품도 포함해 전부 반환. `DELETE`는 영구 삭제이며 해당 상품의 `inventory` 행도 함께 정리(주문에는 항목이 스냅샷으로 저장돼 있어 과거 주문 내역에는 영향 없음) |
| `POST /api/admin/products/photo` | **관리자만**(role=admin) | 상품 사진 한 장을 Cloudinary에 업로드(업로드 시 최대 1800px로 자동 리사이즈 + 포맷/화질 최적화)하고 `{ url }` 반환(5MB 이하 이미지만). 관리자 패널이 이 URL을 상품의 `images` 배열에 채워 넣은 뒤 `POST`/`PATCH /api/admin/products`로 저장 |
| `GET/POST /api/admin/lookbook`, `PATCH/DELETE /api/admin/lookbook/:id` | **관리자만**(role=admin) | 룩북 칸 등록·수정·삭제(**목록은 페이지네이션**). `GET`은 비공개(`active=false`) 칸도 포함해 전부 반환 |
| `POST /api/admin/lookbook/photo` | **관리자만**(role=admin) | 룩북 사진 한 장을 Cloudinary에 업로드(최대 2000px로 자동 리사이즈 + 포맷/화질 최적화)하고 `{ url }` 반환(5MB 이하 이미지만). 관리자 패널이 이 URL을 해당 칸의 `src`에 채워 넣은 뒤 `POST`/`PATCH /api/admin/lookbook`으로 저장 |

> **관리자 목록 페이지네이션**: `/api/admin/orders`, `/api/admin/returns`, `/api/admin/qna`, `/api/admin/products`, `/api/admin/reviews`, `/api/admin/lookbook`은
> `?page=`(1부터)와 `?pageSize=`(기본 20, 상품·룩북은 50, 최대 100) 쿼리를 받고 `{ items, page, pageSize, total }` 형태로 응답합니다.
> 관리자 패널은 처음엔 1페이지만 불러오고, "더 보기" 버튼을 누르면 다음 페이지를 이어서 불러와 화면에 계속 붙입니다.

가격 계산 로직(`server/lib/pricing.js`의 `priceItem()`)과 배송비 계산(`shippingFor()`)은 프런트의
`Cart.subtotal()`/`shipping()`과 같은 규칙을 서버에서 다시 구현한 것입니다 — 둘 중 하나만 고치면 값이
어긋나니, 배송비 정책이나 가격 체계를 바꿀 땐 `data.js`(원천 데이터)만 고치고 계산식은 그대로 두면
됩니다. `priceItem`/`shippingFor`와 상품 DTO 변환(`server/lib/products.js`)은 Supabase 없이 단위
테스트가 가능하도록 `server.js`에서 분리해 두었고, `server/test/`에 테스트가 있습니다(`cd server && npm test`).

인증은 브라우저가 Supabase 세션의 JWT를 `Authorization: Bearer` 헤더로 보내면 `server/lib/auth.js`의
`requireAuth`/`requireAdmin`이 매 요청마다 다시 검증합니다 — "관리자 패널이 안 보인다"는 프런트 UI일 뿐,
실제 데이터 접근 권한은 항상 서버가 재확인하므로 개발자도구로 우회할 수 없습니다.

### 3-8. `assets/img/`

| 파일 | 출처 | 비고 |
|---|---|---|
| `logo-wordmark.png` | 원본 로고에서 워드마크만 크롭 | 흰 배경을 알파로 제거한 투명 PNG. 헤더용 |
| `logo-mark.png` | 말+바이크 심볼만 크롭 | 파비콘용 |
| `logo-lockup.png` | 워드마크+심볼 | About 히어로 / 푸터용 |
| `hoodie-heart.webp` | `hoodie-heart.png`(원본, 백업용 보관) | 리플렉트 하트 후디 (블랙) |
| `hoodie-heart-khaki.webp` | `레퍼런스/후디/1A0ECF9B-*.png` | 리플렉트 하트 후디 (워시드 카키) |
| `hoodie-heart-yellow.webp` | `레퍼런스/후디/62BD6B15-*.png` | 리플렉트 하트 후디 (머스타드 옐로우) |
| `hoodie-exhaust.webp` | `hoodie-exhaust.png`(원본, 백업용 보관) | 리플렉트 이그저스트 후디 (블랙) |
| `hoodie-exhaust-yellow.webp` | `레퍼런스/후디/IMG_0925.PNG` | 리플렉트 이그저스트 후디 (머스타드 옐로우) |
| `zip-charcoal.webp` | `zip-charcoal.jpg`(원본, 백업용 보관) | 헬멧 집업 |
| `zip-blue.webp` / `zip-green.webp` | `zip-blue.jpg`/`zip-green.jpg`(원본, 백업용 보관) | 코어 집업 |
| `crop-forest.webp` | `레퍼런스/크롭 후디/e7da7a6d-*.jpeg` | 리플렉트 크롭 집업 후디 (포레스트) |

> 로고 3종은 흑백 JPEG의 **밝기를 알파 채널로 변환**해 만들었습니다.
> 덕분에 배경색이 무엇이든 깨끗하게 얹히고, 야간 모드에서는 CSS `invert(1)`로 흰색이 됩니다.
>
> 제품 사진은 전부 WebP로 최적화했습니다(원본 대비 46~96% 용량 감소, 화질 차이 거의 없음).
> 원본 `.png`/`.jpg`는 사이트에서 더 이상 참조하지 않지만 백업용으로 남겨뒀습니다 — 지워도 되고,
> 다시 다른 화질로 뽑아야 할 때를 대비해 남겨두는 편이 안전합니다. 방법은
> [9번의 "이미지 최적화"](#이미지-최적화) 참고.

---

## 4. 데이터 모델

### 4-1. 상품 (`PRODUCTS[]`)

```js
{
  id: "core-zip-hoodie",        // URL에 쓰이는 고유값 (영문·하이픈)
  name: "Core Zip Hoodie",      // 영문명 (아이브로우에 표시)
  nameKo: "코어 집업 후디",       // 한글명 (제목·장바구니에 표시, t()로 번역됨)
  type: "zip",                  // hoodie | zip | crop
  category: "후드집업",           // 목록 필터 버튼이 이 값으로 자동 생성됨
  price: 119000,
  badge: "Customizable",        // 카드/상세의 작은 라벨. 없으면 생략
  images: ["assets/img/zip-blue.webp", "…", null],  // null = 회색 "사진 준비중"
  colors: ["black", "white", "sky"],               // COLORS의 키만 사용(현재 6종: black/white/pink/deepblue/sky/clay)
  sizes: ["XS", "S", "M", "L", "XL"],   // 전 상품 공통 고정값 — 관리자 패널은 이 5개를 체크박스로만 켜고 끔
  soldOut: ["S"],               // 품절 사이즈 — 상세에서 취소선+비활성
  sizeTable: "hoodie",          // SIZE_TABLES / PROTECTOR_GUIDE의 키
  short: "6컬러 · 지퍼 참 커스텀 가능",   // 카드 한 줄 설명
  desc: "…",                    // 상세 본문
  details: ["겉감 : …", "핏 : …"],
  charmReady: true,             // true면 스튜디오 베이스로 선택 가능
}
```

### 4-2. 참 (`CHARMS[]`)

`viewBox 0 0 100 120` 기준 SVG path. 상단 고리는 `hoodie.js`가 따로 그립니다.

```js
{ key: "star", label: "스타", accent: "#f0b429", image: null,
  paths: [{ d: "M50,34 L…Z", role: "main" }] }
```

| `role` | 처리 |
|---|---|
| `main` | 본체. 실버=그라디언트 / 블랙=`#1b1b1f` / 컬러=`accent` |
| `accent` | 어두운 파츠 (헬멧 바이저 등) |
| `leaf` | 컬러 마감일 때만 초록 (체리 잎) |
| `stroke` | 채우기 없이 선만 (체리 줄기) |
| `hole` | SVG 마스크로 뚫림 (말굽 못구멍) |

마감 3종은 자동 생성되므로 따로 만들 필요가 없습니다. `image`를 채우면 `charms.html`에
벡터 대신 실물 사진이 뜹니다.

### 4-3. 추가 아이템 (`EXTRAS[]`)

벡터로 그리지 않고 **실물 사진으로만** 보여주는 add-on(인형·DIY 팔찌 등). 참과 별개로
여러 개 동시 선택 가능하며 스튜디오 합계에 개당 `EXTRA_PRICE`(9,000원)씩 더해집니다.

```js
{ key: "flower-doll", label: "플라워 인형 참", desc: "손뜨개 꽃 인형이 매달리는 참", image: null }
```

### 4-4. 라이더 사이즈 가이드 (`PROTECTOR_GUIDE`)

이너 프로텍터 착용 시 권장 사이즈. `rows`의 마지막 칸(가슴단면 여유분)은 실제 계측 전까지
빈 문자열로 두면 "추후 계측"이라는 안내 텍스트로 표시됩니다.

```js
hoodie: {
  note: "이너 프로텍터(보호대)를 착용하고…",
  head: ["평소 사이즈", "보호대 착용 시 권장", "가슴단면 여유분(cm)"],
  rows: [["S", "M", ""], ["M", "L", ""], ["L", "XL", ""], ["XL", "XL", ""]],
}
```

### 4-5. 장바구니 아이템

```js
{
  key: "u1abc2d",                     // 내부 고유키 (uid())
  sig: "core-zip-hoodie|black|M|star|silver|flower-doll",  // 동일 조합 판별용
  productId: "core-zip-hoodie",
  name: "코어 집업 후디",
  image: "assets/img/zip-blue.webp",  // null이면 charm SVG로 대체 표시
  size: "M",                          // 재고 차감용 원본 사이즈 값(참만 담기에는 없음)
  charm: { key: "star", finish: "silver" } | null,
  extras: ["flower-doll"],            // 선택한 EXTRAS 키 배열 (없으면 [])
  unit: 133900,                       // 상품가 + 참 가격 + 추가 아이템 합
  qty: 1,
  opts: [ { label: "컬러", value: "블랙" }, … ],   // 화면·주문서에 그대로 출력
}
```

### 4-6. 주문 객체 (`localStorage.reiten_last_order` / Supabase `orders` 테이블)

`cart.html` 제출 시 같은 출처의 `/api/order`가 있으면 서버가 이 객체를 **재계산해서** 그대로
돌려주고(`sent: true`, 재고까지 차감), 없으면 클라이언트가 계산한 값을 그대로 씁니다.
서버가 있을 때는 `status`(입금대기 → 입금확인 → 배송중 → 완료/취소)도 함께 저장되며,
관리자 패널(`account.html`)에서 바꿀 수 있습니다.

```js
{
  no: "R260801-6041",                 // R + YYMMDD + 4자리 난수
  at: "2026-08-01T10:23:00.000Z",
  customer: { name, tel, email, zip, addr, addr2, memo, payer },
  items: [ { name, options, qty, unit, sum } ],
  subtotal, shipping, total,
  status: "입금대기",                  // server/ 사용 시에만 존재
  sent: false                         // 서버 검증됨 or formEndpoint 전송 성공 여부
}
```

### 4-7. 리뷰 (`REVIEWS[]` / Supabase `reviews` 테이블)

```js
{
  id: "msb55ennwruh5h",
  productId: "core-zip-hoodie",       // 또는 "general"(전체 상품 대상)
  name: "테스터",
  rating: 4,                          // 1~5 정수
  comment: "핏이 좋아요.",
  photoUrl: "https://res.cloudinary.com/.../review.jpg",  // 사진 미첨부 시 null
  instagramHandle: "reiten_rider",    // 미입력 시 null. "@"는 저장하지 않음
  at: "2026-08-02T01:48:13.811Z",
}
```

### 4-8. localStorage 키

| 키 | 내용 | 수명 |
|---|---|---|
| `reiten_theme` | `"light"` \| `"night"` | 영구 |
| `reiten_lang` | `"ko"` \| `"en"` \| `"ja"` | 영구 |
| `reiten_cart_v1` | 장바구니 배열 | 영구 (주문 완료 시 비움) |
| `reiten_last_order` | 마지막 주문 객체 | 다음 주문 시 덮어씀 |

---

## 5. 화면 흐름

```
                    ┌──────────── index.html (홈)
                    │
      ┌─────────────┼─────────────┬──────────────┬─────────────┐
      ▼             ▼             ▼              ▼             ▼
  shop.html    customizer     lookbook       about        reviews.html
      │         (스튜디오)         │              │              ▲
      ▼             │             │        (사이즈 가이드)         │
 product.html  ──┬───┘             │                              │
      │          │                                                │
      │          ▼                                                │
      │      charms.html (실물 참 갤러리)                          │
      │                                                            │
      └──────────────────────┬─────────────────────────  "리뷰 보기" 링크
                              ▼
                       [ Cart.add() ]  ← localStorage
                              ▼
                        cart.html  ──(검증 실패)──┐
                              │                   │
                        (검증 통과)  ◀─────────────┘
                              ▼
              /api/order 있으면 서버가 가격 재검증 후 응답
              없으면 클라이언트 계산 + formEndpoint 폴백
                              ▼
                   order-complete.html  (주문번호 · 입금안내 · 주문서 복사)
```

---

## 6. 구현 완료된 기능

### 공통

- [x] 빌드 없는 정적 사이트 (16페이지) + 선택적 Node 백엔드
- [x] 반응형 — 모바일 / 태블릿 / 데스크톱, 900px 이하 햄버거 메뉴
- [x] 오프화이트 미니멀 디자인 시스템 (CSS 변수 토큰 기반)
- [x] **야간 주행 모드** — 헤더 토글, `localStorage` 유지, 전 페이지 적용
- [x] **테마 전환 "시동 진동" 애니메이션** — 토글 시 화면 전체가 바이크 시동을 걸듯 짧게 진동 (`prefers-reduced-motion`이면 생략)
- [x] **다국어 (한국어 / English / 日本語)** — 헤더 지구본 아이콘, `localStorage` 유지, 전 페이지 적용. 가격은 언어에 따라 `원`/`₩` 자동 전환
- [x] 헤더·푸터 단일 소스 렌더링 (`app.js` 한 곳만 고치면 전 페이지 반영)
- [x] 스크롤 등장 애니메이션 + 1.5초 안전장치 (관찰이 실패해도 콘텐츠는 반드시 표시)
- [x] `prefers-reduced-motion` 대응 (마퀴·흔들림·리빌·시동 진동 정지)
- [x] XSS 방어 — 화면에 들어가는 모든 동적 문자열 `esc()` 처리

### 브랜드 연출

- [x] **제품컷 커서 스포트라이트** — 마우스를 따라 빛이 움직이며 리플렉티브 프린트가 번쩍임
- [x] **스튜디오 라이트 스위치** — 야간 주행 상황 재현, 옷은 어둠에 묻히고 참·로고만 발광 (실버 마감은 강하게, 컬러 마감은 은은하게 발광 · 매트 블랙은 무광 유지)
- [x] 실버 크롬 그라디언트 텍스트(`.sheen`) — 라이트/야간 각각 다른 팔레트
- [x] 제품컷 multiply 합성 — 사진의 흰 배경이 종이색에 자연스럽게 녹음
- [x] 브랜드 마퀴 스트립

### 쇼핑

- [x] 상품 목록 + 카테고리 필터, 선택 상태 URL 동기화 (`?cat=`)
- [x] 상품 상세 — 썸네일 갤러리, 컬러/사이즈/수량, **품절 사이즈 자동 비활성**
- [x] 아코디언 (제품 정보 / 사이즈 실측 + 보호대 착용 가이드 / 세탁·관리 / 배송·교환)
- [x] 사진 없는 상품 → 회색 "사진 준비중" 플레이스홀더 자동 전환
- [x] 함께 보면 좋은 상품 추천
- [x] 상품 상세 → 리뷰 페이지 바로가기 링크

### 지퍼 참 스튜디오 ★

- [x] 후드집업 **벡터 일러스트** — 컬러를 바꾸면 음영까지 자동으로 따라감
- [x] 베이스 상품 2종 · 컬러 6종 · 참 9종(없음 포함) · 마감 3종 · 사이즈 · 수량
- [x] 선택 즉시 지퍼 슬라이더에 참이 매달리고 좌우로 흔들림
- [x] **지퍼 하드웨어 색이 참 마감(리플렉티브 실버 / 매트 블랙 / 컬러)을 따라감**
- [x] **추가 아이템(인형·DIY 팔찌 등)** — 참과 별개로 여러 개 동시 선택 가능, 개당 9,000원
- [x] 실시간 금액 합산 (상품가 + 참 가격 + 추가 아이템 × 수량)
- [x] **고른 조합이 그대로 장바구니 옵션과 주문서에 기록됨**
- [x] ~~참 단품 구매 ("참만 담기")~~ — 참이 무료(0원)가 되면서 무제한 무료 주문 악용 우려로 현재는 UI에서 숨김 처리(코드는 남아있어 필요시 재활성화 가능)
- [x] 참 카탈로그 8종 — 클릭하면 스튜디오에 적용되고 위로 스크롤
- [x] **참 갤러리(`charms.html`)** — 벡터가 아닌 실물 사진 전용 페이지 (촬영되는 대로 채움)

### 주문

- [x] 장바구니 — localStorage 영속, 수량 변경/삭제, 헤더 배지 실시간 갱신
- [x] 배송비 자동 계산 (`SITE.shipping` 기준, 10만원 이상 무료)
- [x] 무료배송까지 남은 금액 안내
- [x] 주문서 폼 검증 — 이름/연락처/이메일/우편번호/입금자명/주소/개인정보 동의
- [x] 필드별 에러 메시지 + 첫 오류 필드로 포커스 이동
- [x] 주문번호 자동 발급 (`R260801-6041` 형식, 서버 있으면 서버가 발급)
- [x] 주문 완료 — 입금 안내, 주문 내역표, 주문서 원문 / 복사 버튼 / mailto 링크
- [x] 주문서 자동 전송 훅 (`SITE.order.formEndpoint`)
- [x] **`server/`가 떠 있으면 가격을 서버에서 재검증** ([12번](#12-nodejs-백엔드-서버-선택)) — 없으면 자동 폴백
- [x] **동시 주문 시 재고 원자적 차감** — Supabase `decrement_inventory` 트랜잭션으로 처리, 부족하면 주문서를 비우지 않고 안내
- [x] **주문 접수 시 관리자 알림 메일 자동 발송** (Resend, `ADMIN_NOTIFY_EMAIL`)
- [x] **고객 대상 주문 알림 메일 2단계 발송** (Resend) — ①`/api/order` 접수 즉시 "주문 접수 확인" 메일, ②관리자가 주문 상태를 "입금확인"으로 바꾸는 순간 "입금 확인" 메일. 고객이 이메일을 입력하지 않았거나 `RESEND_API_KEY`가 없으면 조용히 건너뜀
- [x] **비회원 주문 조회(`order-lookup.html`)** — 주문번호 + 연락처(숫자만 비교)로 상태·주문내역·배송조회 링크 확인. 회원가입 없이도 가능
- [x] **배송 조회 링크** — 관리자 패널에서 택배사(`COURIERS`)와 운송장번호를 입력하면, 고객 주문내역/주문조회 페이지에 해당 택배사 조회 페이지로 바로 연결되는 링크가 뜸(사이트 내 실시간 위치 조회는 하지 않음)

### 회원 · 관리자 · CS (`server/` 필요)

- [x] 회원가입 · 로그인 (Supabase Auth, `account.html`)
- [x] 로그인 시 본인 주문내역 조회
- [x] **관리자(role=admin) 로그인 시에만 열리는 숨김 패널** — 전체 주문 조회/상태 변경, 반품·교환 신청 조회/상태 변경, 재고 수량 조회/수정, Q&A 답변, 상품 관리, 리뷰 승인, 룩북 관리. UI를 숨기는 것과 별개로 서버가 매 요청마다 권한을 재검증
- [x] **관리자 로그인 시각적 표시** — role=admin이면(특정 계정이 아니라 전원 공통) `account.html`이 초록 배지·"(Admin)" 인사말·초록(grass) 테마·로밍 말 애니메이션으로 바뀜. `/api/admin/orders` 호출이 실제로 성공했을 때만 켜져서(단순 `profile.role` 값만 믿지 않음) 서버 판단과 어긋나지 않음
- [x] **관리자 목록 페이지네이션** — 주문/반품/Q&A/상품/리뷰 목록은 서버가 페이지 단위로 나눠 보내고, 관리자 패널에서 "더 보기"로 다음 페이지를 이어서 불러옴(목록이 아무리 쌓여도 관리자 패널이 느려지지 않음)
- [x] **관리자 패널 — 상품 관리** — 상품 등록·수정·삭제, 사진 업로드(최대 4장, Cloudinary)를 관리자 패널에서 바로 처리. `products` 테이블에 저장되며 저장 즉시 `shop.html`/`product.html`/스튜디오 등 모든 페이지에 반영됨(`data.js`의 `PRODUCTS`는 정적 배포 시의 폴백으로만 남음) — 자세한 내용은 [12번](#12-nodejs-백엔드-서버-선택) 참고
- [x] 반품 · 교환 신청(`return-request.html`) — 비회원도 신청 가능, 로그인 시 이름 자동 채움
- [x] **상품 Q&A(`qna.html`)** — 비회원도 문의 가능, 비밀글 체크 시 작성자·관리자만 내용 열람, 관리자가 답변하면 상태가 자동으로 바뀜

### 콘텐츠

- [x] 룩북 레이아웃 8칸 — 비율별 슬롯, `src` 넣으면 자동으로 사진으로 전환
- [x] **관리자 패널 — 룩북 관리** — 칸 추가·수정·삭제, 사진 업로드(Cloudinary)를 관리자 패널에서 바로 처리. `lookbook` 테이블에 저장되며 저장 즉시 `lookbook.html`과 홈 화면 티저에 반영됨(`data.js`의 `LOOKBOOK`은 정적 배포 시의 폴백으로만 남음)
- [x] About — 브랜드 스토리, 재귀반사 원리 설명, 소재/세탁/프린트 보호
- [x] 정책 아코디언 — 배송, 교환·반품, 사이즈 선택(+보호대 착용 가이드), 판매자 정보
- [x] **상품 리뷰(`reviews.html`)** — `server/`가 있으면 실제 등록·조회, 없으면 정적 폴백(빈 목록, 등록 폼 숨김)
- [x] **리뷰 승인제** — 새로 등록된 리뷰는 관리자가 관리자 패널의 "리뷰" 탭에서 승인하기 전까지 공개 목록에 노출되지 않음(스팸·부적절한 사진 방지). 승인/숨김 전환과 삭제 모두 가능
- [x] **리뷰 사진 첨부** (Cloudinary 업로드, 업로드 시 최대 1600px로 자동 리사이즈 + 포맷/화질 최적화) + **인스타그램 아이디 태그** — 카드에서 클릭하면 실제 인스타그램으로 새 탭 이동(아이콘 + "인스타그램에서 보기" 라벨로 클릭 가능함을 명시)
- [x] **리뷰 정렬**(최신순/별점 높은순/별점 낮은순/인기순) + **공감(도움돼요) 버튼** — 브라우저 `localStorage`로 중복 공감 방지

### 접근성 · SEO 기초

- [x] `aria-pressed` / `aria-current` / `aria-expanded` / `aria-invalid` / `aria-label`
- [x] `:focus-visible` 아웃라인, 시맨틱 헤딩 구조, 모든 이미지 `alt`
- [x] **"본문으로 건너뛰기" 스킵링크** — 키보드·스크린리더 사용자가 헤더 메뉴를 매번 거치지 않고 본문(`#main`)으로 바로 이동. 평소엔 화면 밖에 숨어 있다가 Tab으로 포커스되면 나타남
- [x] 본문 텍스트 대비 WCAG AA 통과 (라이트·야간 양쪽)
- [x] 페이지별 `<title>` / `description`, 홈 OG 태그
- [x] 장바구니·주문완료 `noindex`

---

## 7. 미완성 · 앞으로 할 일

### 🔴 오픈 전 반드시 (법적 · 필수)

> 아래 항목은 대부분 완료됐습니다(최신 상태는 [0번 섹션](#0-현재-배포-상태-다음-작업-전에-이-섹션부터-읽으세요) 참고). 남은 건 카카오·인스타 자리표시자뿐입니다.

| 항목 | 현재 상태 |
|---|---|
| **사업자 정보** | ✅ 완료 — `data.js`의 `SITE.biz` 전부 채움 |
| **입금 계좌 · 이메일** | ✅ 완료 — `SITE.order` 채움 |
| **개인정보처리방침 / 이용약관** | ✅ 완료 — `privacy.html`, `terms.html` 작성 및 배포(Claude 초안이라 법률 자문은 아님) |
| 카카오톡 채널 · 인스타그램 계정 | ❌ 미완료 — `SITE.order.kakao` / `SITE.order.instagram` 아직 자리표시자(채널·계정 개설 후 교체 필요) |

> ⚠️ 통신판매업 신고 전, 또는 사업자 정보 미표기 상태로 판매하면 **전자상거래법 위반**입니다.
> (현재는 신고 완료 · 정보 표기 완료 상태입니다 — 실제 운영 방식이 바뀌면 갱신하세요.)

### 🟠 오픈 전 (콘텐츠 · 사용성)

| 항목 | 현재 상태 |
|---|---|
| 신규 후디 3종(레이튼 워드마크 · 스타 · 플레임 핸드) 사진 | 없음 — 회색 플레이스홀더(`badge: "Coming"`) |
| 룩북 사진 8칸 | 아직 실물 사진 없음(비율만 잡힌 회색 칸) — 촬영 후 관리자 패널의 "룩북" 탭에서 바로 업로드하면 됨(코드 수정 불필요) |
| 참 8종 + 추가 아이템 2종 실물 사진 | 없음 — `charms.html`에 자리는 만들어뒀고 SVG 미리보기로 대체 중 |
| **보호대 착용 시 가슴단면 여유분 실측값** | 없음 — `PROTECTOR_GUIDE`에 빈칸으로 자리만 만들어둠, 실측 후 채우기 |
| ~~우편번호 검색~~ | ✅ 완료 — 다음(카카오) 우편번호 API로 검색해서 채우는 방식으로 구현됨(직접 입력 불가) |
| ~~도메인 · 호스팅~~ | ✅ 완료 — GitHub·Render 연결, `reiten.kr`/`www.reiten.kr` 도메인 연결 및 SSL 발급 완료(0번 섹션 참고) |
| 헬멧 집업 사진 배경 | 완전한 흰색이 아니라 카드 하단에 옅은 경계선이 보임 → 재촬영 또는 배경 보정 |
| 재고 초기값 미입력 | `inventory` 테이블이 비어 있으면 그 상품·사이즈는 항상 재고 0으로 처리되어 주문이 막힘 → `server/migrations/001_init.sql` 하단 예시처럼 실제 재고 수량을 넣거나 관리자 패널에서 채워야 함 |

### 🟡 오픈 직후

- [ ] 주문 자동 수신 연결 (→ [10번](#10-주문-자동-수신-연결))
- [ ] 애널리틱스 — GA4, 네이버 서치어드바이저 등록
- [x] ~~`sitemap.xml`, `robots.txt` 추가~~ — charms.html/reviews.html 포함 완료 (도메인 확정 전까지 `https://reiten.kr` 자리표시자, 13번 참고)
- [ ] OG 대표 이미지 제작 (1200×630) — 카톡·인스타 공유 시 미리보기
- [x] ~~이미지 최적화~~ — 후디 PNG(1.3~1.6MB)·집업 JPG를 WebP로 교체해 46~96% 용량 절감 완료
- [ ] 정사각 파비콘 파일 (`favicon.ico` / `apple-touch-icon.png`) — 현재는 가로로 긴 로고 PNG 사용

### 🟢 나중에 (기능 확장)

| 기능 | 메모 |
|---|---|
| **카드결제(PG)** | 포트원(아임포트) 권장 → [11번](#11-카드결제pg-붙이기) |
| 상품 검색 | 없음 (상품 수가 적어 우선순위 낮음) |
| 실시간 재고 표시 | 지금은 결제 시점에만 재고를 확인·차감함(동시 주문 문제는 해결됨). 상품 상세에서 사이즈별 잔여 수량을 실시간으로 보여주는 건 별도 작업 |
| 위시리스트 | 없음 |
| 쿠폰 · 적립금 | 없음 |
| 참 조합 이미지 저장/공유 | 스튜디오 조합을 이미지로 내려받아 SNS 공유 — 바이럴 포인트 |
| 다국어 추가 (DE 등) | 한국어/영어/일본어는 구현 완료 (6번 참고). 추가 시 `assets/js/i18n.js`의 `I18N`에 언어만 더 채우면 됨 |
| 장바구니 서버 동기화 | 현재 기기·브라우저 단위 |
| 품절 알림 신청 | 없음 |

---

## 8. 알려진 제약과 주의사항

### ⚠️ PG 결제를 붙일 때 반드시 지킬 것

`server/`를 쓰지 않는 정적 배포 상태에서는 **가격 계산이 전부 브라우저에서 일어납니다.**
사용자가 개발자도구로 `unit` 값을 조작하면 임의 금액으로 결제를 시도할 수 있습니다.
결제를 붙이는 순간, **서버(또는 PG 웹훅)에서 상품 ID로 실제 가격을 다시 조회해
결제 금액이 맞는지 검증**해야 합니다. 이 검증 없이는 절대 오픈하지 마세요.
`server/`의 `/api/order`가 이미 이 검증을 하고 있으니, PG를 붙일 때는 그 로직을
그대로 확장하면 됩니다 ([12번](#12-nodejs-백엔드-서버-선택)).

지금처럼 무통장 입금 방식에서는 입금액을 사람이 확인하므로 문제되지 않습니다.

### 그 외

| 제약 | 내용 |
|---|---|
| 데이터 보존 | 장바구니·테마·언어·최근 주문은 브라우저 `localStorage`. 기기나 브라우저가 바뀌면 사라집니다 |
| 폰트 | Pretendard를 jsDelivr CDN에서 불러옵니다. 차단되면 시스템 폰트로 폴백(레이아웃은 유지) |
| 스튜디오 미리보기 | 조합 확인용 **벡터 근사**입니다. 실제 제품의 색상·광택과 차이가 있습니다 (화면에도 명시해 둠) |
| 재고(정적 배포) | `server/` 없이 배포하면 지금도 `data.js`의 `soldOut`(수동 배열)으로만 품절 표시가 됩니다 |
| 재고(server/ 사용 시) | 결제 시점에 Supabase에서 원자적으로 차감되어 동시 주문 문제는 해결됐지만, 상품 상세에 실시간 잔여 수량이 표시되진 않습니다. `inventory` 테이블에 값을 채워두지 않은 상품·사이즈는 재고 0으로 처리되어 주문이 막힙니다 |
| 주문 접수 | `server/`도 `formEndpoint`도 없으면 **고객이 주문서를 직접 보내야** 접수가 완료됩니다 |
| 리뷰 | `server/` 없이 정적 배포만 하면 리뷰 등록이 불가능합니다(조회만, 항상 빈 목록) |
| 브라우저 | `color-mix()`를 씁니다. 2023년 이전 구형 브라우저에서는 일부 색이 어긋날 수 있습니다 |
| 번역 완성도 | UI 전반과 상품 데이터는 번역됐지만, 판매자 정보(사업자명·주소 등)와 주문서 원문(판매자에게 전송되는 텍스트)은 의도적으로 항상 한국어입니다 |

---

## 9. 커스터마이징 가이드

### 상품 추가

`data.js`의 `PRODUCTS` 배열에 [4-1의 형태](#4-1-상품-products)로 항목을 추가하면
홈·목록·상세·추천에 **자동 반영**됩니다. HTML은 건드릴 필요가 없습니다.

- 새 `category` 값을 쓰면 목록의 필터 버튼도 자동으로 생깁니다.
- 사진이 아직 없으면 `images: [null]`로 두세요. 회색 플레이스홀더가 나옵니다.
- 다국어를 쓰려면 `assets/js/i18n.js`의 `I18N`에 `nameKo`/`short`/`desc`/`details` 문자열 그대로를
  키로 삼아 `en`/`ja` 번역을 추가하세요(추가하지 않으면 한국어로 폴백되어 깨지지 않습니다).

### 컬러 추가

```js
const COLORS = {
  …,
  navy: { key: "navy", label: "네이비", hex: "#1e2a44" },
};
```

그다음 상품의 `colors` 배열에 `"navy"`를 추가합니다. 스튜디오 미리보기도 같은 값을 씁니다.

### 사이즈 실측 변경

`SIZE_TABLES`의 숫자만 고치면 상품 상세와 About 페이지에 동시 반영됩니다.

### 보호대 착용 가이드 실측값 채우기

`PROTECTOR_GUIDE.hoodie.rows` / `.crop.rows`의 각 배열 마지막 칸(현재 빈 문자열)에
실제 계측한 가슴단면 여유분(cm)을 문자열이나 숫자로 넣으면, "추후 계측" 대신 그 값이
표시됩니다. `rideGuideHTML()`이 자동으로 렌더링을 처리합니다.

### 참 / 추가 아이템 추가

- **참**: `CHARMS` 배열에 [4-2의 형태](#4-2-참-charms)로 추가합니다. `viewBox 0 0 100 120` 기준이고,
  마감 3종은 자동 생성됩니다. 참 가격은 `CHARM_PRICE` 한 곳에서 관리합니다.
- **추가 아이템**(인형·팔찌 등 실물 전용): `EXTRAS` 배열에 [4-3의 형태](#4-3-추가-아이템-extras)로
  추가합니다. 가격은 `EXTRA_PRICE` 한 곳에서 관리하며, 스튜디오에 자동으로 토글 칩이 생깁니다.
- 둘 다 `image` 필드를 채우면 `charms.html`에 실물 사진으로 표시됩니다. 사진이 없으면
  "사진 준비중" 플레이스홀더가 자동으로 나갑니다.

### 이미지 최적화

이 맥은 `sips`가 WebP를 못 만듭니다(코덱 미설치). 대신 Node.js가 있으니 `sharp` 패키지로
변환하세요 — 화질 손실은 거의 없이 용량만 크게 줄어듭니다. 실제로 이 사이트의 후디 PNG(1.3~1.6MB)를
이 방법으로 WebP로 바꿔서 46~96% 줄였습니다(예: 1.3MB → 54KB).

```bash
mkdir -p ~/imgopt && cd ~/imgopt
npm init -y && npm install sharp
```

```js
// convert.js — 폴더 안의 이미지를 한 번에 변환
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const DIR = "/절대/경로/소스 코드/assets/img";
fs.readdirSync(DIR)
  .filter(f => /\.(png|jpe?g)$/i.test(f))
  .forEach(f => {
    sharp(path.join(DIR, f))
      .webp({ quality: 88 }) // 88 전후가 화질·용량 균형이 좋음
      .toFile(path.join(DIR, f.replace(/\.(png|jpe?g)$/i, ".webp")));
  });
```

```bash
node convert.js
```

- 품질(`quality`)은 80~90 사이에서 조절하세요. 88 정도면 원본과 눈으로 구분이 거의 안 됩니다.
- 변환 후 `data.js`의 `images` 배열과 해당 `<img src>`를 `.webp`로 바꾸면 끝입니다.
- 원본(png/jpg)은 지우지 말고 남겨두세요 — 나중에 다른 화질로 다시 뽑아야 할 때를 대비한 백업입니다.
- 실사 촬영 이미지는 가로 1200~1600px 정도면 충분합니다. 그보다 크게 촬영했다면
  `sharp(...).resize({ width: 1400 })`를 `.webp()` 앞에 추가해 리사이즈도 함께 하세요.

### 룩북 사진 넣기

```js
{ span: "w8", ratio: "16/10", label: "01 — Night Ride", note: "헤드라이트 반사 컷",
  src: "assets/img/look-01.webp" }
```

- `span` : `w4`(1/3) · `w6`(1/2) · `w8`(2/3) · `w12`(전체)
- `ratio` : 그 칸의 가로세로 비율. 사진을 이 비율로 준비하면 잘리지 않습니다.

### 색·여백·타이포 조정

`style.css` 맨 위 `:root` 블록의 토큰만 바꾸면 사이트 전체가 함께 움직입니다.
개별 요소에 하드코딩된 색을 넣지 마세요 — 야간 모드가 깨집니다.

---

## 10. 주문 자동 수신 연결

`server/`를 쓰지 않는다면 기본값은 **고객이 주문서를 복사해 이메일/카카오로 보내는 방식**입니다.
자동으로 받으려면 `SITE.order.formEndpoint`에 받는 주소를 넣으세요.

| 방법 | 설정 |
|---|---|
| **Formspree** | formspree.io에서 폼 생성 → `https://formspree.io/f/xxxxxxx` 붙여넣기 |
| **Google Apps Script** | 스프레드시트 → 확장 프로그램 → Apps Script → JSON POST를 받아 시트에 한 줄 쓰는 웹앱 배포 → 그 URL 붙여넣기 |

값이 들어 있으면 주문서가 자동 전송되고, 완료 화면 문구도 자동으로 바뀝니다.
전송에 실패하면 자동으로 "복사해서 보내기" 안내로 되돌아갑니다.

> `server/`를 함께 띄운 경우 `/api/order`가 우선이라 `formEndpoint`는 호출되지 않습니다
> (12번 참고). 서버와 `formEndpoint`를 동시에 쓸 필요는 없습니다.

---

## 11. 카드결제(PG) 붙이기

1. 사업자등록 · 통신판매업 신고 완료
2. PG사 심사 통과 — **포트원(아임포트)** 을 쓰면 여러 PG를 한 번에 붙일 수 있습니다
3. `cart.html`의 `order-form` submit 핸들러에서 **주문 객체를 만든 직후**에 결제 SDK를 호출하고,
   성공 콜백에서 `order-complete.html`로 이동시킵니다
4. **서버에서 금액을 재검증하세요** (→ [8번 경고](#️-pg-결제를-붙일-때-반드시-지킬-것)) —
   `server/server.js`의 `priceItem()`이 이미 이 역할을 하므로, PG 웹훅에서도 같은 함수를
   재사용해 결제 승인 금액과 대조하면 됩니다

금액 계산은 `Cart.subtotal()` / `Cart.shipping()` / `Cart.total()`(클라이언트)과
`priceItem()` / `shippingFor()`(서버)로 이미 분리돼 있어서 그 값을 그대로 결제 요청에 넘기면 됩니다.

---

## 12. Node.js 백엔드 서버 (선택)

정적 사이트는 그대로 두고, **주문 접수 시 가격·재고를 서버에서 재검증**하고 **회원 로그인 ·
관리자 패널 · 리뷰(사진 포함) · 반품 신청 · 주문 알림 메일**을 처리하는 Express 서버를
`server/` 폴더에 추가했습니다. [8번 경고](#️-pg-결제를-붙일-때-반드시-지킬-것)에서 말한
"결제 붙이기 전 반드시 서버 검증"의 토대이자, 지금 당장은 무통장 입금 주문 접수를
자동화하는 용도로도 쓸 수 있습니다.

이 서버는 파일이 아니라 **Supabase(Postgres + Auth)**, **Resend**(이메일), **Cloudinary**(이미지)라는
세 무료 외부 서비스에 의존합니다. 계정 생성은 자동화할 수 없는 부분이라 아래 순서대로
직접 준비가 필요합니다.

### 준비

1. **Supabase** — [supabase.com](https://supabase.com)에서 무료 프로젝트 생성 → 왼쪽 메뉴 **SQL Editor**에
   [`server/migrations/001_init.sql`](server/migrations/001_init.sql) 전체를 붙여넣고 실행(테이블·인증·재고 차감 함수가 한 번에 만들어집니다)
   → 이어서 [`server/migrations/002_reviews_helpful_and_qna.sql`](server/migrations/002_reviews_helpful_and_qna.sql)도 같은 방식으로 실행
   (리뷰 공감 수 컬럼과 Q&A 테이블을 추가합니다 — 이 파일을 실행하지 않으면 리뷰 공감 버튼과 `qna.html`이 에러를 반환합니다)
   → 이어서 [`server/migrations/003_tracking.sql`](server/migrations/003_tracking.sql)도 같은 방식으로 실행
   (주문에 택배사·운송장번호 컬럼을 추가합니다 — 실행하지 않으면 관리자 패널의 배송정보 저장이 에러를 반환합니다)
   → 이어서 [`server/migrations/004_products.sql`](server/migrations/004_products.sql)도 같은 방식으로 실행
   (상품 테이블을 만들고 `data.js`의 상품 8종을 그대로 시드합니다 — 실행하지 않으면 관리자 패널의 "상품" 탭이 에러를 반환하고, 상품 목록은 `data.js`의 정적 폴백으로만 동작합니다)
   → 이어서 [`server/migrations/005_reviews_approval.sql`](server/migrations/005_reviews_approval.sql)도 같은 방식으로 실행
   (리뷰에 승인 여부 컬럼을 추가합니다 — 실행하지 않으면 새로 등록된 리뷰도 승인 없이 바로 공개됩니다)
   → 이어서 [`server/migrations/006_lookbook.sql`](server/migrations/006_lookbook.sql)도 같은 방식으로 실행
   (룩북 테이블을 만들고 `data.js`의 룩북 8칸을 그대로 시드합니다 — 실행하지 않으면 관리자 패널의 "룩북" 탭이 에러를 반환하고, 룩북 목록은 `data.js`의 정적 폴백으로만 동작합니다)
   → **Project Settings → API**에서 `Project URL`, `anon public` 키, `service_role` 키를 확인
2. **Resend** — [resend.com](https://resend.com) 가입 → API Keys에서 키 발급. 도메인 인증 전에는
   발신 주소를 `onboarding@resend.dev`로 두면 바로 테스트 발송이 됩니다
3. **Cloudinary** — [cloudinary.com](https://cloudinary.com) 가입 → Dashboard에서 `Cloud name` /
   `API Key` / `API Secret` 확인
4. `server/.env.example`을 복사해 `server/.env`를 만들고 위에서 확인한 값을 채웁니다
   (`.env`는 `.gitignore`에 있어 커밋되지 않습니다). 주문 알림을 받을 이메일 주소는
   `ADMIN_NOTIFY_EMAIL`에 넣습니다 — `data.js`의 `SITE.order.email`(사이트 하단에 공개 노출)과는
   별개의, 비공개 내부용 주소입니다
5. **재고 초기값을 채워야 합니다.** `inventory` 테이블이 비어 있으면 모든 상품·사이즈가
   재고 0으로 취급되어 `/api/order`가 전부 `409 OUT_OF_STOCK`을 반환합니다.
   `001_init.sql` 하단 예시처럼 SQL로 채우거나, 서버 실행 후 관리자로 로그인해
   `account.html`의 관리자 패널 → 재고 탭에서 수량을 입력하세요.

### 실행

```bash
cd server
npm install
npm start
```

`http://localhost:3000`에서 사이트가 그대로 뜨고(정적 파일을 서빙), 주문서 제출·리뷰 등록·
회원가입·반품 신청이 모두 실제로 동작합니다.

가격 계산처럼 실수하면 안 되는 핵심 로직은 `server/test/`에 단위 테스트로 남겨뒀습니다.
Supabase 연결 없이 바로 돌아가므로, `data.js`나 `server/lib/pricing.js`·`products.js`를 고친 뒤에는
한 번씩 돌려보는 걸 권장합니다.

```bash
cd server
npm test
```

### 첫 관리자 계정 만들기

1. `account.html`에서 일반 회원가입을 한 번 진행합니다.
2. Supabase 대시보드 **Authentication → Users**에서 방금 가입한 계정의 UUID를 복사합니다.
3. **SQL Editor**에서 아래를 실행합니다.
   ```sql
   update profiles set role = 'admin' where id = '복사한-UUID';
   ```
4. `account.html`에서 다시 로그인하면 "관리자 패널" 섹션이 열립니다 — 일반 회원 계정이나
   비로그인 상태에서는 보이지 않고, 서버도 매 요청마다 `role`을 다시 확인하므로
   개발자도구로 우회할 수 없습니다.

### 동작 방식

- `cart.html`은 제출 시 같은 출처의 `/api/order`를 **먼저** 시도합니다.
- 서버는 클라이언트가 보낸 가격을 신뢰하지 않고, `productId` · `charm.key` · `extras`만으로
  `data.js`의 `PRODUCTS` / `CHARM_PRICE` / `EXTRA_PRICE`를 다시 조회해 금액을 재계산하고,
  Supabase의 `decrement_inventory` 함수로 재고를 한 트랜잭션 안에서 차감합니다 — 두 명이
  동시에 마지막 재고를 주문해도 한쪽만 성공합니다. (개발자도구로 가격을 조작해도 통하지
  않습니다 — 실제로 조작 테스트를 해서 확인했습니다.)
- 검증된 주문은 Supabase `orders` 테이블에 저장되고, 그대로 `order-complete.html`에 표시되며,
  Resend로 `ADMIN_NOTIFY_EMAIL`에 알림 메일이 발송됩니다(발송 실패해도 주문 자체는 성공 처리).
  같은 시점에 고객 이메일로도 "주문 접수 확인" 메일이 발송되고, 이후 관리자가 관리자 패널에서
  주문 상태를 "입금확인"으로 바꾸는 순간 고객에게 "입금 확인" 메일이 한 번 더 발송됩니다
  (`server/lib/mailer.js`의 `sendCustomerOrderReceived` / `sendCustomerPaymentConfirmed`).
- `/api/order`가 없는 환경(Netlify 등 정적 호스팅에 폴더만 올린 경우)에서는 자동으로
  기존 방식(클라이언트 계산 + `SITE.order.formEndpoint`)으로 폴백합니다 — **정적 배포는 그대로 동작합니다.**
- `reviews.html`은 서버가 있으면 `/api/reviews`로 실제 등록·조회를 하고(사진은 Cloudinary에
  업로드), 없으면 `data.js`의 `REVIEWS`(기본 빈 배열)를 보여주며 등록 폼은 자동으로 숨겨집니다.
- `account.html`은 서버가 있어야 로그인·회원가입이 동작합니다(`/api/config`로 Supabase 접속
  정보를 받아옵니다). 없으면 안내 문구만 표시됩니다.
- 상품을 그리는 페이지들은 부팅 시 `/api/products`를 호출해 `data.js`의 정적 `PRODUCTS`를
  `products` 테이블 내용으로 교체합니다. 관리자 패널(`account.html`)의 "상품" 탭에서 등록·수정·
  삭제하면 그 결과가 저장 즉시 반영됩니다. `/api/products`가 없는 환경에서는 자동으로 `data.js`의
  정적 목록을 그대로 씁니다 — **정적 배포는 그대로 동작합니다.**

### 참고

- `server/`는 배포 필수 항목이 아닙니다. 무통장 입금만 쓸 거라면 지금처럼 정적 사이트만
  올려도 충분합니다. 이 서버는 카드결제(PG) 붙일 때, 회원·관리자·반품 접수를 갖추고 싶을 때,
  또는 리뷰를 실제로 받고 싶을 때 쓰세요.
- `server/data.js`를 따로 만들지 않고 `소스 코드/assets/js/data.js`를 그대로 `require()`합니다 —
  상품·가격은 한 곳(`data.js`)에서만 관리하면 됩니다.
- 고객 개인정보(이름·연락처·주소)는 Supabase `orders`/`return_requests` 테이블에 저장됩니다.
  Supabase 프로젝트 접근 권한 관리와 개인정보처리방침을 반드시 갖추세요.
- `reviews` 테이블은 닉네임 · 별점 · 후기 텍스트 · 사진 · 인스타 아이디를 저장합니다(전부
  공개돼도 되는 정보). 새 리뷰는 관리자가 승인하기 전까지 공개 목록에 나오지 않는 승인제가
  적용돼 있어(005_reviews_approval.sql), 관리자 패널의 "리뷰" 탭에서 검수 후 노출하면 됩니다.
- Netlify/Vercel 같은 정적 호스팅에는 `server/`가 올라가지 않습니다. 서버 기능까지 실제
  서비스에 쓰려면 Render, Railway 같은 Node 호스팅에 `server/`만 별도로 배포하고, 위 `.env`
  값들을 그 호스팅의 환경변수로 등록하세요.

---

## 13. 배포

프런트(`소스 코드/`)는 모두 무료로 가능하고, 이 폴더를 통째로 올리면 끝입니다.

| 서비스 | 방법 |
|---|---|
| **Netlify** | netlify.com → Add new site → Deploy manually → 폴더 드래그앤드롭 |
| **Cloudflare Pages** | Pages → Upload assets → 폴더 업로드 |
| **Vercel** | vercel.com → Add New → Project → 폴더 업로드 |
| **GitHub Pages** | 저장소에 push → Settings → Pages → 브랜치 지정 |

도메인은 가비아·후이즈·Cloudflare 등 어디서 사도 됩니다.
`reiten.kr` 같은 짧은 도메인을 잡아 위 서비스에 연결하세요.

> 위 서비스들은 전부 **정적 파일만** 서빙합니다. `server/`(주문 가격 검증·리뷰 API)까지
> 실서비스에 쓰려면 Render·Railway 같은 Node 호스팅에 `server/`를 별도로 올려야 합니다
> (12번 참고). 안 올려도 사이트 자체는 정상 동작합니다(자동 폴백).

### 배포 전 체크리스트

> 실제 배포 진행 상태는 [0번 섹션](#0-현재-배포-상태-다음-작업-전에-이-섹션부터-읽으세요)을 참고하세요.

- [x] `data.js`의 `SITE.biz`(사업자정보) 전부 실제 값으로 교체
- [ ] `data.js`의 `SITE.order.kakao` · `SITE.order.instagram` 자리표시자 교체(카카오톡 채널·인스타그램 계정 개설 후)
- [x] 개인정보처리방침(`privacy.html`) · 이용약관(`terms.html`) 페이지 작성
- [ ] 상품 가격 · 재고(`soldOut`) 최종 확인
- [x] 이미지 WebP 최적화
- [ ] 실제 기기(아이폰/안드로이드)에서 주문 흐름 1회 테스트
- [x] `sitemap.xml` · `robots.txt` 추가 (OG 이미지는 아직)
- [x] GitHub(`haechankimm/Reiten`)와 Render를 연결해뒀다면, 이제는 **push만 하면 자동 재배포**됩니다
      (Netlify/Cloudflare Pages 등 정적 호스팅에 별도로 폴더를 올리는 방식이라면 그때는 재배포 후
      브라우저 강력 새로고침(Cmd/Ctrl+Shift+R)까지 확인하세요)
