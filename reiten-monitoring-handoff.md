# 👔 REITEN 시스템 모니터링 & AI 에이전트 인수인계 문서

- **작성 주체**: AI 개인 비서 (Pickle / 피클)
- **수신 주체**: REITEN 프로젝트 개발 AI (Claude Code / Cursor 등) 및 대표 (김해찬 님)
- **작성 일자**: 2026-11-10
- **목적**: 피클(비서 에이전트)과 REITEN 백엔드(`works.reiten.kr`) 및 프론트엔드(`reiten.kr`) 간의 안전한 모니터링, 오류 보고, 운영 관리 협업 체계 정립

---

## 1. 개요 및 역할 분담 (Architecture & Boundaries)

```
[고객 / 외부 시스템] 
       │
       ▼
[REITEN 인프라 (Render + Supabase + Sentry + UptimeRobot)]
       │ (상태 핑 & 알림 메일)
       ▼
[피클 (비서 에이전트)] ──(에러 감지 시 1장 요약본 생성)──▶ [개발 AI (Claude Code / Cursor)]
       │                                                         │ (코드 패치 & PR)
       ▼ (정기 브리핑 & 발주 승인 카드)                                ▼
[대표 (해찬님)] ─────────────────────────────────────▶ [GitHub / Production 배포]
```

### 핵심 역할 분담
1. **피클 (비서 에이전트)**:
   - **모니터링 & 트리거 감지**: 백엔드 헬스체크, Sentry 에러 알림, UptimeRobot 다운 알림 포착.
   - **상황 요약 및 브리핑**: 매일 아침(07:50)과 오후(14:00) 정기 운영 상태 브리핑.
   - **디버그 컨텍스트 패키징**: 에러 발생 시 개발 AI가 즉시 작업할 수 있도록 핵심 정보(커밋, 스택, 파일 경로)를 담은 1장짜리 인수인계 파일 생성.
   - **주문 발주 준비**: 고객 주문 수집 → 발주서 초안 작성 및 검증 → 해찬님께 [승인 카드] 제시.
2. **개발 AI (Claude Code / Cursor)**:
   - 피클이 전달한 디버그 파일을 기반으로 실제 버그 수정, 테스트 작성, PR 생성 및 배포.
   - 백엔드 안전 엔드포인트 설계 및 보안 로직 구현.
3. **대표 (해찬님)**:
   - 최종 승인 권한자: 돈이 나가는 발주 결제 승인, 코드 머지 및 배포 승인.

---

## 2. 피클 측에서 이미 구축 및 등록 완료한 작업

피클의 작업 환경 내에 아래 2건의 정기 액션과 알림 감시 프로세스가 공식 등록되어 상시 가동 중입니다.

| 액션 명칭 | 스케줄 | 실행 내용 | 보고 규칙 |
|---|---|---|---|
| **☀️ 아침 브리핑** (`my-day-preparation`) | 매일 07:50 KST | `works.reiten.kr/health` 응답, 24시간 Sentry 에러 건수, 신규 주문/배송 준비 상태 점검 | 아침 브리핑 1~2번에 필수 고정 보고 |
| **👔 reiten 운영 및 서버 정기 점검** | 매일 14:00 KST | 1. `works.reiten.kr/health` HTTP 200 / `db: ok` 검증<br>2. 프론트 `reiten.kr` 200 OK 확인 (더미 주문/결제 절대 금지)<br>3. 신규 Sentry 에러 및 UptimeRobot 다운 메일 확인<br>4. 프린트캔버스 도매 발주/배송 상태 확인 | 장애 발생 시, 신규 오류 발생 시, 유의미한 변동 시에만 즉각 알림. 평온할 땐 무소음(`[silent]`) |
| **🚨 실시간 이벤트 감시** (하트비트 연계) | 상시 (수신 시) | Gmail로 유입되는 Sentry 'Issue Alert' 및 UptimeRobot 'Down Alert' 실시간 감지 | 즉시 원인 파악 후 요약 알림 및 디버그 파일 생성 |

### Render 750시간 무료 한도 보호를 위한 최적화
- 피클은 Render 무료 인스턴스가 15분 비활성 시 정상적으로 수면(Spin down)할 수 있도록, **무차별 5분 폴링을 일절 수행하지 않습니다.**
- 평소에는 정기 스케줄(07:50, 14:00) 외에는 핑을 치지 않으며, UptimeRobot과 Sentry의 이메일 웹훅 알림을 감시하는 **이벤트 기반(Event-driven)**으로 대기합니다.

---

## 3. 보안 철칙 및 프롬프트 인젝션 방어

피클과 개발 AI 모두가 합의한 절대적인 보안 원칙입니다.

1. **에이전트의 쓰기 권한 원천 차단 (No Write Access)**:
   - 피클은 Works 관리자 계정의 로그인 세션이나 PIN 토큰을 갖지 않습니다.
   - 피클의 권한으로는 주문 취소, 환불, 쿠폰 발행, 설정 변경을 호출할 수 없습니다.
2. **프롬프트 인젝션 방어 (Untrusted Input Isolation)**:
   - 고객 Q&A, 리뷰, 주문 메모, 결제 실패 사유에는 악의적인 프롬프트가 포함될 수 있습니다.
   - 피클은 고객 화면이나 관리자 화면을 브라우저 DOM으로 스크래핑하지 않으며, 백엔드로부터 마스킹된 진단 데이터(JSON)만 소비합니다. 쓰기 도구가 없으므로 인젝션이 발생해도 시스템 피해가 불가능합니다.
3. **발주 완전 자동화 금지 (Human-in-the-Loop)**:
   - 피클이 공급처(프린트캔버스 등)에서 직접 결제 버튼을 누르는 완전 자동 결제는 수행하지 않습니다.
   - 피클은 [주문 취합 → 품목/옵션 매칭 → 배송지 검증 → 주문서 작성]까지만 수행하고, 해찬님이 금액과 내용을 눈으로 확인한 뒤 [승인 카드]를 눌러야 최종 결제가 진행됩니다.

---

## 4. 백엔드 개발 AI에게 요청하는 구현 사항 (Action Items)

피클이 더 안전하고 정확하게 Works 상태를 진단할 수 있도록, 백엔드에 아래 전용 엔드포인트 신설을 제안합니다.

### 과제: 에이전트 전용 읽기 전용 진단 엔드포인트 신설
- **목적**: 관리자 로그인/PIN 인증 없이, 봇 전용 비밀키 헤더(`X-REITEN-BOT-KEY`) 하나로 진단 리포트를 안전하게 조회.
- **권장 경로**: `GET /api/bot/diagnostics`
- **구현 예시 (Express)**:

```javascript
// server/routes/botDiagnostics.js (신규 라우터 예시)
const express = require("express");
const { buildDiagnosticReport } = require("../lib/diagnostics");

const router = express.Router();

function requireBotKey(req, res, next) {
  const botKey = req.headers["x-reiten-bot-key"];
  const expectedKey = process.env.REITEN_BOT_KEY;

  if (!expectedKey || !botKey || botKey !== expectedKey) {
    return res.status(403).json({ error: "Forbidden: Invalid Bot Key" });
  }
  next();
}

// 오직 GET(읽기 전용)만 열려 있으며, 마스킹된 진단 리포트만 반환
router.get("/diagnostics", requireBotKey, async (req, res) => {
  try {
    const report = await buildDiagnosticReport();
    res.json({ ok: true, report });
  } catch (err) {
    console.error("[botDiagnostics]", err.message);
    res.status(500).json({ ok: false, error: "Failed to generate report" });
  }
});

module.exports = router;
```

- **Render 환경변수**:
  - `REITEN_BOT_KEY`: 안전한 32자리 랜덤 문자열 (해찬님이 Render 대시보드에 설정 후 피클 볼트에 등록).

---

## 5. UptimeRobot 모니터링 세팅 권장사항

Render 무료 티어 750시간 고갈을 방지하기 위한 최적 설정입니다.

- **Monitor Type**: `HTTP(s)`
- **URL**: `https://works.reiten.kr/health` (홈페이지 `/`는 정적 페이지만 반환하므로 DB 상태를 검증하는 `/health` 필수)
- **Monitoring Interval**: **20분 또는 30분** (15분 슬립 주기를 허용하여 월 누적 가동 시간을 300~400시간으로 억제)
- **Alert Contacts**: `haechankimm@gmail.com` (피클이 즉시 수신 감지)

---

## 6. 에러 발생 시 개발 AI 인수인계 프로토콜

Sentry 에러가 감지되면 피클은 아래 규격의 마크다운 파일(`downloads/reiten-errors/error-[날짜]-[ID].md`)을 즉시 생성하여 해찬님께 전달합니다.

### 디버그 파일 템플릿 규격
```markdown
# 🚨 REITEN 에러 리포트: [에러명]
- 발생 시각: 2026-11-10 14:05:22 KST
- 환경: Production (Render: srv-d9q5bndbedkc73b4c3q0)
- 배포 커밋: 13135c5448acd175d6aee82b2a811eb78950ca40 (PR #13)
- 트랜잭션/경로: POST /api/admin/...
- HTTP 상태: 500 Internal Server Error

## 1. 스택 트레이스 핵심
server/routes/example.js:44 in Router.handle
Cannot find module '...'

## 2. 관련 파일 및 영향 범위
- 파일: server/routes/example.js, server/lib/auth.js
- DB 테이블: orders, order_items

## 3. 개발 AI(Claude Code / Cursor) 복붙용 프롬프트
"위 에러 리포트를 기반으로 server/routes/example.js의 44번째 줄 모듈 누락 오류를 분석하고, 올바른 의존성 임포트 및 예외 처리를 반영하는 패치 커밋을 작성해줘."
```

---

## 7. 결론

본 구조를 통해:
1. **해찬님**은 24시간 장애 걱정과 매번 대시보드를 열어보는 인지 부하에서 완전히 해방됩니다.
2. **피클(비서)**은 1차 방어선에서 시스템 상태를 지키고, 불필요한 비용이나 위험 없이 신속하게 상황을 브리핑합니다.
3. **개발 AI(Claude Code)**는 피클이 잘 정리해 둔 컨텍스트를 받아 10초 만에 정확한 버그 픽스를 수행합니다.

문의 사항이나 엔드포인트 세팅 완료 시 언제든 공유해 주시면 즉시 연동 테스트를 진행하겠습니다.
