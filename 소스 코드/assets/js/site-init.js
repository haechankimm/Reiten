/* 모든 고객 페이지 공용 시작 스크립트 — GA4 설정 + 채널톡 부팅.
   예전엔 페이지마다 <head>에 인라인으로 들어 있던 것을 그대로 옮겼다(2026-11-11, 동작 동일).
   반드시 gtag.js(async) 바로 다음, 다른 스크립트보다 먼저 불러온다. */
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
if (/\/order-complete\.html$/.test(location.pathname)) {
  // 결제 복귀 주소의 ?paymentId=...가 분석 도구로 넘어가지 않게 주소에서 쿼리를 뺀 값으로 기록한다.
  gtag('config', 'G-0GKE5QTQ31', { page_location: location.origin + location.pathname });
} else {
  gtag('config', 'G-0GKE5QTQ31');
}

/* Channel Talk */
(function(){var w=window;if(w.ChannelIO){return w.console.error("ChannelIO script included twice.");}var ch=function(){ch.c(arguments);};ch.q=[];ch.c=function(args){ch.q.push(args);};w.ChannelIO=ch;function l(){if(w.ChannelIOInitialized){return;}w.ChannelIOInitialized=true;var s=document.createElement("script");s.type="text/javascript";s.async=true;s.src="https://cdn.channel.io/plugin/ch-plugin-web.js";var x=document.getElementsByTagName("script")[0];if(x.parentNode){x.parentNode.insertBefore(s,x);}}if(document.readyState==="complete"){l();}else{w.addEventListener("DOMContentLoaded",l);w.addEventListener("load",l);}})();
ChannelIO('boot', { "pluginKey": "c060dbe0-8b3a-4e72-86f1-02d17015d217" });
