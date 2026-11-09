/* ---------- 화면 오류 보고 받기 (2026-11-09) ----------
   브라우저(소스 코드/assets/js/errorReport.js)가 보낸 자바스크립트 오류를 서버 로그와 Sentry(SENTRY_DSN이 있을 때)에 남긴다.
   DB에는 저장하지 않는다 — 알림 벨·아침 요약의 "시스템 오류"는 서버 쪽 사고만 세도록 섞지 않는다.
   누구나 보낼 수 있는 공개 경로라 길이를 자르고 IP당 횟수를 제한한다(clientErrorLimiter). 응답은 항상 204. */
const express = require("express");
const Sentry = require("@sentry/node");
const { clientErrorLimiter } = require("../lib/rateLimiters");

const router = express.Router();

const clip = (v, n) => String(v ?? "").slice(0, n);

router.post("/api/client-errors", clientErrorLimiter, (req, res) => {
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const message = clip(b.message, 500);
  if (!message) return res.status(204).end();
  const report = {
    kind: b.kind === "unhandledrejection" ? "unhandledrejection" : "error",
    message,
    stack: clip(b.stack, 4000),
    source: clip(b.source, 300).split("?")[0],
    line: Number.isFinite(Number(b.line)) ? Number(b.line) : null,
    col: Number.isFinite(Number(b.col)) ? Number(b.col) : null,
    page: clip(b.page, 200).split("?")[0],
    lang: clip(b.lang, 5),
    viewport: clip(b.viewport, 20),
    userAgent: clip(req.get("user-agent"), 300),
  };
  console.warn("[client-error]", report.page, report.message, report.source ? `(${report.source}:${report.line})` : "");
  if (process.env.SENTRY_DSN) {
    Sentry.withScope((scope) => {
      scope.setTag("source", "browser");
      scope.setTag("page", report.page);
      scope.setTag("lang", report.lang);
      scope.setContext("browser_report", report);
      const err = new Error(report.message);
      err.name = report.kind === "unhandledrejection" ? "UnhandledRejection(browser)" : "BrowserError";
      if (report.stack) err.stack = `${err.name}: ${report.message}\n${report.stack}`;
      Sentry.captureException(err);
    });
  }
  res.status(204).end();
});

module.exports = router;
