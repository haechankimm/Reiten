/* =========================================================
   REITEN — 사이트 데이터
   ---------------------------------------------------------
   이 파일만 고치면 상품 · 가격 · 입금계좌 · 사업자정보가
   사이트 전체에 반영됩니다. (HTML은 건드릴 필요 없음)
   ========================================================= */

const SITE = {
  name: "REITEN",
  tagline: "달리기 위해 태어난 옷",

  /* ── 주문 접수용 정보 ── 반드시 실제 값으로 교체하세요 ── */
  order: {
    bankName: "토스뱅크",
    accountNo: "1002-7055-2427",
    holder: "김해찬",
    email: "Reiten.customersupport@gmail.com",
    kakao: "[카카오톡 채널 주소 입력]",
    instagram: "[인스타그램 계정 입력]",

    /* 주문서를 받을 엔드포인트 (선택).
       Formspree · Google Apps Script 웹앱 주소 등을 넣으면 주문서가 자동 전송됩니다.
       비워두면 고객이 주문서를 복사해 이메일/카카오로 보내는 방식으로 동작합니다. */
    formEndpoint: "",
  },

  /* ── 통신판매업 고지 (전자상거래법 필수) ── */
  biz: {
    company: "Reiten",
    ceo: "김해찬",
    regNo: "154-44-01222",
    mailOrderNo: "제-2026-용인기흥-00638 호",
    address: "용인시 기흥구 죽현로 80번길 38",
    tel: "010-9399-6861",
    privacyOfficer: "김해찬",
  },

  shipping: {
    fee: 3500,
    freeOver: 100000,
    leadTime: "결제 확인 후 2~5 영업일 이내 출고",
  },
};

/* =========================================================
   택배사 — 운송장번호를 넣으면 조회 페이지로 이동하는 링크만 만든다
   (사이트 내 실시간 조회 API는 붙이지 않음. {tracking}이 운송장번호로 치환됨)
   ========================================================= */
const COURIERS = [
  { key: "cj",     label: "CJ대한통운", urlTemplate: "https://trace.cjlogistics.com/next/tracking.html?wblNo={tracking}" },
  { key: "hanjin", label: "한진택배",   urlTemplate: "https://www.hanjin.co.kr/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&wblnumText2={tracking}" },
  { key: "lotte",  label: "롯데택배",   urlTemplate: "https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo={tracking}" },
  { key: "logen",  label: "로젠택배",   urlTemplate: "https://www.ilogen.com/web/personal/trace/{tracking}" },
  { key: "epost",  label: "우체국택배", urlTemplate: "https://service.epost.go.kr/trace.RetrieveRegiPrclDeliv.comm?sid1={tracking}" },
];

/* =========================================================
   컬러 (제품 공통 팔레트)
   ========================================================= */
const COLORS = {
  black:    { key: "black",    label: "블랙",        hex: "#16161a" },
  white:    { key: "white",    label: "화이트",      hex: "#f3f1e9" },
  pink:     { key: "pink",     label: "핑크",        hex: "#dba3ac" },
  deepblue: { key: "deepblue", label: "딥블루",      hex: "#22334f" },
  sky:      { key: "sky",      label: "스카이 블루", hex: "#9dbdd8" },
  clay:     { key: "clay",     label: "클레이",      hex: "#b08574" },
};

/* =========================================================
   사이즈 실측 (cm, 단면) — 남녀공용 오버핏
   ========================================================= */
const SIZE_TABLES = {
  hoodie: {
    head: ["사이즈", "총장", "가슴단면", "어깨", "소매길이"],
    rows: [
      ["S",  68, 60, 56, 57],
      ["M",  70, 62, 58, 58],
      ["L",  72, 64, 60, 59],
      ["XL", 74, 66, 62, 60],
    ],
  },
  crop: {
    head: ["사이즈", "총장", "가슴단면", "어깨", "소매길이"],
    rows: [
      ["S", 50, 56, 54, 56],
      ["M", 52, 58, 56, 57],
      ["L", 54, 60, 58, 58],
    ],
  },
  /* 실제 계측 전까지 빈 문자열로 둔다(PROTECTOR_GUIDE와 같은 관례) — 값을 지어내지 않는다 */
  tshirt: {
    head: ["사이즈", "총장", "가슴단면", "어깨", "소매길이"],
    rows: [
      ["XS", "", "", "", ""],
      ["S",  "", "", "", ""],
      ["M",  "", "", "", ""],
      ["L",  "", "", "", ""],
      ["XL", "", "", "", ""],
    ],
  },
};

/* =========================================================
   라이더 사이즈 가이드 — 이너 프로텍터(보호대) 착용 시 권장 사이즈
   ---------------------------------------------------------
   "가슴단면 여유분(cm)" 열은 실제 프로텍터를 착용시켜 계측한 뒤
   채워 넣을 자리입니다. 계측 전까지는 빈 문자열로 비워둡니다.
   ========================================================= */
const PROTECTOR_GUIDE = {
  hoodie: {
    note: "이너 프로텍터(보호대)를 착용하고 그 위에 덧입으실 계획이라면 가슴·어깨 여유가 줄어듭니다. 평소 사이즈보다 한 치수 큰 사이즈를 권장합니다.",
    head: ["평소 사이즈", "보호대 착용 시 권장", "가슴단면 여유분(cm)"],
    rows: [
      ["S",  "M",  ""],
      ["M",  "L",  ""],
      ["L",  "XL", ""],
      ["XL", "XL", ""],
    ],
  },
  crop: {
    note: "크롭 기장은 프로텍터 착용 시 밑단이 더 짧게 느껴질 수 있습니다. 재킷형 프로텍터를 안에 입으실 경우 한 치수 큰 사이즈를 권장합니다.",
    head: ["평소 사이즈", "보호대 착용 시 권장", "가슴단면 여유분(cm)"],
    rows: [
      ["S", "M", ""],
      ["M", "L", ""],
      ["L", "L", ""],
    ],
  },
};

/* =========================================================
   상품
   ---------------------------------------------------------
   image 가 null 이면 회색 플레이스홀더로 렌더됩니다.
   ========================================================= */
const PRODUCTS = [
  {
    id: "reflect-heart-hoodie",
    name: "Reflect Heart Hoodie",
    nameKo: "리플렉트 하트 후디",
    type: "hoodie",
    category: "후드티",
    price: 89000,
    badge: "Reflective",
    images: [null, null, null, null],
    colors: ["black", "white", "pink", "deepblue", "sky", "clay"],
    sizes: ["XS", "S", "M", "L", "XL"],
    soldOut: ["XS"],
    sizeTable: "hoodie",
    short: "트라이벌 하트 스카치 전사 · 백 프린트",
    desc:
      "등판 전체에 스카치라이트 리플렉티브 전사를 올린 헤비 후디입니다. 낮에는 무광 실버 그래픽으로 보이고, 야간 주행 중 헤드라이트를 받으면 그래픽 전체가 발광합니다.",
    details: [
      "겉감 : 코튼 80% / 폴리에스터 20% · 480g 헤비 기모",
      "프린팅 : 3M 스카치라이트 계열 리플렉티브 전사",
      "핏 : 남녀공용 오버핏 (드롭숄더)",
      "부자재 : 두께감 있는 3겹 후드, 립 조직 밑단",
    ],
  },
  {
    id: "reflect-exhaust-hoodie",
    name: "Reflect Exhaust Hoodie",
    nameKo: "리플렉트 이그저스트 후디",
    type: "hoodie",
    category: "후드티",
    price: 89000,
    badge: "Reflective",
    images: [null, null, null, null],
    colors: ["black", "white", "pink", "deepblue", "sky", "clay"],
    sizes: ["XS", "S", "M", "L", "XL"],
    soldOut: ["XS", "S"],
    sizeTable: "hoodie",
    short: "머플러 & 플레임 스카치 전사 · 백 프린트",
    desc:
      "배기 머플러와 화염을 라인 드로잉으로 옮긴 백 그래픽. 라인이 가늘수록 반사 대비가 강해져서, 어두울수록 그림이 또렷해집니다.",
    details: [
      "겉감 : 코튼 80% / 폴리에스터 20% · 480g 헤비 기모",
      "프린팅 : 3M 스카치라이트 계열 리플렉티브 전사",
      "핏 : 남녀공용 오버핏 (드롭숄더)",
      "부자재 : 두께감 있는 3겹 후드, 립 조직 밑단",
    ],
  },
  {
    id: "helmet-zip-hoodie",
    name: "Helmet Zip Hoodie",
    nameKo: "헬멧 집업 후디",
    type: "zip",
    category: "후드집업",
    price: 129000,
    badge: "Washed",
    images: [null, null, null, null],
    colors: ["black", "white", "pink", "deepblue", "sky", "clay"],
    sizes: ["XS", "S", "M", "L", "XL"],
    soldOut: ["XS"],
    sizeTable: "hoodie",
    short: "가먼트 워싱 · 프론트 드로잉 그래픽",
    desc:
      "완성 후 워싱을 먹여 색이 한 톤 빠진 집업입니다. 가슴의 헬멧 드로잉과 소매 로고는 리플렉티브 전사로, 정면에서 빛을 받으면 그래픽만 떠오릅니다.",
    details: [
      "겉감 : 코튼 100% · 420g 가먼트 워싱",
      "프린팅 : 리플렉티브 전사 (프론트 · 소매)",
      "핏 : 남녀공용 오버핏 (드롭숄더)",
      "부자재 : YKK 양방향 지퍼 · 참(charm) 탈부착 가능",
    ],
    charmReady: true,
  },
  {
    id: "core-zip-hoodie",
    name: "Core Zip Hoodie",
    nameKo: "코어 집업 후디",
    type: "zip",
    category: "후드집업",
    price: 119000,
    badge: "Customizable",
    images: [null, null, null, null],
    colors: ["black", "white", "pink", "deepblue", "sky", "clay"],
    sizes: ["XS", "S", "M", "L", "XL"],
    soldOut: ["XS"],
    sizeTable: "hoodie",
    short: "6컬러 · 지퍼 참 커스텀 가능",
    desc:
      "브랜드의 기본이 되는 집업입니다. 그래픽 없이 소매의 리플렉티브 스크립트 로고만 남겼습니다. 지퍼 슬라이더에 원하는 참(charm)을 달아 조합을 완성하세요.",
    details: [
      "겉감 : 코튼 100% · 420g",
      "프린팅 : 소매 리플렉티브 스크립트 로고",
      "핏 : 남녀공용 오버핏 (드롭숄더)",
      "부자재 : YKK 양방향 지퍼 · 참(charm) 탈부착 가능",
    ],
    charmReady: true,
  },
  {
    id: "reflect-crop-hoodie",
    name: "Reflect Crop Zip Hoodie",
    nameKo: "리플렉트 크롭 집업 후디",
    type: "crop",
    category: "크롭 후드티",
    price: 89000,
    badge: "Customizable",
    images: [null, null, null, null],
    colors: ["black", "white", "pink", "deepblue", "sky", "clay"],
    sizes: ["XS", "S", "M", "L", "XL"],
    soldOut: ["XS", "XL"],
    sizeTable: "crop",
    short: "숏 기장 지퍼 집업 · 지퍼 참 커스텀 가능",
    desc:
      "탱크에 엎드린 자세에서 밑단이 말려 올라가지 않도록 앞뒤 기장 차를 둔 크롭 집업입니다. 지퍼 슬라이더에 참(charm)을 달 수 있고, 소매에는 리플렉티브 스크립트 로고가 들어갑니다.",
    details: [
      "겉감 : 코튼 80% / 폴리에스터 20% · 400g",
      "프린팅 : 소매 리플렉티브 스크립트 로고",
      "핏 : 여유 있는 크롭 (남녀공용)",
      "부자재 : YKK 양방향 지퍼 · 립 조직 밑단 · 참(charm) 탈부착 가능",
    ],
    charmReady: true,
  },
  {
    id: "reflect-reiten-hoodie",
    name: "Reflect Reiten Hoodie",
    nameKo: "리플렉트 레이튼 후디",
    type: "hoodie",
    category: "후드티",
    price: 89000,
    badge: "Coming",
    images: [null, null, null, null],
    colors: ["black", "white", "pink", "deepblue", "sky", "clay"],
    sizes: ["XS", "S", "M", "L", "XL"],
    soldOut: ["XS"],
    sizeTable: "hoodie",
    short: "Reiten 워드마크 스카치 전사 · 백 프린트",
    desc:
      "등판 전체에 브랜드 워드마크 'Reiten'을 스카치라이트 리플렉티브 전사로 크게 올린 헤비 후디입니다. 낮에는 무광 실버 레터링으로 보이고, 야간 주행 중 헤드라이트를 받으면 글자 전체가 발광합니다.",
    details: [
      "겉감 : 코튼 80% / 폴리에스터 20% · 480g 헤비 기모",
      "프린팅 : 3M 스카치라이트 계열 리플렉티브 전사",
      "핏 : 남녀공용 오버핏 (드롭숄더)",
      "부자재 : 두께감 있는 3겹 후드, 립 조직 밑단",
    ],
  },
  {
    id: "reflect-star-hoodie",
    name: "Reflect Star Hoodie",
    nameKo: "리플렉트 스타 후디",
    type: "hoodie",
    category: "후드티",
    price: 89000,
    badge: "Coming",
    images: [null, null, null, null],
    colors: ["black", "white", "pink", "deepblue", "sky", "clay"],
    sizes: ["XS", "S", "M", "L", "XL"],
    soldOut: ["XS"],
    sizeTable: "hoodie",
    short: "트라이벌 스타 스카치 전사 · 백 프린트",
    desc:
      "별 모양을 트라이벌 라인으로 옮긴 백 그래픽입니다. 하트 후디와 같은 라인 굵기로 디자인해 시리즈로 매치하기 좋습니다. 어두울수록 라인이 또렷하게 발광합니다.",
    details: [
      "겉감 : 코튼 80% / 폴리에스터 20% · 480g 헤비 기모",
      "프린팅 : 3M 스카치라이트 계열 리플렉티브 전사",
      "핏 : 남녀공용 오버핏 (드롭숄더)",
      "부자재 : 두께감 있는 3겹 후드, 립 조직 밑단",
    ],
  },
  {
    id: "reflect-flame-hand-hoodie",
    name: "Reflect Flame Hand Hoodie",
    nameKo: "리플렉트 플레임 핸드 후디",
    type: "hoodie",
    category: "후드티",
    price: 89000,
    badge: "Coming",
    images: [null, null, null, null],
    colors: ["black", "white", "pink", "deepblue", "sky", "clay"],
    sizes: ["XS", "S", "M", "L", "XL"],
    soldOut: ["XS"],
    sizeTable: "hoodie",
    short: "머플러를 쥔 손 · 플레임 스카치 전사 백 프린트",
    desc:
      "이그저스트 후디의 화염 머플러 그래픽에 그것을 움켜쥔 손을 더한 버전입니다. 라인이 가늘수록 반사 대비가 강해져서, 어두울수록 그림이 또렷해집니다.",
    details: [
      "겉감 : 코튼 80% / 폴리에스터 20% · 480g 헤비 기모",
      "프린팅 : 3M 스카치라이트 계열 리플렉티브 전사",
      "핏 : 남녀공용 오버핏 (드롭숄더)",
      "부자재 : 두께감 있는 3겹 후드, 립 조직 밑단",
    ],
  },
];

/* =========================================================
   지퍼 참 (charm)
   ---------------------------------------------------------
   viewBox 0 0 100 120 기준. 상단 링은 스튜디오가 그립니다.
   ========================================================= */
const CHARM_PRICE = 0;

const FINISHES = [
  { key: "silver", label: "리플렉티브 실버", note: "빛을 받으면 발광" },
  { key: "black",  label: "매트 블랙",      note: "무광 메탈" },
  { key: "color",  label: "컬러",           note: "에나멜 도장" },
];

/* =========================================================
   추가 아이템 (extras)
   ---------------------------------------------------------
   벡터 참과 달리 실제 사진으로만 보여주는 add-on(인형·DIY 팔찌 등).
   image가 null이면 "사진 준비중"으로 표시됩니다. 여러 개 동시 선택 가능.
   ========================================================= */
const EXTRA_PRICE = 9000;

const EXTRAS = [
  { key: "flower-doll",   label: "플라워 인형 참", desc: "손뜨개 꽃 인형이 매달리는 참", image: null },
  { key: "bead-bracelet", label: "비즈 팔찌 참",   desc: "컬러 비즈로 엮은 DIY 팔찌형 참", image: null },
];

const CHARMS = [
  {
    key: "none",
    label: "없음",
    accent: "#000000",
    paths: [],
  },
  {
    key: "star",
    label: "스타",
    accent: "#f0b429",
    paths: [
      { d: "M50,34 L58.2,58.7 L83.3,58.7 L63,74 L70.7,99 L50,83.6 L29.3,99 L37,74 L16.7,58.7 L41.8,58.7 Z", role: "main" },
    ],
  },
  {
    key: "cherry",
    label: "체리",
    accent: "#d92d3a",
    paths: [
      { d: "M50,26 C50,48 40,54 34,66 M50,26 C50,50 62,56 68,70", role: "stroke" },
      { d: "M50,26 C58,15 74,17 78,26 C70,35 55,34 50,26 Z", role: "leaf" },
      { d: "M34,66 m-15,0 a15,15 0 1,0 30,0 a15,15 0 1,0 -30,0 Z", role: "main" },
      { d: "M68,72 m-15,0 a15,15 0 1,0 30,0 a15,15 0 1,0 -30,0 Z", role: "main" },
    ],
  },
  {
    key: "helmet",
    label: "헬멧",
    accent: "#3b6fb0",
    paths: [
      { d: "M50,26 C71,26 85,42 85,63 L85,84 C85,92 79,97 71,97 L36,97 C24,97 15,88 15,72 L15,60 C15,40 29,26 50,26 Z", role: "main" },
      { d: "M27,57 C33,47 44,42 57,42 C67,42 76,45 81,50 L81,68 L29,68 C26,64 25,60 27,57 Z", role: "accent" },
    ],
  },
  {
    key: "horseshoe",
    label: "말굽",
    accent: "#a98247",
    paths: [
      { d: "M22,100 L22,64 C22,41 34,26 50,26 C66,26 78,41 78,64 L78,100 L62,100 L62,64 C62,51 57,43 50,43 C43,43 38,51 38,64 L38,100 Z", role: "main" },
      { d: "M30,58 m-3,0 a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0 Z", role: "hole" },
      { d: "M70,58 m-3,0 a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0 Z", role: "hole" },
      { d: "M29,78 m-3,0 a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0 Z", role: "hole" },
      { d: "M71,78 m-3,0 a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0 Z", role: "hole" },
    ],
  },
  {
    key: "flame",
    label: "플레임",
    accent: "#ef6c1f",
    paths: [
      { d: "M50,22 C59,42 76,50 76,70 C76,88 64,101 50,101 C36,101 24,88 24,70 C24,57 33,53 37,45 C39,56 46,56 46,47 C46,37 46,30 50,22 Z", role: "main" },
    ],
  },
  {
    key: "heart",
    label: "트라이벌 하트",
    accent: "#d92d3a",
    paths: [
      { d: "M50,102 C18,79 12,56 21,42 C30,28 46,31 50,45 C54,31 70,28 79,42 C88,56 82,79 50,102 Z", role: "main" },
    ],
  },
  {
    key: "bolt",
    label: "볼트",
    accent: "#f0b429",
    paths: [
      { d: "M60,24 L28,70 L47,70 L40,104 L74,54 L54,54 Z", role: "main" },
    ],
  },
  {
    key: "key",
    label: "키",
    accent: "#a98247",
    paths: [
      { d: "M50,26 m-19,0 a19,19 0 1,0 38,0 a19,19 0 1,0 -38,0 Z M50,26 m-8,0 a8,8 0 1,1 16,0 a8,8 0 1,1 -16,0 Z", role: "main", evenodd: true },
      { d: "M44,44 L44,104 L56,104 L56,96 L65,96 L65,88 L56,88 L56,80 L67,80 L67,72 L56,72 L56,44 Z", role: "main" },
    ],
  },
];

/* 룩북 슬롯 — 사진이 준비되면 src 를 채우면 됩니다 */
const LOOKBOOK = [
  { span: "w8",  ratio: "16/10", label: "01 — Night Ride / 남산",     note: "헤드라이트 반사 컷" },
  { span: "w4",  ratio: "3/4",   label: "02 — Detail / 지퍼 참",       note: "클로즈업" },
  { span: "w4",  ratio: "3/4",   label: "03 — Back Print",             note: "주간 / 야간 대비" },
  { span: "w4",  ratio: "3/4",   label: "04 — Crop Hoodie",            note: "라이딩 자세" },
  { span: "w4",  ratio: "3/4",   label: "05 — Zip Hoodie / 6 Colors",  note: "컬러 랩업" },
  { span: "w12", ratio: "21/9",  label: "06 — Film Still",             note: "라이딩 필름 캡처" },
  { span: "w6",  ratio: "4/5",   label: "07 — Duo",                    note: "남녀 스타일링" },
  { span: "w6",  ratio: "4/5",   label: "08 — Garage",                 note: "정비 컷" },
];

/* 상품 리뷰 — server/가 떠 있으면 /api/reviews가 우선이고, 없으면(정적 배포) 이 배열이
   그대로 보여집니다. 실제 리뷰가 쌓이기 전까지는 비워둡니다(가짜 후기 금지). */
const REVIEWS = [];

/* Node.js(서버)에서도 같은 상품/가격 데이터를 재사용할 수 있도록 내보낸다.
   브라우저에는 module이 없으므로 아무 영향이 없다. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { SITE, COURIERS, COLORS, SIZE_TABLES, PROTECTOR_GUIDE, PRODUCTS, CHARM_PRICE, FINISHES, CHARMS, EXTRA_PRICE, EXTRAS, LOOKBOOK, REVIEWS };
}
