/* =========================================================
   REITEN — 후드집업 벡터 프리뷰
   컬러 · 지퍼 참을 실시간으로 반영합니다.
   좌표계 : viewBox 0 0 800 820 (정면 플랫레이)
   ========================================================= */

const SLIDER_Y = 300;                 // 지퍼 슬라이더 상단
const RING_Y = SLIDER_Y + 40;         // 슬라이더 고리 중심
const CHARM_W = 62;

/* 좌측 소매 — 몸판 아래 레이어. 안쪽 모서리는 몸판에 겹쳐 둔다 */
const SLEEVE = `
  <path d="M258,226 C192,244 148,296 128,364 C112,438 114,558 128,650
           L228,676 C258,548 274,420 302,302 Z"/>
  <path d="M246,290 C204,356 178,472 172,592" fill="none"
        stroke="#000" stroke-opacity=".055" stroke-width="30" stroke-linecap="round"/>
  <path d="M128,650 L228,676 L240,632 L140,606 Z" fill="#000" opacity=".12"/>
  <path d="M136,617 L237,643 M132,632 L233,658" fill="none"
        stroke="#000" stroke-opacity=".18" stroke-width="2.5"/>
`;

/* 겨드랑이 ~ 옆선 : 몸판 위에 얹어야 소매가 앞으로 보인다 */
const SLEEVE_SEAM = `
  <path d="M302,302 C270,404 250,508 240,626" fill="none"
        stroke="#000" stroke-opacity=".10" stroke-width="12" stroke-linecap="round"/>
  <path d="M302,302 C270,404 250,508 240,626" fill="none"
        stroke="#000" stroke-opacity=".28" stroke-width="2.2"/>
`;

/* 지퍼 하드웨어(슬라이더 · 고리 · 연결선) 색상 — 참 마감(finish)을 따라간다 */
function zipperHardwareFill(finishKey, charmKey) {
  if (charmKey === "none" || finishKey === "silver") return "url(#metal)";
  if (finishKey === "black") return "url(#metalDark)";
  if (finishKey === "color") return getCharm(charmKey)?.accent || "url(#metal)";
  return "url(#metal)";
}

function hoodieSVG({ colorHex = "#16161a", charmKey = "star", finishKey = "silver" } = {}) {
  const charm = charmSVG(charmKey, finishKey, {
    attrs: `x="${-CHARM_W / 2}" y="0" width="${CHARM_W}" height="${CHARM_W * 1.2}" overflow="visible"`,
  });
  const zipperFill = zipperHardwareFill(finishKey, charmKey);

  return `
<svg class="stage__svg" viewBox="100 46 600 660" role="img"
     aria-label="${esc(t("후드집업 미리보기 — 선택한 컬러와 지퍼 참이 반영됩니다"))}">
  <defs>
    <linearGradient id="fabShade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#000" stop-opacity=".20"/>
      <stop offset="18%"  stop-color="#000" stop-opacity="0"/>
      <stop offset="50%"  stop-color="#fff" stop-opacity=".09"/>
      <stop offset="82%"  stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity=".20"/>
    </linearGradient>
    <linearGradient id="hoodShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#000" stop-opacity=".02"/>
      <stop offset="62%"  stop-color="#000" stop-opacity=".10"/>
      <stop offset="100%" stop-color="#000" stop-opacity=".30"/>
    </linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#aeb4ba"/>
      <stop offset="34%"  stop-color="#f4f6f8"/>
      <stop offset="62%"  stop-color="#878d93"/>
      <stop offset="100%" stop-color="#d8dce0"/>
    </linearGradient>
    <linearGradient id="metalDark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#3a3a3e"/>
      <stop offset="34%"  stop-color="#616166"/>
      <stop offset="62%"  stop-color="#222225"/>
      <stop offset="100%" stop-color="#4d4d51"/>
    </linearGradient>
    <radialGradient id="beam" cx="50%" cy="34%" r="62%">
      <stop offset="0%"   stop-color="#fff6dd" stop-opacity=".26"/>
      <stop offset="55%"  stop-color="#fff6dd" stop-opacity=".06"/>
      <stop offset="100%" stop-color="#fff6dd" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect class="beam-bg" x="0" y="0" width="800" height="820" fill="url(#beam)" opacity="0"/>

  <g class="fabric" fill="${colorHex}">

    <!-- 후드 (뒤판) -->
    <path d="M298,254 C294,160 334,86 400,86 C466,86 506,160 502,254 Z"/>
    <path d="M298,254 C294,160 334,86 400,86 C466,86 506,160 502,254 Z" fill="url(#hoodShade)"/>
    <path d="M400,88 L400,250" stroke="#000" stroke-opacity=".12" stroke-width="2"/>

    <!-- 소매 -->
    <g class="sleeve">${SLEEVE}</g>
    <g class="sleeve" transform="translate(800,0) scale(-1,1)">${SLEEVE}</g>

    <!-- 몸판 -->
    <path d="M258,228 L542,228 C556,352 566,498 568,608 L232,608 C234,498 244,352 258,228 Z"/>
    <path d="M258,228 L542,228 C556,352 566,498 568,608 L232,608 C234,498 244,352 258,228 Z" fill="url(#fabShade)"/>

    <!-- 소매 옆선 (몸판 위) -->
    <g>${SLEEVE_SEAM}</g>
    <g transform="translate(800,0) scale(-1,1)">${SLEEVE_SEAM}</g>

    <!-- 밑단 립 -->
    <path d="M232,608 L568,608 L572,662 L228,662 Z"/>
    <path d="M232,608 L568,608 L572,662 L228,662 Z" fill="#000" opacity=".11"/>
    <path d="M234,620 L566,620 M233,634 L567,634 M232,648 L568,648"
          fill="none" stroke="#000" stroke-opacity=".13" stroke-width="2.5"/>

    <!-- 캥거루 주머니 -->
    <path d="M290,452 C288,516 298,548 330,562 L392,562" fill="none"
          stroke="#000" stroke-opacity=".24" stroke-width="2.5"/>
    <path d="M510,452 C512,516 502,548 470,562 L408,562" fill="none"
          stroke="#000" stroke-opacity=".24" stroke-width="2.5"/>
    <path d="M290,452 C288,516 298,548 330,562 L392,562" fill="none"
          stroke="#fff" stroke-opacity=".07" stroke-width="2.5" transform="translate(0,3)"/>

    <!-- 후드 안쪽 그늘 -->
    <path d="M310,196 C334,244 364,266 400,266 C436,266 466,244 490,196
             C494,224 480,252 452,268 L348,268 C320,252 306,224 310,196 Z"
          fill="#000" opacity=".22"/>

    <!-- 후드 앞단 (칼라) -->
    <path d="M400,282 C356,282 322,258 302,222 C294,202 298,180 310,170
             C330,210 362,234 400,234 C438,234 470,210 490,170
             C502,180 506,202 498,222 C478,258 444,282 400,282 Z"/>
    <path d="M400,282 C356,282 322,258 302,222 C294,202 298,180 310,170
             C330,210 362,234 400,234 C438,234 470,210 490,170
             C502,180 506,202 498,222 C478,258 444,282 400,282 Z"
          fill="#fff" opacity=".05"/>
    <path d="M310,170 C330,210 362,234 400,234 C438,234 470,210 490,170"
          fill="none" stroke="#000" stroke-opacity=".22" stroke-width="2.5"/>
  </g>

  <!-- 목 라벨 -->
  <g class="hardware">
    <rect x="376" y="243" width="48" height="15" rx="2" fill="#f4f2ec"/>
    <path d="M384,250 h32 M384,254.5 h20" stroke="#000" stroke-opacity=".3" stroke-width="1.6"/>
  </g>

  <!-- 지퍼 -->
  <g class="hardware">
    <rect x="390" y="240" width="20" height="422" fill="${colorHex}"/>
    <rect x="390" y="240" width="20" height="422" fill="#000" opacity=".22"/>
    <line x1="400" y1="244" x2="400" y2="660" stroke="#a3a8ae" stroke-width="7"
          stroke-dasharray="4 4"/>
    <line x1="400" y1="244" x2="400" y2="660" stroke="#000" stroke-opacity=".4" stroke-width="1.4"/>
    <rect x="389" y="${SLIDER_Y}" width="22" height="32" rx="6" fill="${zipperFill}"/>
    <rect x="393" y="${SLIDER_Y + 6}" width="14" height="5" rx="2.5" fill="#000" opacity=".2"/>
    <path d="M400,${SLIDER_Y + 32} L400,${RING_Y - 8}" stroke="${zipperFill}" stroke-width="5"/>
    <circle cx="400" cy="${RING_Y}" r="8.5" fill="none" stroke="${zipperFill}" stroke-width="4"/>
  </g>

  <!-- 소매 리플렉티브 스크립트 로고 -->
  <g class="reflective" transform="translate(620,602) rotate(13)">
    <text x="0" y="0" text-anchor="middle"
          font-family="Snell Roundhand, Brush Script MT, cursive" font-style="italic"
          font-size="30" fill="#eef1f5">Reiten</text>
  </g>

  <!-- 지퍼 참 -->
  <g class="charm-slot" transform="translate(400, ${RING_Y + 5})">
    ${charm ? `<g class="charm-hang">${charm}</g>` : ""}
  </g>
</svg>`;
}
