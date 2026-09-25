/* Express 4는 async 라우트 안에서 예외가 나면 에러 핸들러로 넘기지 않아, 요청이 응답 없이 멈춘 채
   고객 화면이 타임아웃까지 빙글빙글 돈다(unhandledRejection 로그만 남음). 모든 라우트 핸들러가
   돌려준 Promise의 실패를 next(err)로 넘겨 server.js 맨 아래 500 핸들러·Sentry가 받게 한다.
   (Express 5로 올리면 기본 동작이라 이 파일은 지워도 된다.) */
const Layer = require("express/lib/router/layer");

const original = Layer.prototype.handle_request;
Layer.prototype.handle_request = function handleRequestWithAsync(req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return original.call(this, req, res, next);
  try {
    const result = fn(req, res, next);
    if (result && typeof result.catch === "function") result.catch(next);
  } catch (err) {
    next(err);
  }
};
