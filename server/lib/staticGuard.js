/* ---------- 정적 파일 공개 범위 제한 ----------
   `소스 코드/`(고객 사이트)와 `works/`(관리자 사이트) 폴더는 express.static으로 통째로 서빙된다.
   그런데 이 폴더 안에 내부 운영 문서(README.md·사용설명서.md — 대표·직원 개인 메일, 마스터 관리자
   계정, 알려진 보안 약점 메모까지 들어 있음)가 같이 들어 있어서 https://reiten.kr/README.md 로
   누구나 내려받을 수 있었다(2026-10-02 노출 감사에서 발견). 문서를 옮기면 기존 작업 흐름(README
   업로드·경로 참조)이 깨지므로, 대신 "웹 리소스로 쓰는 확장자만 내보내는" 허용목록으로 막는다 —
   차단목록(.md만 막기)과 달리 나중에 누가 .sql·.env·.zip 같은 파일을 실수로 넣어도 새지 않는다.
   확장자 없는 경로("/", "/health" 등)와 /api/* 는 이 검사 대상이 아니다. */
const path = require("path");

const PUBLIC_EXTENSIONS = new Set([
  ".html", ".css", ".js", ".mjs", ".map", ".json", ".webmanifest",
  ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg", ".ico",
  ".mp4", ".webm", ".mp3",
  ".woff", ".woff2", ".ttf", ".otf",
  ".xml", ".txt",
]);

/* 브라우저가 보낸 경로(퍼센트 인코딩 포함)를 express.static과 똑같이 한 번 디코딩한 뒤 판단한다 —
   디코딩 없이 보면 "/README%2Emd"처럼 점을 인코딩한 요청이 확장자 없는 경로로 보여 통과해버린다. */
function isPublicStaticPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath || ""));
  } catch (e) {
    return false;
  }
  if (decoded.includes("\0")) return false;
  // ".env" 같은 점 파일은 Node가 확장자 없음으로 보므로 따로 막는다(express.static 기본값도 무시하지만 이중 방어).
  if (decoded.split("/").some((seg) => seg.startsWith("."))) return false;
  const ext = path.extname(decoded).toLowerCase();
  if (!ext) return true;
  return PUBLIC_EXTENSIONS.has(ext);
}

/* notFoundFile: 막힌 요청에 보여줄 브랜드 404 페이지 경로 */
function staticGuard(notFoundFile) {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api/")) return next();
    if (isPublicStaticPath(req.path)) return next();
    res.status(404).sendFile(notFoundFile);
  };
}

module.exports = { isPublicStaticPath, staticGuard, PUBLIC_EXTENSIONS };
