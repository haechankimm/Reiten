/* =========================================================
   REITEN — 다국어(i18n)
   ---------------------------------------------------------
   기본 언어는 한국어이며, 한국어 원문 자체를 딕셔너리 키로 씁니다.
   따라서 ko 상태에서는 아무것도 치환하지 않고 마크업 그대로 보여줍니다.
   ========================================================= */

const LANG_KEY = "reiten_lang";
const LANGS = ["ko", "en", "ja", "de"];
/* 고객용 헤더 언어 전환 메뉴에는 "de"를 노출하지 않는다 — 독일어는 관리자 패널 전용(계정 페이지의
   전용 스위치)으로만 제공된다. app.js의 헤더 렌더링은 이 배열을 사용해야 한다(LANGS 전체가 아님). */
const PUBLIC_LANGS = ["ko", "en", "ja"];
const LANG_LABEL = { ko: "한국어", en: "English", ja: "日本語", de: "Deutsch" };

function getLang() {
  try {
    const l = localStorage.getItem(LANG_KEY);
    return LANGS.includes(l) ? l : "ko";
  } catch (e) {
    return "ko";
  }
}

function setLang(lang) {
  if (!LANGS.includes(lang) || lang === getLang()) return;
  try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
  location.reload();
}

/* key: 한국어 원문(또는 의미 단위 키) → { en, ja } */
const I18N = {
  /* ---------- 헤더 / 푸터 / 공용 ---------- */
  "REITEN 홈": { en: "REITEN home", ja: "REITEN ホーム" },
  "주요 메뉴": { en: "Main menu", ja: "メインメニュー" },
  "언어 선택": { en: "Select language", ja: "言語を選択" },
  "야간 주행 모드 전환": { en: "Toggle night-ride mode", ja: "ナイトライドモード切替" },
  "야간 주행 모드": { en: "Night-ride mode", ja: "ナイトライドモード" },
  "장바구니": { en: "Cart", ja: "カート" },
  "메뉴 열기": { en: "Open menu", ja: "メニューを開く" },
  "Reiten — 독일어로 '타다'.<br>말에서 기계로 옮겨 탄 사람들을 위한 옷.": {
    en: "Reiten — German for 'to ride'.<br>Clothing for those who traded reins for a throttle.",
    ja: "Reiten — ドイツ語で「乗る」。<br>手綱からスロットルへ、乗り換えた人たちの服。",
  },
  "전체 상품": { en: "All Products", ja: "全商品" },
  "전체": { en: "All", ja: "すべて" },
  "후드티": { en: "Hoodies", ja: "フーディー" },
  "후드집업": { en: "Zip Hoodies", ja: "ジップフーディー" },
  "크롭 후드티": { en: "Crop Hoodies", ja: "クロップフーディー" },
  "티셔츠": { en: "T-Shirts", ja: "Tシャツ" },
  "지퍼 참 스튜디오": { en: "Zip Charm Studio", ja: "ジップチャームスタジオ" },
  "브랜드 스토리": { en: "Brand Story", ja: "ブランドストーリー" },
  "룩북 / 라이딩 필름": { en: "Lookbook / Riding Film", ja: "ルックブック / ライディングフィルム" },
  "소재 & 관리법": { en: "Material & Care", ja: "素材とお手入れ" },
  "배송 · 교환 안내": { en: "Shipping & Exchanges", ja: "配送・交換案内" },
  "개인정보처리방침": { en: "Privacy Policy", ja: "プライバシーポリシー" },
  "이용약관": { en: "Terms of Service", ja: "利用規約" },
  "대표": { en: "CEO", ja: "代表" },
  "사업자등록번호": { en: "Business Reg. No.", ja: "事業者登録番号" },
  "통신판매업신고": { en: "Mail-order Business No.", ja: "通信販売業申告番号" },
  "개인정보관리책임자": { en: "Privacy Officer", ja: "個人情報管理責任者" },
  "사진 준비중": { en: "Photo coming soon", ja: "写真準備中" },
  "{label} 참": { en: "{label} Charm", ja: "{label} チャーム" },
  "후드집업 미리보기 — 선택한 컬러와 지퍼 참이 반영됩니다": {
    en: "Zip hoodie preview — reflects the selected color and zip charm",
    ja: "ジップフーディーのプレビュー — 選択したカラーとジップチャームを反映",
  },
  "크롭 후드집업 미리보기 — 선택한 컬러와 지퍼 참이 반영됩니다": {
    en: "Crop zip hoodie preview — reflects the selected color and zip charm",
    ja: "クロップジップフーディーのプレビュー — 選択したカラーとジップチャームを反映",
  },
  "본문으로 건너뛰기": { en: "Skip to content", ja: "本文へスキップ" },
  "내 계정": { en: "My Account", ja: "マイページ" },
  "관리자": { en: "Admin", ja: "管理者" },
  "상품 문의": { en: "Product Q&A", ja: "商品に関するお問い合わせ" },
  "주문 조회": { en: "Track Order", ja: "注文照会" },
  "반품 · 교환 신청": { en: "Returns & Exchanges", ja: "返品・交換申請" },

  /* ---------- 홈 ---------- */
  "Reiten — 독일어로 '타다'": { en: "Reiten — German for 'to ride'", ja: "Reiten — ドイツ語で「乗る」" },
  "보이지": { en: "If you're", ja: "見えなければ" },
  "않으면": { en: "not seen,", ja: "" },
  "위험하다": { en: "you're in danger", ja: "危険だ" },
  "말에서 기계로 옮겨 탄 사람들을 위한 옷. 등판 전체에 올린 스카치 리플렉티브 전사는 낮에는 무광 실버 그래픽으로, 밤에는 헤드라이트를 되쏘는 안전 장비로 작동합니다.": {
    en: "Clothing for those who traded reins for a throttle. The Scotch reflective print covering the back reads as matte silver graphics by day, and by night becomes safety gear that bounces headlights straight back.",
    ja: "手綱からスロットルへ、乗り換えた人たちのための服。背中全体にあしらったスコッチ反射転写プリントは、昼間はマットシルバーのグラフィックに見え、夜はヘッドライトを跳ね返す安全装備として機能します。",
  },
  "컬렉션 보기": { en: "Shop Collection", ja: "コレクションを見る" },
  "지퍼 참 만들기": { en: "Build a Zip Charm", ja: "ジップチャームを作る" },
  "남녀공용 오버핏 · S–XL ·": { en: "Unisex oversized · S–XL · Free shipping over", ja: "男女兼用オーバーサイズ · S–XL ·" },
  "이상 무료배송": { en: "", ja: "以上で送料無料" },
  "커서를 올려 빛을 비춰보세요": { en: "Hover to shine a light on it", ja: "カーソルを合わせて光を当ててみてください" },
  "← 빛을 비춰보세요": { en: "← Shine a light on it", ja: "← 光を当ててみてください" },
  "그래픽이 곧<br>안전장비가 된다": { en: "The graphic itself<br>becomes safety gear", ja: "グラフィックが<br>そのまま安全装備になる" },
  "유리 비드가 박힌 재귀반사 필름을 열전사로 올렸습니다. 빛이 들어온 방향으로 그대로 되돌려 보내기 때문에, 마주 오는 차의 헤드라이트 아래에서만 정확히 발광합니다. 리플렉티브 조끼를 따로 걸치지 않아도 되는 이유입니다.": {
    en: "We heat-pressed on a retro-reflective film embedded with glass beads. It sends light straight back the way it came, so it lights up precisely under an oncoming car's headlights — no separate reflective vest required.",
    ja: "ガラスビーズを埋め込んだ再帰反射フィルムを熱転写しました。入ってきた光をそのままの方向へ送り返すため、対向車のヘッドライトの下でのみ正確に発光します。反射ベストを別に羽織る必要がない理由です。",
  },
  "— 3M 스카치라이트 계열 재귀반사 전사": { en: "— 3M Scotchlite-grade retro-reflective transfer", ja: "— 3M スコッチライト系再帰反射転写" },
  "— 480g 헤비 기모 · 워싱 후에도 반사율 유지": { en: "— 480g heavyweight fleece · Reflectivity holds up after washing", ja: "— 480g ヘビー起毛 · 洗濯後も反射率を維持" },
  "— 뒤집어 미온수 손세탁, 프린트 부위 다림질 금지": { en: "— Hand wash inside-out in lukewarm water; never iron the print", ja: "— 裏返してぬるま湯で手洗い、プリント部分へのアイロン禁止" },
  "관리법 자세히 보기": { en: "See full care guide", ja: "お手入れ方法を詳しく見る" },
  "이번 시즌": { en: "This Season", ja: "今シーズン" },
  "전체 보기": { en: "View All", ja: "すべて見る" },
  "같은 옷을 입어도<br>같아 보이지 않게": { en: "Same hoodie,<br>never the same look", ja: "同じ服でも<br>同じに見えないように" },
  "후드집업 지퍼 슬라이더에 다는 참(charm)을 8종 준비했습니다. 컬러와 참을 고르면 화면에서 바로 조합을 확인할 수 있고, 고른 그대로 주문서에 담깁니다. 리플렉티브 실버 마감을 고르면 참도 밤에 빛납니다.": {
    en: "We made 8 charms to hang from the zip hoodie's slider. Pick a color and a charm to preview the combination instantly, and it carries straight into your order exactly as chosen. Pick the reflective silver finish and the charm glows at night too.",
    ja: "ジップフーディーのスライダーに付けるチャームを8種類用意しました。カラーとチャームを選ぶと画面でその場で組み合わせを確認でき、選んだそのまま注文書に反映されます。リフレクティブシルバー仕上げを選べば、チャームも夜に光ります。",
  },
  "스튜디오 열기": { en: "Open the Studio", ja: "スタジオを開く" },
  "라이딩 필름": { en: "Riding Film", ja: "ライディングフィルム" },
  "룩북 전체": { en: "Full Lookbook", ja: "ルックブック全体" },

  /* ---------- Shop ---------- */
  "전 품목 남녀공용 오버핏입니다. 사이즈 실측은 각 상품 페이지에서 확인하세요.": {
    en: "Every item is unisex oversized. Check size measurements on each product page.",
    ja: "全商品が男女兼用オーバーサイズです。サイズ実寸は各商品ページでご確認ください。",
  },
  "해당 카테고리의 상품이 아직 없습니다.": { en: "There are no products in this category yet.", ja: "このカテゴリーの商品はまだありません。" },

  /* ---------- Product ---------- */
  "함께 보면 좋은 것": { en: "You Might Also Like", ja: "あわせて見たい商品" },
  "최근 본 상품": { en: "Recently Viewed", ja: "最近チェックした商品" },
  "이미지 {n}": { en: "Image {n}", ja: "画像 {n}" },
  "준비중": { en: "Coming soon", ja: "準備中" },
  "남녀공용 오버핏": { en: "Unisex oversized", ja: "男女兼用オーバーサイズ" },
  "수량 줄이기": { en: "Decrease quantity", ja: "数量を減らす" },
  "수량 늘리기": { en: "Increase quantity", ja: "数量を増やす" },
  "지퍼 참을 함께 고르시겠어요?": { en: "Want to pick a zip charm too?", ja: "ジップチャームも一緒に選びますか？" },
  "이 집업은 지퍼 슬라이더에 참(charm)을 달 수 있습니다.": {
    en: "This zip hoodie lets you hang a charm on the zipper slider.",
    ja: "このジップフーディーは、スライダーにチャームを取り付けられます。",
  },
  "스튜디오에서 조합하기": { en: "Build it in the Studio", ja: "スタジオで組み合わせる" },
  "품절": { en: "Sold Out", ja: "売り切れ" },
  "{size} 품절": { en: "{size} sold out", ja: "{size} 売り切れ" },
  "장바구니 담기": { en: "Add to Cart", ja: "カートに追加" },
  "바로 주문": { en: "Buy Now", ja: "今すぐ注文" },
  "품절된 사이즈가 있나요?": { en: "Is your size sold out?", ja: "品切れのサイズがありますか？" },
  "재입고되면 이메일로 알려드릴게요.": { en: "We'll email you when it's back in stock.", ja: "再入荷時にメールでお知らせします。" },
  "이메일 주소": { en: "Email address", ja: "メールアドレス" },
  "알림 신청": { en: "Notify me", ja: "通知を申し込む" },
  "재입고 알림 신청": { en: "Notify me when restocked", ja: "再入荷通知を申し込む" },
  "신청 완료! 재입고되면 알려드릴게요.": { en: "Done! We'll email you when it's restocked.", ja: "申し込み完了！再入荷時にメールでお知らせします。" },
  "신청에 실패했습니다": { en: "Failed to submit", ja: "申し込みに失敗しました" },
  "제품 정보": { en: "Product Info", ja: "商品情報" },
  "사이즈 실측 (cm)": { en: "Size Chart (cm)", ja: "サイズ実寸 (cm)" },
  "측정 방식에 따라 1~3cm 오차가 있을 수 있습니다.": { en: "Measurements may vary by 1–3cm depending on method.", ja: "測定方法により1〜3cmの誤差が生じることがあります。" },
  "세탁 · 관리": { en: "Washing & Care", ja: "洗濯・お手入れ" },
  "— 뒤집어서 30℃ 이하 미온수 단독 손세탁을 권장합니다.": { en: "— Hand wash separately, inside-out, in water below 30℃.", ja: "— 裏返して30℃以下のぬるま湯で単独手洗いを推奨します。" },
  "— 리플렉티브 프린트 위에 직접 다림질하지 마세요. 반사층이 손상됩니다.": { en: "— Never iron directly on the reflective print — it damages the reflective layer.", ja: "— リフレクティブプリントに直接アイロンをかけないでください。反射層が傷みます。" },
  "— 건조기·표백제 사용 금지, 그늘에서 뉘어 말리세요.": { en: "— No tumble dryer or bleach — dry flat in the shade.", ja: "— 乾燥機・漂白剤の使用は禁止、日陰で平干ししてください。" },
  "— 드라이클리닝은 프린트 박리의 원인이 됩니다.": { en: "— Dry cleaning can cause the print to peel.", ja: "— ドライクリーニングはプリント剥離の原因になります。" },
  "배송 · 교환/반품": { en: "Shipping & Returns", ja: "配送・交換/返品" },
  "— 배송비 {fee} · {free} 이상 무료": { en: "— Shipping {fee} · Free over {free}", ja: "— 送料 {fee}・{free}以上で無料" },
  "— 배송비 {fee} · {free} 이상 구매 시 무료": { en: "— Shipping {fee} · Free on orders over {free}", ja: "— 送料 {fee}・{free}以上のご購入で無料" },
  "— 단순 변심 교환/반품은 수령 후 7일 이내, 왕복 배송비 고객 부담입니다.": {
    en: "— Change-of-mind exchanges/returns within 7 days of receipt; customer covers round-trip shipping.",
    ja: "— 単純な気変わりによる交換・返品は受取後7日以内、往復送料はお客様負担です。",
  },
  "— 착용·세탁 흔적이 있거나 택을 제거한 경우 교환/반품이 어렵습니다.": {
    en: "— Exchanges/returns aren't possible if the item shows signs of wear/washing or the tag has been removed.",
    ja: "— 着用・洗濯の跡がある場合やタグを外した場合は交換・返品が難しくなります。",
  },
  "컬러": { en: "Color", ja: "カラー" },
  "사이즈": { en: "Size", ja: "サイズ" },
  "{name} · {size} 담았습니다": { en: "Added {name} · {size} to cart", ja: "{name}・{size}をカートに追加しました" },

  /* ---------- Lookbook ---------- */
  "낮과 밤,<br>두 벌처럼 입는 한 벌": { en: "Day and night,<br>one piece that wears like two", ja: "昼と夜、<br>二着のように着る一着" },
  "같은 옷이 조명 아래에서 어떻게 달라지는지 기록합니다. 룩북과 라이딩 필름 스틸은 촬영이 끝나는 대로 이 자리에 채워집니다.": {
    en: "A record of how the same garment changes under different light. Lookbook and riding-film stills will fill this space as soon as shooting wraps.",
    ja: "同じ服が光の下でどう変わるかを記録します。ルックブックとライディングフィルムのスチールは、撮影が終わり次第この場所に追加されます。",
  },
  "참 갤러리": { en: "Charm Gallery", ja: "チャームギャラリー" },
  "지퍼 참 스튜디오의 벡터 미리보기와 달리, 여기서는 실제 참 사진을 확인할 수 있습니다. 촬영이 끝나는 대로 하나씩 채워집니다.": {
    en: "Unlike the vector preview in the Zip Charm Studio, this page shows real photos of each charm. They'll be filled in one by one as shooting wraps.",
    ja: "ジップチャームスタジオのベクタープレビューとは異なり、ここでは実際のチャーム写真を確認できます。撮影が終わり次第、一つずつ追加されます。",
  },
  "지퍼 참 8종": { en: "8 Zip Charms", ja: "ジップチャーム8種" },
  "아래 칸은 실제 사진이 들어갈 자리입니다.": { en: "The tiles below are placeholders for real photos.", ja: "下の枠は実際の写真が入る場所です。" },
  "촬영 준비 중": { en: "Shoot in Progress", ja: "撮影準備中" },
  "아래 칸은 실제 사진이 들어갈 자리입니다. 각 칸의 비율에 맞춰 이미지를 준비해 주세요.": {
    en: "The tiles below are placeholders for real photos. Prepare images matching each tile's aspect ratio.",
    ja: "下の枠は実際の写真が入る場所です。各枠の比率に合わせて画像をご用意ください。",
  },
  "배열에": { en: "array — add", ja: "配列に" },
  "를 추가하면 자동으로 채워집니다.": { en: " and it fills in automatically.", ja: " を追加すると自動的に反映されます。" },

  /* ---------- About ---------- */
  "말에서 기계로<br>옮겨 탄 사람들": { en: "From horseback<br>to the throttle", ja: "馬から機械へ<br>乗り換えた人々" },
  "Reiten [ˈʁaɪtn̩] — 독일어로 '타다'. 고삐를 쥐던 손이 스로틀을 쥐게 된 것뿐, 달리고 싶다는 마음은 바뀌지 않았습니다.": {
    en: "Reiten [ˈʁaɪtn̩] — German for 'to ride'. The hand that once held the reins now grips a throttle — the will to ride never changed.",
    ja: "Reiten [ˈʁaɪtn̩] — ドイツ語で「乗る」。手綱を握っていた手がスロットルを握るようになっただけで、走りたいという気持ちは変わりません。",
  },
  "브랜드 이름에 말이 있는 이유": { en: "Why there's a horse in our name", ja: "ブランド名に馬がいる理由" },
  "독일에서 <i>reiten</i>은 원래 말을 타는 것을 뜻하는 동사입니다. 지금은 오토바이를 타는 일에도 같은 단어를 씁니다. 수백 년 사이에 타는 대상은 바뀌었지만 단어는 그대로 남았습니다.": {
    en: "In German, <i>reiten</i> originally meant to ride a horse. Today the same word is used for riding a motorcycle. Over hundreds of years, what we ride changed — the word stayed the same.",
    ja: "ドイツ語で<i>reiten</i>はもともと馬に乗ることを意味する動詞です。今ではオートバイに乗ることにも同じ言葉が使われます。数百年の間に乗るものは変わりましたが、言葉はそのまま残りました。",
  },
  "우리는 그 지점이 좋았습니다. 로고에 말과 바이크를 나란히 세운 것도 같은 이유입니다. REITEN은 특정 기종이나 배기량, 라이딩 스타일을 나누지 않습니다. 남녀 구분 없이 한 벌을 만들고, 사이즈로만 나눕니다.": {
    en: "We loved that. It's why our logo sets a horse and a bike side by side. REITEN doesn't divide by model, engine size, or riding style. We make one garment for everyone and split it only by size.",
    ja: "私たちはその点が気に入りました。ロゴに馬とバイクを並べたのも同じ理由です。REITENは車種や排気量、ライディングスタイルで分けません。男女の区別なく一着を作り、サイズだけで分けます。",
  },
  "멋있어 보이는 옷과 안전한 옷 중에 하나를 고르게 하고 싶지 않았습니다. 그래서 그래픽 자체를 반사재로 만들었습니다.": {
    en: "We didn't want to make you choose between looking good and staying safe. So we made the graphic itself the reflective material.",
    ja: "かっこいい服と安全な服のどちらかを選ばせたくありませんでした。だからグラフィック自体を反射素材にしました。",
  },
  "되돌려 보내는 빛": { en: "Light, sent back", ja: "送り返す光" },
  "일반적인 흰색 프린트는 빛을 사방으로 흩뿌립니다. 재귀반사(retro-reflective) 소재는 미세한 유리 비드가 들어 있어, 들어온 빛을 <b>온 방향 그대로</b> 되돌려 보냅니다. 그래서 마주 오는 운전자의 시점에서만 강하게 빛나고, 옆에서 보면 무광 실버로 보입니다.": {
    en: "An ordinary white print scatters light in every direction. Retro-reflective material contains microscopic glass beads that send incoming light <b>straight back the way it came</b>. That's why it glows strongly only from an oncoming driver's point of view, and reads as matte silver from the side.",
    ja: "通常の白プリントは光を四方に散らします。再帰反射素材は微細なガラスビーズを含んでおり、入ってきた光を<b>そのままの方向へ</b>送り返します。だから対向するドライバーの視点でのみ強く光り、横から見るとマットシルバーに見えます。",
  },
  "반사 조끼를 한 겹 더 걸치는 대신, 입고 있던 후디의 그래픽이 그 일을 합니다. 디자인을 포기하지 않아도 되는 방식입니다.": {
    en: "Instead of layering on a reflective vest, the graphic on the hoodie you're already wearing does the job. A way to stay safe without giving up on design.",
    ja: "反射ベストをもう一枚羽織る代わりに、着ているフーディーのグラフィックがその役割を果たします。デザインを諦めなくていい方法です。",
  },
  "원단": { en: "Fabric", ja: "生地" },
  "— 후디 : 코튼 80% / 폴리 20%, 480g 헤비 기모": { en: "— Hoodie: 80% cotton / 20% poly, 480g heavyweight fleece", ja: "— フーディー：コットン80％／ポリ20％、480gヘビー起毛" },
  "— 집업 : 코튼 100%, 420g (일부 가먼트 워싱)": { en: "— Zip hoodie: 100% cotton, 420g (garment-washed on select styles)", ja: "— ジップフーディー：コットン100％、420g（一部ガーメントウォッシュ）" },
  "— 립 조직 밑단 · 소매, 3겹 후드": { en: "— Ribbed hem & cuffs, 3-layer hood", ja: "— リブ編みの裾・袖、3層フード" },
  "— 남녀공용 오버핏, 드롭숄더 패턴": { en: "— Unisex oversized fit, drop-shoulder pattern", ja: "— 男女兼用オーバーサイズ、ドロップショルダーパターン" },
  "세탁": { en: "Washing", ja: "洗濯" },
  "— 뒤집어서 30℃ 이하 미온수 단독 세탁": { en: "— Wash inside-out, separately, below 30℃", ja: "— 裏返して30℃以下のぬるま湯で単独洗い" },
  "— 중성세제 사용, 표백제 금지": { en: "— Use neutral detergent, no bleach", ja: "— 中性洗剤を使用、漂白剤は禁止" },
  "— 세탁기 사용 시 세탁망 + 울코스": { en: "— If machine washing, use a laundry bag on the wool/delicate cycle", ja: "— 洗濯機使用時は洗濯ネット＋ウールコース" },
  "— 건조기 금지, 그늘에서 뉘어 건조": { en: "— No tumble dryer — dry flat in the shade", ja: "— 乾燥機は禁止、日陰で平干し" },
  "프린트 보호": { en: "Print Protection", ja: "プリント保護" },
  "— 프린트 위 직접 다림질 금지 (반사층 손상)": { en: "— Never iron directly on the print (damages the reflective layer)", ja: "— プリントへの直接のアイロンは禁止（反射層が傷みます）" },
  "— 구김은 뒷면에서 저온으로, 천을 덧대어": { en: "— For wrinkles, iron on the reverse at low heat with a cloth in between", ja: "— シワは裏面から低温で、当て布をして" },
  "— 드라이클리닝은 박리의 원인이 됩니다": { en: "— Dry cleaning can cause peeling", ja: "— ドライクリーニングは剥離の原因になります" },
  "— 접어 보관보다 걸어 보관을 권장합니다": { en: "— Hanging storage is recommended over folding", ja: "— 畳んでの保管より、吊るしての保管を推奨します" },
  "배송 · 교환 · 반품": { en: "Shipping, Exchanges & Returns", ja: "配送・交換・返品" },
  "배송": { en: "Shipping", ja: "配送" },
  "— 제주 · 도서산간 지역은 추가 배송비가 발생합니다.": { en: "— Additional shipping fees apply to Jeju and other remote island/mountain areas.", ja: "— 済州・離島地域は追加送料が発生します。" },
  "— 주문 폭주 · 원단 수급 상황에 따라 출고가 지연될 수 있으며, 지연 시 개별 안내드립니다.": {
    en: "— Shipping may be delayed during high order volume or fabric supply issues; we'll notify you individually if it happens.",
    ja: "— 注文の集中・生地の入荷状況により発送が遅れる場合があり、その際は個別にご案内します。",
  },
  "교환 · 반품": { en: "Exchanges & Returns", ja: "交換・返品" },
  "— 단순 변심 : 수령일로부터 7일 이내 접수, 왕복 배송비 고객 부담": { en: "— Change of mind: request within 7 days of receipt, customer covers round-trip shipping", ja: "— 単純な気変わり：受取日から7日以内に受付、往復送料はお客様負担" },
  "— 상품 하자 · 오배송 : 수령일로부터 30일 이내, 배송비 전액 판매자 부담": { en: "— Defects or wrong item: within 30 days of receipt, seller covers shipping in full", ja: "— 商品の不良・誤配送：受取日から30日以内、送料は全額販売者負担" },
  "— 착용 · 세탁 흔적이 있거나 택을 제거한 경우 교환 · 반품이 제한됩니다.": { en: "— Exchanges/returns are restricted if the item shows wear/wash marks or the tag has been removed.", ja: "— 着用・洗濯の跡がある場合やタグを外した場合は交換・返品が制限されます。" },
  "— 지퍼 참을 조합한 커스텀 주문도 위 기준을 동일하게 적용합니다.": { en: "— Custom orders with a zip charm combination follow the same criteria above.", ja: "— ジップチャームを組み合わせたカスタム注文も上記基準を同様に適用します。" },
  "— 접수는 고객센터 이메일 또는 카카오톡 채널로 주문번호와 함께 남겨주세요.": { en: "— Submit requests with your order number via our customer service email or KakaoTalk channel.", ja: "— お問い合わせは注文番号とともにカスタマーサポートのメールまたはカカオトークチャンネルへご連絡ください。" },
  "사이즈 선택": { en: "Choosing a Size", ja: "サイズの選び方" },
  "전 품목 남녀공용 오버핏입니다. 평소 사이즈 그대로 고르시면 넉넉하게 맞습니다.": { en: "Every item is unisex oversized. Your usual size will fit generously.", ja: "全商品が男女兼用オーバーサイズです。普段のサイズをそのまま選ぶとゆったり着られます。" },
  "판매자 정보": { en: "Seller Information", ja: "販売者情報" },
  "상호": { en: "Company", ja: "商号" },
  "대표자": { en: "CEO", ja: "代表者" },
  "사업장 주소": { en: "Business Address", ja: "事業所住所" },
  "연락처": { en: "Contact", ja: "連絡先" },
  "카카오톡 채널": { en: "KakaoTalk Channel", ja: "カカオトーク チャンネル" },
  "이메일": { en: "Email", ja: "メール" },

  /* ---------- Cart / Order ---------- */
  "장바구니가 비어 있습니다.": { en: "Your cart is empty.", ja: "カートは空です。" },
  "컬렉션 보러 가기": { en: "Browse the Collection", ja: "コレクションを見に行く" },
  "주문서": { en: "Order Form", ja: "注文フォーム" },
  "아래 정보를 남기시면 주문번호가 발급됩니다. 입금이 확인되면 순차 출고됩니다.": {
    en: "Fill in the details below to receive an order number. Items ship in order once payment is confirmed.",
    ja: "以下の情報をご入力いただくと注文番号が発行されます。ご入金確認後、順次発送します。",
  },
  '주문자 이름 <span class="req">*</span>': { en: 'Full name <span class="req">*</span>', ja: 'お名前 <span class="req">*</span>' },
  "이름을 입력해 주세요.": { en: "Please enter your name.", ja: "お名前をご入力ください。" },
  '연락처 <span class="req">*</span>': { en: 'Phone number <span class="req">*</span>', ja: '電話番号 <span class="req">*</span>' },
  "연락처를 정확히 입력해 주세요.": { en: "Please enter a valid phone number.", ja: "正しい電話番号をご入力ください。" },
  '이메일 <span class="req">*</span>': { en: 'Email <span class="req">*</span>', ja: 'メールアドレス <span class="req">*</span>' },
  "주문 확인 메일을 받을 주소": { en: "Address to receive order confirmation", ja: "注文確認メールを受け取るアドレス" },
  "이메일 형식을 확인해 주세요.": { en: "Please check your email format.", ja: "メールアドレスの形式をご確認ください。" },
  '우편번호 <span class="req">*</span>': { en: 'Postal code <span class="req">*</span>', ja: '郵便番号 <span class="req">*</span>' },
  "우편번호를 입력해 주세요.": { en: "Please enter your postal code.", ja: "郵便番号をご入力ください。" },
  "주소 검색": { en: "Search Address", ja: "住所を検索" },
  "위 '주소 검색' 버튼을 눌러주세요": { en: "Use the 'Search Address' button above", ja: "上の「住所を検索」ボタンをご利用ください" },
  '입금자명 <span class="req">*</span>': { en: 'Depositor name <span class="req">*</span>', ja: 'お振込み名義 <span class="req">*</span>' },
  "입금자명을 입력해 주세요.": { en: "Please enter the depositor's name.", ja: "お振込み名義をご入力ください。" },
  '주소 <span class="req">*</span>': { en: 'Address <span class="req">*</span>', ja: 'ご住所 <span class="req">*</span>' },
  "주소를 입력해 주세요.": { en: "Please enter your address.", ja: "ご住所をご入力ください。" },
  "상세주소": { en: "Address line 2", ja: "詳細住所" },
  "동 · 호수 등": { en: "Apt, unit, etc.", ja: "建物名・号室など" },
  "배송 메모": { en: "Delivery note", ja: "配送メモ" },
  "문 앞에 놓아주세요": { en: "Leave it at the door", ja: "玄関前に置いてください" },
  "경비실에 맡겨주세요": { en: "Leave it with security", ja: "警備室に預けてください" },
  "택배함에 넣어주세요": { en: "Put it in the parcel locker", ja: "宅配ボックスに入れてください" },
  "배송 전 연락 부탁드려요": { en: "Please call before delivery", ja: "配送前にご連絡ください" },
  "직접 입력": { en: "Custom message", ja: "自由入力" },
  "배송 메모를 입력해 주세요": { en: "Enter a delivery note", ja: "配送メモを入力してください" },
  '주문 처리를 위한 개인정보(이름 · 연락처 · 주소) 수집 및 이용에 동의합니다. 수집한 정보는 배송 완료 후 관련 법령이 정한 기간까지만 보관합니다. <span class="req">*</span>': {
    en: 'I agree to the collection and use of personal information (name, phone, address) for order processing. Information is retained only for the period required by law after delivery is complete. <span class="req">*</span>',
    ja: '注文処理のための個人情報（氏名・連絡先・住所）の収集及び利用に同意します。収集した情報は配送完了後、関連法令が定める期間のみ保管します。 <span class="req">*</span>',
  },
  "동의가 필요합니다.": { en: "Agreement is required.", ja: "同意が必要です。" },
  "주문서 제출": { en: "Submit Order", ja: "注文を送信" },
  "결제 금액": { en: "Payment Summary", ja: "お支払い金額" },
  "상품 합계": { en: "Subtotal", ja: "商品合計" },
  "배송비": { en: "Shipping", ja: "送料" },
  "쿠폰 코드": { en: "Coupon code", ja: "クーポンコード" },
  "쿠폰 할인": { en: "Coupon discount", ja: "クーポン割引" },
  "확인 중…": { en: "Checking…", ja: "確認中…" },
  "{discount} 할인이 적용되었습니다.": { en: "{discount} discount applied.", ja: "{discount}割引が適用されました。" },
  "쿠폰을 적용할 수 없습니다.": { en: "This coupon can't be applied.", ja: "このクーポンは適用できません。" },
  "총 결제금액": { en: "Total", ja: "合計金額" },
  "무통장 입금": { en: "Bank Transfer", ja: "銀行振込" },
  "신용카드": { en: "Credit Card", ja: "クレジットカード" },
  "결제 수단": { en: "Payment method", ja: "支払い方法" },
  "결제 버튼을 누르면 결제창이 열립니다. 결제가 끝나면 바로 주문이 접수됩니다.": {
    en: "Clicking the payment button opens the payment window. Once payment is complete, your order is placed immediately.",
    ja: "決済ボタンを押すと決済ウィンドウが開きます。決済が完了すると、すぐに注文が受け付けられます。",
  },
  "결제 준비에 실패했습니다": { en: "Failed to prepare payment", ja: "決済の準備に失敗しました" },
  "결제가 취소되었습니다": { en: "Payment was cancelled", ja: "決済がキャンセルされました" },
  "결제 확인에 실패했습니다": { en: "Payment confirmation failed", ja: "決済の確認に失敗しました" },
  "{name} {size} 사이즈 재고가 부족해 결제가 자동 취소되었습니다": {
    en: "{name} — size {size} is out of stock, so the payment was automatically cancelled",
    ja: "{name} {size}サイズの在庫が不足しているため、決済は自動的にキャンセルされました",
  },
  "결제 중 오류가 발생했습니다": { en: "An error occurred during payment", ja: "決済中にエラーが発生しました" },
  "예금주": { en: "Account holder", ja: "口座名義" },
  "주문서 제출 후 24시간 내 미입금 시 자동 취소됩니다.": { en: "If payment isn't received within 24 hours of submitting, the order is automatically cancelled.", ja: "注文送信後24時間以内にご入金がない場合、自動的にキャンセルされます。" },
  "무료": { en: "Free", ja: "無料" },
  "{amount} 더 담으면 배송비가 무료입니다.": { en: "Add {amount} more for free shipping.", ja: "あと{amount}で送料無料になります。" },
  "제출하면 주문서가 바로 전송됩니다.": { en: "Submitting sends your order form immediately.", ja: "送信すると注文フォームがすぐに送られます。" },
  "제출하면 주문번호와 함께 복사용 주문서가 만들어집니다. 이메일 또는 카카오톡으로 보내주세요.": {
    en: "Submitting creates an order number and a copyable order form. Please send it to us by email or KakaoTalk.",
    ja: "送信すると注文番号と、コピー用の注文書が作成されます。メールまたはカカオトークで送ってください。",
  },
  "입력값을 확인해 주세요": { en: "Please check your entries", ja: "入力内容をご確認ください" },
  "장바구니가 비어 있습니다": { en: "Your cart is empty", ja: "カートは空です" },
  "처리 중…": { en: "Processing…", ja: "処理中…" },
  "삭제": { en: "Remove", ja: "削除" },
  "개당 {price}": { en: "{price} each", ja: "1点あたり {price}" },
  "{name} {size} 사이즈 재고가 소진되었습니다": { en: "{name} — size {size} is now out of stock", ja: "{name} {size}サイズの在庫がなくなりました" },

  /* ---------- Order complete ---------- */
  "결제 완료": { en: "Payment Complete", ja: "決済完了" },
  "결제금액": { en: "Payment amount", ja: "決済金額" },
  "표시할 주문 내역이 없습니다.": { en: "There's no order to show.", ja: "表示できる注文内容がありません。" },
  "주문이 접수되었습니다": { en: "Your order has been received", ja: "ご注文を承りました" },
  "주문번호": { en: "Order No.", ja: "注文番号" },
  "{name}님": { en: "{name}", ja: "{name} 様" },
  "입금 안내": { en: "Payment Instructions", ja: "お振込みのご案内" },
  "입금액": { en: "Amount", ja: "入金額" },
  "입금자명": { en: "Depositor", ja: "振込名義" },
  "24시간 내 미입금 시 주문은 자동 취소됩니다. {leadTime}.": { en: "If payment isn't received within 24 hours, the order is automatically cancelled. {leadTime}.", ja: "24時間以内にご入金がない場合、注文は自動的にキャンセルされます。{leadTime}。" },
  "주문서가 정상적으로 전송되었습니다. 확인 후 개별 연락드리겠습니다.": { en: "Your order form was sent successfully. We'll be in touch individually after review.", ja: "注文書は正常に送信されました。確認後、個別にご連絡いたします。" },
  "주문서를 보내주세요": { en: "Please send us your order form", ja: "注文書をお送りください" },
  "아래 주문서를 복사해 이메일 또는 카카오톡으로 보내주시면 접수가 완료됩니다.": {
    en: "Copy the order form below and send it by email or KakaoTalk to complete your order.",
    ja: "下記の注文書をコピーし、メールまたはカカオトークで送っていただくと受付が完了します。",
  },
  "주문서 복사": { en: "Copy Order Form", ja: "注文書をコピー" },
  "이메일로 열기": { en: "Open in Email", ja: "メールで開く" },
  "주문 내역": { en: "Order Details", ja: "注文内容" },
  "상품": { en: "Item", ja: "商品" },
  "옵션": { en: "Options", ja: "オプション" },
  "수량": { en: "Qty", ja: "数量" },
  "금액": { en: "Amount", ja: "金額" },
  "주문서 원문 보기": { en: "View Raw Order Text", ja: "注文書の原文を見る" },
  "쇼핑 계속하기": { en: "Continue Shopping", ja: "ショッピングを続ける" },
  "홈으로": { en: "Home", ja: "ホームへ" },
  "주문서를 복사했습니다": { en: "Order form copied", ja: "注文書をコピーしました" },
  "주문서를 선택했습니다. 복사해 주세요": { en: "Order text selected — please copy it", ja: "注文書を選択しました。コピーしてください" },
  "{email}로 주문 접수 확인 메일을 보내드렸습니다.": { en: "We've sent an order confirmation email to {email}.", ja: "{email} 宛に注文確認メールをお送りしました。" },

  /* ---------- Customizer ---------- */
  "지퍼 참 만들기": { en: "Build Your Zip Charm", ja: "ジップチャームを作る" },
  "컬러와 참을 고르면 왼쪽 미리보기에 바로 반영됩니다. <b>라이트</b> 스위치를 켜면 야간 주행 상황에서 어떻게 보이는지 확인할 수 있습니다.": {
    en: "Pick a color and charm and it reflects instantly in the preview on the left. Flip the <b>Light</b> switch to see how it looks while night riding.",
    ja: "カラーとチャームを選ぶと、左側のプレビューにすぐ反映されます。<b>ライト</b>スイッチをオンにすると、夜間走行時の見え方を確認できます。",
  },
  "라이트": { en: "Light", ja: "ライト" },
  "* 미리보기는 조합 확인용 벡터 이미지입니다. 실제 제품의 색상 · 광택과 차이가 있을 수 있습니다.": {
    en: "* The preview is a vector image for checking combinations. Actual color and sheen may differ.",
    ja: "※ プレビューは組み合わせ確認用のベクター画像です。実際の商品とは色・光沢が異なる場合があります。",
  },
  "합계": { en: "Total", ja: "合計" },
  "참만 따로 구매": { en: "Buy a charm on its own", ja: "チャームだけ購入" },
  "이미 REITEN 집업을 갖고 계시다면 참만 구매할 수 있습니다. 개당": { en: "Already own a REITEN zip hoodie? You can buy just the charm. Each is", ja: "すでにREITENのジップフーディーをお持ちなら、チャームだけ購入できます。1個あたり" },
  "참만 담기": { en: "Add Charm Only", ja: "チャームのみカートに追加" },
  "참 8종": { en: "8 Charms", ja: "チャーム8種" },
  "전 품목 개당": { en: "Each charm is", ja: "全品1個あたり" },
  "· 리플렉티브 실버 / 매트 블랙 / 컬러": { en: "· Reflective Silver / Matte Black / Color", ja: "・リフレクティブシルバー／マットブラック／カラー" },
  "참 없음": { en: "No charm", ja: "チャームなし" },
  "추가 아이템": { en: "Extras", ja: "追加アイテム" },
  "인형·비즈 팔찌 등 실물 참입니다. 여러 개 함께 담을 수 있어요.": {
    en: "Real, photographed charms like dolls and bead bracelets. You can add more than one.",
    ja: "人形・ビーズブレスレットなど実物のチャームです。複数個一緒に選べます。",
  },
  "실물 사진으로 보기": { en: "View real photos", ja: "実物写真で見る" },
  "{n}개 선택": { en: "{n} selected", ja: "{n}個選択" },
  "플라워 인형 참": { en: "Flower Doll Charm", ja: "フラワードールチャーム" },
  "손뜨개 꽃 인형이 매달리는 참": { en: "A hand-knit flower doll that hangs from the zipper", ja: "手編みのお花の人形が揺れるチャーム" },
  "비즈 팔찌 참": { en: "Bead Bracelet Charm", ja: "ビーズブレスレットチャーム" },
  "컬러 비즈로 엮은 DIY 팔찌형 참": { en: "A DIY bracelet-style charm strung with colored beads", ja: "カラービーズを編んだDIYブレスレット型チャーム" },
  "지퍼 참 (선택 안 함)": { en: "Zip Charm (none selected)", ja: "ジップチャーム（選択なし）" },
  "지퍼 참 — {charm}": { en: "Zip Charm — {charm}", ja: "ジップチャーム — {charm}" },
  "조합을 장바구니에 담았습니다": { en: "Added this combination to your cart", ja: "組み合わせをカートに追加しました" },
  "먼저 참을 선택해 주세요": { en: "Please choose a charm first", ja: "先にチャームを選択してください" },
  "참을 장바구니에 담았습니다": { en: "Added the charm to your cart", ja: "チャームをカートに追加しました" },
  "지퍼 참": { en: "Zip Charm", ja: "ジップチャーム" },
  "마감": { en: "Finish", ja: "仕上げ" },
  "선택 안 함": { en: "None selected", ja: "選択なし" },

  /* ---------- 상품 데이터 (data.js) ---------- */
  "리플렉트 하트 후디": { en: "Reflect Heart Hoodie", ja: "リフレクトハートフーディー" },
  "트라이벌 하트 스카치 전사 · 백 프린트": { en: "Tribal heart Scotch transfer · back print", ja: "トライバルハート スコッチ転写・バックプリント" },
  "등판 전체에 스카치라이트 리플렉티브 전사를 올린 헤비 후디입니다. 낮에는 무광 실버 그래픽으로 보이고, 야간 주행 중 헤드라이트를 받으면 그래픽 전체가 발광합니다.": {
    en: "A heavyweight hoodie with a Scotchlite reflective transfer covering the entire back. It reads as matte silver graphics by day, and lights up entirely under headlights during a night ride.",
    ja: "背面全体にスコッチライト反射転写をあしらったヘビーウェイトフーディー。昼はマットシルバーのグラフィックに見え、夜間走行中にヘッドライトを受けるとグラフィック全体が発光します。",
  },
  "리플렉트 이그저스트 후디": { en: "Reflect Exhaust Hoodie", ja: "リフレクトエキゾーストフーディー" },
  "머플러 & 플레임 스카치 전사 · 백 프린트": { en: "Muffler & flame Scotch transfer · back print", ja: "マフラー＆フレイム スコッチ転写・バックプリント" },
  "배기 머플러와 화염을 라인 드로잉으로 옮긴 백 그래픽. 라인이 가늘수록 반사 대비가 강해져서, 어두울수록 그림이 또렷해집니다.": {
    en: "A back graphic that renders an exhaust muffler and flames as line art. The thinner the lines, the stronger the reflective contrast — the darker it gets, the sharper the image.",
    ja: "排気マフラーと炎をラインドローイングで表現したバックグラフィック。線が細いほど反射のコントラストが強くなり、暗いほど絵がくっきり浮かび上がります。",
  },
  "헬멧 집업 후디": { en: "Helmet Zip Hoodie", ja: "ヘルメットジップフーディー" },
  "가먼트 워싱 · 프론트 드로잉 그래픽": { en: "Garment-washed · front line-art graphic", ja: "ガーメントウォッシュ・フロントドローイング" },
  "완성 후 워싱을 먹여 색이 한 톤 빠진 집업입니다. 가슴의 헬멧 드로잉과 소매 로고는 리플렉티브 전사로, 정면에서 빛을 받으면 그래픽만 떠오릅니다.": {
    en: "A zip hoodie garment-washed after construction for a slightly faded tone. The chest helmet drawing and sleeve logo are reflective transfers that appear to float when lit from the front.",
    ja: "縫製後にウォッシュ加工を施し、色味を一段階抜いたジップフーディー。胸のヘルメットドローイングと袖のロゴはリフレクティブ転写で、正面から光を受けるとグラフィックだけが浮かび上がります。",
  },
  "코어 집업 후디": { en: "Core Zip Hoodie", ja: "コアジップフーディー" },
  "6컬러 · 지퍼 참 커스텀 가능": { en: "6 colors · zip charm customizable", ja: "6カラー・ジップチャームカスタム可能" },
  "브랜드의 기본이 되는 집업입니다. 그래픽 없이 소매의 리플렉티브 스크립트 로고만 남겼습니다. 지퍼 슬라이더에 원하는 참(charm)을 달아 조합을 완성하세요.": {
    en: "The brand's foundational zip hoodie. No graphics — just a reflective script logo on the sleeve. Hang the charm of your choice on the zip slider to complete the look.",
    ja: "ブランドの基本となるジップフーディー。グラフィックはなく、袖のリフレクティブスクリプトロゴのみを残しました。ジップスライダーにお好みのチャームを付けて組み合わせを完成させてください。",
  },
  "리플렉트 크롭 후디": { en: "Reflect Crop Hoodie", ja: "リフレクトクロップフーディー" },
  "숏 기장 · 라이딩 자세 기준 패턴": { en: "Cropped length · pattern cut for riding posture", ja: "ショート丈・ライディング姿勢基準パターン" },
  "탱크에 엎드린 자세에서 밑단이 말려 올라가지 않도록 앞뒤 기장 차를 둔 크롭 후디입니다. 촬영 준비 중이며 사진은 곧 업데이트됩니다.": {
    en: "A crop hoodie with a front-back length difference so the hem doesn't ride up when leaning over the tank. Photos are being shot and will be updated soon.",
    ja: "タンクに伏せた姿勢でも裾がまくれ上がらないよう、前後の丈に差をつけたクロップフーディー。撮影準備中のため、写真は近日更新予定です。",
  },
  "겉감 : 코튼 80% / 폴리에스터 20% · 480g 헤비 기모": { en: "Shell: 80% cotton / 20% polyester · 480g heavyweight fleece", ja: "表地：コットン80％／ポリエステル20％・480gヘビー起毛" },
  "프린팅 : 3M 스카치라이트 계열 리플렉티브 전사": { en: "Print: 3M Scotchlite-grade reflective transfer", ja: "プリント：3M スコッチライト系リフレクティブ転写" },
  "핏 : 남녀공용 오버핏 (드롭숄더)": { en: "Fit: Unisex oversized (drop shoulder)", ja: "フィット：男女兼用オーバーサイズ（ドロップショルダー）" },
  "부자재 : 두께감 있는 3겹 후드, 립 조직 밑단": { en: "Trims: Substantial 3-layer hood, ribbed hem", ja: "付属：厚みのある3層フード、リブ編みの裾" },
  "겉감 : 코튼 100% · 420g 가먼트 워싱": { en: "Shell: 100% cotton · 420g, garment-washed", ja: "表地：コットン100％・420g ガーメントウォッシュ" },
  "프린팅 : 리플렉티브 전사 (프론트 · 소매)": { en: "Print: Reflective transfer (front · sleeve)", ja: "プリント：リフレクティブ転写（フロント・袖）" },
  "부자재 : YKK 양방향 지퍼 · 참(charm) 탈부착 가능": { en: "Trims: YKK two-way zipper · charm attaches/detaches", ja: "付属：YKK両開きジッパー・チャーム着脱可能" },
  "겉감 : 코튼 100% · 420g": { en: "Shell: 100% cotton · 420g", ja: "表地：コットン100％・420g" },
  "프린팅 : 소매 리플렉티브 스크립트 로고": { en: "Print: Reflective script logo on sleeve", ja: "プリント：袖のリフレクティブスクリプトロゴ" },
  "겉감 : 코튼 80% / 폴리에스터 20% · 400g": { en: "Shell: 80% cotton / 20% polyester · 400g", ja: "表地：コットン80％／ポリエステル20％・400g" },
  "프린팅 : 리플렉티브 전사": { en: "Print: Reflective transfer", ja: "プリント：リフレクティブ転写" },
  "핏 : 여유 있는 크롭 (남녀공용)": { en: "Fit: Relaxed crop (unisex)", ja: "フィット：ゆったりクロップ（男女兼用）" },
  "부자재 : 립 조직 밑단": { en: "Trims: Ribbed hem", ja: "付属：リブ編みの裾" },

  "리플렉트 크롭 집업 후디": { en: "Reflect Crop Zip Hoodie", ja: "リフレクトクロップジップフーディー" },
  "숏 기장 지퍼 집업 · 지퍼 참 커스텀 가능": { en: "Cropped zip hoodie · zip charm customizable", ja: "ショート丈ジップ・ジップチャームカスタム可能" },
  "탱크에 엎드린 자세에서 밑단이 말려 올라가지 않도록 앞뒤 기장 차를 둔 크롭 집업입니다. 지퍼 슬라이더에 참(charm)을 달 수 있고, 소매에는 리플렉티브 스크립트 로고가 들어갑니다.": {
    en: "A crop zip hoodie with a front-back length difference so the hem doesn't ride up when leaning over the tank. Hang a charm on the zip slider, and the sleeve carries a reflective script logo.",
    ja: "タンクに伏せた姿勢でも裾がまくれ上がらないよう、前後の丈に差をつけたクロップジップフーディー。ジップスライダーにチャームを付けられ、袖にはリフレクティブスクリプトロゴが入ります。",
  },
  "부자재 : YKK 양방향 지퍼 · 립 조직 밑단 · 참(charm) 탈부착 가능": { en: "Trims: YKK two-way zipper · ribbed hem · charm attaches/detaches", ja: "付属：YKK両開きジッパー・リブ編みの裾・チャーム着脱可能" },

  "리플렉트 레이튼 후디": { en: "Reflect Reiten Hoodie", ja: "リフレクトレイテンフーディー" },
  "Reiten 워드마크 스카치 전사 · 백 프린트": { en: "Reiten wordmark Scotch transfer · back print", ja: "Reitenワードマーク スコッチ転写・バックプリント" },
  "등판 전체에 브랜드 워드마크 'Reiten'을 스카치라이트 리플렉티브 전사로 크게 올린 헤비 후디입니다. 낮에는 무광 실버 레터링으로 보이고, 야간 주행 중 헤드라이트를 받으면 글자 전체가 발광합니다.": {
    en: "A heavyweight hoodie with the brand wordmark 'Reiten' rendered large across the back in Scotchlite reflective transfer. It reads as matte silver lettering by day, and lights up entirely under headlights during a night ride.",
    ja: "背面全体にブランドワードマーク「Reiten」を大きくスコッチライト反射転写であしらったヘビーウェイトフーディー。昼はマットシルバーのレタリングに見え、夜間走行中にヘッドライトを受けると文字全体が発光します。",
  },

  "리플렉트 스타 후디": { en: "Reflect Star Hoodie", ja: "リフレクトスターフーディー" },
  "트라이벌 스타 스카치 전사 · 백 프린트": { en: "Tribal star Scotch transfer · back print", ja: "トライバルスター スコッチ転写・バックプリント" },
  "별 모양을 트라이벌 라인으로 옮긴 백 그래픽입니다. 하트 후디와 같은 라인 굵기로 디자인해 시리즈로 매치하기 좋습니다. 어두울수록 라인이 또렷하게 발광합니다.": {
    en: "A back graphic that renders a star shape as tribal line art. Designed with the same line weight as the Heart Hoodie, so it pairs well as a series. The darker it gets, the more sharply the lines glow.",
    ja: "星の形をトライバルラインで表現したバックグラフィック。ハートフーディーと同じ線の太さでデザインしており、シリーズとして合わせやすい仕様です。暗いほどラインがくっきりと発光します。",
  },

  "리플렉트 플레임 핸드 후디": { en: "Reflect Flame Hand Hoodie", ja: "リフレクトフレイムハンドフーディー" },
  "머플러를 쥔 손 · 플레임 스카치 전사 백 프린트": { en: "Hand gripping the muffler · flame Scotch transfer back print", ja: "マフラーを握る手・フレイム スコッチ転写バックプリント" },
  "이그저스트 후디의 화염 머플러 그래픽에 그것을 움켜쥔 손을 더한 버전입니다. 라인이 가늘수록 반사 대비가 강해져서, 어두울수록 그림이 또렷해집니다.": {
    en: "A version of the Exhaust Hoodie's flaming muffler graphic with a hand gripping it added in. The thinner the lines, the stronger the reflective contrast — the darker it gets, the sharper the image.",
    ja: "エキゾーストフーディーの炎のマフラーグラフィックに、それを握る手を加えたバージョン。線が細いほど反射のコントラストが強くなり、暗いほど絵がくっきり浮かび上がります。",
  },

  "블랙": { en: "Black", ja: "ブラック" },
  "화이트": { en: "White", ja: "ホワイト" },
  "핑크": { en: "Pink", ja: "ピンク" },
  "딥블루": { en: "Deep Blue", ja: "ディープブルー" },
  "스카이 블루": { en: "Sky Blue", ja: "スカイブルー" },
  "클레이": { en: "Clay", ja: "クレイ" },


  /* 반품 재고 복원 · 재고 변동 이력 (works/index.html) */

  /* 쿠폰 관리(works/index.html) */

  "사이즈": { en: "Size", ja: "サイズ" },
  "총장": { en: "Length", ja: "着丈" },
  "가슴단면": { en: "Chest", ja: "身幅" },
  "어깨": { en: "Shoulder", ja: "肩幅" },
  "소매길이": { en: "Sleeve", ja: "袖丈" },

  "리플렉티브 실버": { en: "Reflective Silver", ja: "リフレクティブシルバー" },
  "빛을 받으면 발광": { en: "Glows when lit", ja: "光を受けると発光" },
  "매트 블랙": { en: "Matte Black", ja: "マットブラック" },
  "무광 메탈": { en: "Matte metal", ja: "マット仕上げのメタル" },
  "에나멜 도장": { en: "Enamel finish", ja: "エナメル塗装" },

  "없음": { en: "None", ja: "なし" },
  "스타": { en: "Star", ja: "スター" },
  "체리": { en: "Cherry", ja: "チェリー" },
  "헬멧": { en: "Helmet", ja: "ヘルメット" },
  "말굽": { en: "Horseshoe", ja: "蹄鉄" },
  "플레임": { en: "Flame", ja: "フレイム" },
  "트라이벌 하트": { en: "Tribal Heart", ja: "トライバルハート" },
  "볼트": { en: "Bolt", ja: "ボルト" },
  "키": { en: "Key", ja: "キー" },

  "01 — Night Ride / 남산": { en: "01 — Night Ride / Namsan", ja: "01 — ナイトライド／南山" },
  "02 — Detail / 지퍼 참": { en: "02 — Detail / Zip Charm", ja: "02 — ディテール／ジップチャーム" },
  "헤드라이트 반사 컷": { en: "Headlight reflection shot", ja: "ヘッドライト反射カット" },
  "클로즈업": { en: "Close-up", ja: "クローズアップ" },
  "주간 / 야간 대비": { en: "Day / night contrast", ja: "昼間／夜間の対比" },
  "라이딩 자세": { en: "Riding posture", ja: "ライディング姿勢" },
  "컬러 랩업": { en: "Color lineup", ja: "カラーラインナップ" },
  "라이딩 필름 캡처": { en: "Riding film capture", ja: "ライディングフィルムキャプチャー" },
  "남녀 스타일링": { en: "His & hers styling", ja: "メンズ＆レディーススタイリング" },
  "정비 컷": { en: "Garage shot", ja: "整備カット" },

  "결제 확인 후 2~5 영업일 이내 출고": { en: "Ships within 2–5 business days after payment is confirmed", ja: "ご入金確認後2〜5営業日以内に発送" },

  /* ---------- Reviews ---------- */
  "상품 리뷰": { en: "Reviews", ja: "商品レビュー" },
  "REITEN을 입어본 분들의 솔직한 후기입니다.": { en: "Honest reviews from people who've worn REITEN.", ja: "REITENを着用した方々の率直なレビューです。" },
  "아직 등록된 리뷰가 없습니다.": { en: "No reviews yet.", ja: "まだレビューがありません。" },
  "리뷰 남기기": { en: "Write a Review", ja: "レビューを書く" },
  "상품": { en: "Product", ja: "商品" },
  "별점": { en: "Rating", ja: "評価" },
  '주문번호 <span class="req">*</span>': { en: 'Order No. <span class="req">*</span>', ja: '注文番号 <span class="req">*</span>' },
  "주문번호를 입력해 주세요.": { en: "Please enter your order number.", ja: "注文番号をご入力ください。" },
  '주문 시 연락처 <span class="req">*</span>': { en: 'Phone Number Used at Checkout <span class="req">*</span>', ja: 'ご注文時の連絡先 <span class="req">*</span>' },
  "연락처를 입력해 주세요.": { en: "Please enter your phone number.", ja: "連絡先をご入力ください。" },
  "실제 구매하신 주문인지 확인하는 용도로만 사용하며 리뷰에는 표시되지 않습니다.": {
    en: "Used only to verify your purchase — this won't be shown with your review.",
    ja: "実際のご購入かどうかの確認にのみ使用され、レビューには表示されません。",
  },
  '닉네임 <span class="req">*</span>': { en: 'Nickname <span class="req">*</span>', ja: 'ニックネーム <span class="req">*</span>' },
  "닉네임을 입력해 주세요.": { en: "Please enter a nickname.", ja: "ニックネームをご入力ください。" },
  '후기 내용 <span class="req">*</span>': { en: 'Review <span class="req">*</span>', ja: 'レビュー内容 <span class="req">*</span>' },
  "후기 내용을 입력해 주세요.": { en: "Please write your review.", ja: "レビュー内容をご入力ください。" },
  "리뷰 등록": { en: "Submit Review", ja: "レビューを投稿" },
  "지금은 정적 사이트로만 열람 중이라 리뷰 등록을 받을 수 없습니다. server/를 함께 실행하면 리뷰를 남길 수 있습니다.": {
    en: "This page is currently served statically, so new reviews can't be submitted. Run the server/ backend alongside it to enable review submission.",
    ja: "現在は静的サイトとして閲覧中のため、レビューの投稿はできません。server/のバックエンドを一緒に起動するとレビューを投稿できます。",
  },
  "리뷰가 등록되었습니다": { en: "Your review has been posted", ja: "レビューが投稿されました" },
  "리뷰 등록에 실패했습니다": { en: "Failed to post the review", ja: "レビューの投稿に失敗しました" },
  "리뷰 보기": { en: "See reviews", ja: "レビューを見る" },
  "착용 사진 (선택)": { en: "Photo (optional)", ja: "着用写真（任意）" },
  "사진 선택": { en: "Choose Photo", ja: "写真を選択" },
  "선택된 파일 없음": { en: "No file chosen", ja: "ファイルが選択されていません" },
  "인스타그램 아이디 (선택)": { en: "Instagram handle (optional)", ja: "Instagram ID（任意）" },
  "@ 없이 아이디만": { en: "Handle only, no @", ja: "@なしのIDのみ" },
  "인스타그램에서 보기": { en: "View on Instagram", ja: "Instagramで見る" },
  "도움돼요": { en: "Helpful", ja: "参考になった" },
  "리뷰가 등록되었습니다. 검수 후 노출됩니다.": { en: "Your review has been submitted. It will appear after review.", ja: "レビューが投稿されました。確認後に公開されます。" },

  /* ---------- 계정 / 로그인 ---------- */
  "지금은 정적 사이트로만 열람 중이라 로그인 기능을 쓸 수 없습니다. server/를 함께 실행하면 회원 로그인을 쓸 수 있습니다.": {
    en: "This page is currently served statically, so member login isn't available. Run the server/ backend alongside it to enable login.",
    ja: "現在は静的サイトとして閲覧中のため、会員ログインはご利用いただけません。server/のバックエンドを一緒に起動するとログインできます。",
  },
  "로그인": { en: "Log In", ja: "ログイン" },
  "회원가입": { en: "Sign Up", ja: "会員登録" },
  "카카오로 로그인": { en: "Continue with Kakao", ja: "カカオでログイン" },
  "또는": { en: "or", ja: "または" },
  "비밀번호": { en: "Password", ja: "パスワード" },
  "비회원으로 주문하셨나요?": { en: "Ordered as a guest?", ja: "会員登録せずにご注文されましたか？" },
  "주문번호로 조회하기": { en: "Look up by order number", ja: "注文番号で照会する" },
  "이름": { en: "Name", ja: "お名前" },
  "로그아웃": { en: "Log Out", ja: "ログアウト" },
  "주문내역": { en: "Order History", ja: "注文履歴" },
  "아직 주문 내역이 없습니다.": { en: "No orders yet.", ja: "まだ注文履歴がありません。" },
  "{name}님, 안녕하세요.": { en: "Hello, {name}", ja: "こんにちは、{name}さん" },
  "이메일 또는 비밀번호가 올바르지 않습니다.": { en: "Incorrect email or password.", ja: "メールアドレスまたはパスワードが正しくありません。" },
  "가입 신청이 완료되었습니다. {email}로 보내드린 인증 메일의 링크를 눌러야 로그인할 수 있어요(스팸함도 확인해 주세요).": {
    en: "Sign-up received. Please click the confirmation link we sent to {email} before logging in (check your spam folder too).",
    ja: "登録を受け付けました。{email}宛にお送りした確認メールのリンクをクリックしてからログインしてください（迷惑メールフォルダもご確認ください）。",
  },
  "이메일 인증이 완료됐습니다! 자동으로 로그인되었습니다.": {
    en: "Email confirmed! You're now logged in.",
    ja: "メール認証が完了しました！自動的にログインされました。",
  },
  "이메일 인증이 완료됐습니다. 로그인해 주세요.": {
    en: "Email confirmed. Please log in.",
    ja: "メール認証が完了しました。ログインしてください。",
  },
  "이미 가입된 이메일입니다.": { en: "This email is already registered.", ja: "すでに登録されているメールアドレスです。" },
  "비밀번호는 6자 이상이어야 합니다.": { en: "Password must be at least 6 characters.", ja: "パスワードは6文字以上で入力してください。" },
  "이메일 형식이 올바르지 않습니다.": { en: "Please enter a valid email address.", ja: "メールアドレスの形式が正しくありません。" },
  "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.": { en: "Too many requests. Please try again shortly.", ja: "リクエストが多すぎます。しばらくしてからもう一度お試しください。" },
  "이메일 인증이 필요합니다. 가입하신 이메일함에서 인증 링크를 확인해 주세요.": {
    en: "Please verify your email — check your inbox for the confirmation link.",
    ja: "メール認証が必要です。登録したメールの認証リンクをご確認ください。",
  },

  /* ---------- 비밀번호 재설정 ---------- */
  "비밀번호를 잊으셨나요?": { en: "Forgot your password?", ja: "パスワードをお忘れですか？" },
  "가입하신 이메일로 비밀번호 재설정 링크를 보내드립니다.": {
    en: "We'll send a password reset link to your registered email.",
    ja: "ご登録のメールアドレスにパスワード再設定リンクをお送りします。",
  },
  "재설정 링크 보내기": { en: "Send reset link", ja: "再設定リンクを送信" },
  "재설정 링크를 이메일로 보내드렸습니다.": { en: "We've emailed you a reset link.", ja: "再設定リンクをメールでお送りしました。" },
  "새 비밀번호를 입력해 주세요.": { en: "Please enter a new password.", ja: "新しいパスワードを入力してください。" },
  "새 비밀번호": { en: "New password", ja: "新しいパスワード" },
  "새 비밀번호 확인": { en: "Confirm new password", ja: "新しいパスワード（確認）" },
  "비밀번호 변경": { en: "Change password", ja: "パスワードを変更" },
  "비밀번호가 일치하지 않습니다.": { en: "Passwords do not match.", ja: "パスワードが一致しません。" },
  "비밀번호가 변경되었습니다. 다시 로그인해 주세요.": {
    en: "Your password has been changed. Please log in again.",
    ja: "パスワードが変更されました。もう一度ログインしてください。",
  },

  /* ---------- 주문 조회 ---------- */
  "회원가입 없이도 주문번호와 연락처만으로 주문 상태를 확인할 수 있습니다.": {
    en: "Check your order status with just your order number and phone number — no account needed.",
    ja: "会員登録なしでも、注文番号と連絡先だけでご注文状況を確認できます。",
  },
  "주문번호를 입력해 주세요.": { en: "Please enter your order number.", ja: "注文番号をご入力ください。" },
  "연락처를 입력해 주세요.": { en: "Please enter your phone number.", ja: "連絡先をご入力ください。" },
  "조회하기": { en: "Look Up", ja: "照会する" },
  "일치하는 주문을 찾을 수 없습니다. 주문번호와 연락처를 다시 확인해 주세요.": {
    en: "No matching order found. Please double-check your order number and phone number.",
    ja: "一致する注文が見つかりません。注文番号と連絡先をもう一度ご確認ください。",
  },
  "배송 조회": { en: "Track shipment", ja: "配送状況を確認" },
  "배송 조회하기": { en: "Track my shipment", ja: "配送状況を確認する" },
  "주문 상태": { en: "Order status", ja: "注文状況" },
  "조회에 실패했습니다. server/가 실행 중인지 확인해 주세요.": { en: "Lookup failed. Please check that server/ is running.", ja: "照会に失敗しました。server/が起動しているかご確認ください。" },

  /* ---------- 상품 Q&A ---------- */
  "궁금한 점을 남겨주시면 판매자가 직접 답변드립니다.": { en: "Leave your question and the seller will answer directly.", ja: "ご質問を残していただければ、販売者が直接回答いたします。" },
  "아직 등록된 문의가 없습니다.": { en: "No questions yet.", ja: "まだお問い合わせがありません。" },
  "문의 남기기": { en: "Ask a Question", ja: "お問い合わせを残す" },
  "문의 내용을 입력해 주세요.": { en: "Please enter your question.", ja: "お問い合わせ内容をご入力ください。" },
  "비밀글로 남기기 (판매자와 작성자만 볼 수 있어요)": { en: "Post as private (visible only to you and the seller)", ja: "非公開で投稿する（販売者と投稿者のみ閲覧可能）" },
  "문의 등록": { en: "Submit Question", ja: "問い合わせを投稿" },
  "지금은 정적 사이트로만 열람 중이라 문의 등록을 받을 수 없습니다. server/를 함께 실행하면 문의를 남길 수 있습니다.": {
    en: "This page is currently served statically, so questions can't be submitted. Run the server/ backend alongside it to enable this.",
    ja: "現在は静的サイトとして閲覧中のため、お問い合わせの投稿はできません。server/のバックエンドを一緒に起動すると投稿できます。",
  },
  "이미 비슷한 질문에 답변드린 적이 있어요": { en: "We've already answered a similar question", ja: "似た質問に回答済みです" },
  "원하는 답을 못 찾으셨다면 그대로 등록해 주세요.": { en: "If this doesn't answer your question, feel free to submit it anyway.", ja: "求める答えが見つからない場合はそのまま登録してください。" },
  "판매자 답변": { en: "Seller's Answer", ja: "販売者からの回答" },
  "답변완료": { en: "Answered", ja: "回答済み" },
  "답변대기": { en: "Awaiting answer", ja: "回答待ち" },
  "비밀글입니다.": { en: "This is a private question.", ja: "非公開の質問です。" },
  "문의가 등록되었습니다": { en: "Your question has been submitted", ja: "お問い合わせを受け付けました" },
  "문의 등록에 실패했습니다": { en: "Failed to submit your question", ja: "お問い合わせの送信に失敗しました" },

  /* ---------- 반품 · 교환 신청 ---------- */
  "주문번호를 확인한 뒤 신청해 주세요. 접수 후 담당자가 순차적으로 연락드립니다.": {
    en: "Please check your order number before applying. We'll contact you in the order requests are received.",
    ja: "注文番号をご確認の上、お申し込みください。受付後、担当者より順次ご連絡いたします。",
  },
  "단순변심": { en: "Change of mind", ja: "単純な気持ちの変化" },
  "사이즈 불만족": { en: "Size doesn't fit", ja: "サイズ不満足" },
  "불량": { en: "Defective", ja: "不良品" },
  "오배송": { en: "Wrong item shipped", ja: "誤配送" },
  "기타": { en: "Other", ja: "その他" },
  "상세 내용": { en: "Details", ja: "詳細内容" },
  "교환하실 사이즈, 불량 부위 등을 적어주세요": { en: "e.g. size to exchange to, location of the defect, etc.", ja: "交換希望サイズ、不良箇所などをご記入ください" },
  "신청하기": { en: "Submit Request", ja: "申請する" },
  "접수되었습니다.": { en: "Your request has been received.", ja: "受付が完了しました。" },
  "담당자가 확인 후 입력하신 연락처로 안내드립니다.": { en: "Our team will review it and reach out to the contact number you provided.", ja: "担当者が確認の上、ご入力いただいた連絡先にご案内いたします。" },
  "접수에 실패했습니다. server/가 실행 중인지 확인해 주세요.": { en: "Submission failed. Please check that server/ is running.", ja: "送信に失敗しました。server/が起動しているかご確認ください。" },

  /* ---------- 공용 에러 ---------- */
  "처리에 실패했습니다": { en: "Failed to process", ja: "処理に失敗しました" },

  /* "취소"가 바로 아래에서 "주문 취소" 상태(Cancelled)로 쓰이는 것과 겹치지 않도록,
     폼 닫기 버튼(상품·룩북·정보 등록 폼의 "취소")은 이 별도 키로 연결한다 — 화면에 보이는
     한글 글자는 그대로 "취소"이고 data-i18n 속성만 이 키를 가리킨다(ko 모드는 딕셔너리를
     안 거치므로 화면엔 영향 없음). */
  "편집 취소": { en: "Cancel", ja: "キャンセル" },

  /* ---------- 주문 · 반품 상태 (고객 주문내역 + 관리자 패널 공용) ---------- */
  "입금대기": { en: "Awaiting Payment", ja: "入金待ち" },
  "입금확인": { en: "Payment Confirmed", ja: "入金確認" },
  "배송중": { en: "Shipping", ja: "配送中" },
  "완료": { en: "Completed", ja: "完了" },
  "취소": { en: "Cancelled", ja: "キャンセル" },
  "접수": { en: "Received", ja: "受付済み" },
  "처리중": { en: "Processing", ja: "処理中" },
  "반려": { en: "Rejected", ja: "却下" },

  /* ---------- 관리자 패널 (한국어 / Deutsch 전용 — 동업자용, 사이트 공용 언어 메뉴에는 노출 안 함) ---------- */
  "관리자 패널": { en: "Admin Panel", ja: "管理者パネル" },
  "택배사 선택": { en: "Select courier", ja: "配送業者を選択" },
  "운송장번호": { en: "Tracking number", ja: "追跡番号" },
  "더 보기": { en: "Load more", ja: "もっと見る" },
  "상태를 저장했습니다": { en: "Status saved", ja: "ステータスを保存しました" },
  "지퍼 참 커스텀 가능": { en: "Zip charm customizable", ja: "ジップチャームカスタム可能" },
  "상품사진 {n}": { en: "Product photo {n}", ja: "商品写真 {n}" },
  "로그인이 만료되었습니다. 다시 로그인해 주세요.": {
    en: "Your session has expired. Please log in again.",
    ja: "ログインの有効期限が切れました。もう一度ログインしてください。",
  },
  "요청이 실패했습니다": { en: "The request failed", ja: "リクエストに失敗しました" },

  /* Works 2026-08-13 추가분 — 사이드바/로그인/주문 상세/정보/대시보드/활동 로그 탭에서
     한국어로 새던 항목들. 전부 관리자 전용(de-only)이라 위 규칙과 동일하게 en/ja는 안 채움. */
  "이메일 저장": { en: "Remember email", ja: "メールアドレスを保存" },

  /* 활동 로그 탭의 작업 이름(AUDIT_ACTION_LABELS, works/index.html) — "상품 수정"·"룩북 칸 수정"은
     위에서 이미 다른 용도로 번역돼 있어 그대로 재사용된다. */

  /* 사진 편집(자르기/회전/확대) 도구 — works/index.html의 photo-editor 모달 */
  "적용": { en: "Apply", ja: "適用" },

  /* ---------- 라이더 사이즈 가이드 ---------- */
  "보호대 착용 시 사이즈 가이드": { en: "Sizing With Body Armor", ja: "プロテクター着用時のサイズガイド" },
  "이너 프로텍터(보호대)를 착용하고 그 위에 덧입으실 계획이라면 가슴·어깨 여유가 줄어듭니다. 평소 사이즈보다 한 치수 큰 사이즈를 권장합니다.": {
    en: "If you plan to layer this over inner body armor, chest and shoulder room will be tighter. We recommend sizing up one size from your usual size.",
    ja: "インナープロテクター（保護具）の上に重ね着する予定の場合、胸・肩まわりの余裕が減ります。普段のサイズより1サイズ大きめを推奨します。",
  },
  "크롭 기장은 프로텍터 착용 시 밑단이 더 짧게 느껴질 수 있습니다. 재킷형 프로텍터를 안에 입으실 경우 한 치수 큰 사이즈를 권장합니다.": {
    en: "The cropped length may feel even shorter when worn with armor. If you're wearing a jacket-style protector underneath, we recommend sizing up one size.",
    ja: "クロップ丈はプロテクター着用時に裾がさらに短く感じられることがあります。ジャケット型プロテクターをインナーに着用する場合は1サイズ大きめを推奨します。",
  },
  "평소 사이즈": { en: "Usual size", ja: "普段のサイズ" },
  "보호대 착용 시 권장": { en: "Recommended with armor", ja: "プロテクター着用時の推奨" },
  "가슴단면 여유분(cm)": { en: "Chest room (cm)", ja: "胸まわりの余裕(cm)" },
  "추후 계측": { en: "Measuring soon", ja: "計測予定" },
  "가슴단면 여유분은 실제 프로텍터를 착용시켜 계측한 뒤 업데이트될 예정입니다.": {
    en: "Chest-room figures will be updated once we measure with real body armor on.",
    ja: "胸まわりの余裕分は、実際にプロテクターを着用させて計測した後に更新される予定です。",
  },

  /* ---------- 회원 계정 관리 (Works 전용) ---------- */

  /* ---------- 사이드바 카테고리·오늘(홈)·결제 트랜잭션·공지·아웃박스 (Works 전용, 2026-09) ---------- */

  /* ---------- 상품 검색 · 위시리스트 ---------- */
  "상품 검색": { en: "Search products", ja: "商品検索" },
  "상품명으로 검색": { en: "Search by product name", ja: "商品名で検索" },
  "검색 결과가 없습니다.": { en: "No results found.", ja: "検索結果がありません。" },
  "위시리스트": { en: "Wishlist", ja: "ウィッシュリスト" },
  "위시리스트에 담기": { en: "Add to wishlist", ja: "ウィッシュリストに追加" },
  "위시리스트에 담았습니다": { en: "Added to your wishlist", ja: "ウィッシュリストに追加しました" },
  "위시리스트에서 뺐습니다": { en: "Removed from your wishlist", ja: "ウィッシュリストから削除しました" },
  "담아둔 상품은 이 기기의 브라우저에만 저장됩니다.": {
    en: "Saved items are stored only in this browser on this device.",
    ja: "保存した商品はこの端末のブラウザにのみ保存されます。",
  },
  "아직 담은 상품이 없습니다.": { en: "Your wishlist is empty.", ja: "まだ保存した商品がありません。" },
  "상품 보러 가기": { en: "Browse products", ja: "商品を見る" },
  "상품을 찾을 수 없습니다": { en: "Product not found", ja: "商品が見つかりません" },
  "판매가 종료되었거나 없는 상품입니다": { en: "This product is no longer available", ja: "販売終了または存在しない商品です" },
  "지금 판매 중인 상품을 확인해 주세요.": { en: "Please browse our current products.", ja: "現在販売中の商品をご覧ください。" },

  /* ---------- 주문취소 신청 ---------- */
  "주문취소 신청": { en: "Request order cancellation", ja: "注文キャンセル申請" },
  "취소 사유": { en: "Cancellation reason", ja: "キャンセル理由" },
  "사유 직접 입력": { en: "Enter reason", ja: "理由を入力" },
  "사유를 입력해 주세요.": { en: "Please enter a reason.", ja: "理由を入力してください。" },
  "취소 신청하기": { en: "Submit cancellation request", ja: "キャンセルを申請する" },
  "취소 신청이 접수되었습니다.": { en: "Your cancellation request has been received.", ja: "キャンセル申請を受け付けました。" },
  "배송 지연": { en: "Delayed shipping", ja: "配送遅延" },
  "주문 실수(옵션·수량 등)": { en: "Ordered by mistake (option/quantity, etc.)", ja: "注文ミス(オプション・数量など)" },
  "다른 상품 구매 예정": { en: "Planning to buy a different item", ja: "他の商品を購入予定" },

  /* ---------- 적립금(포인트) ---------- */
  "전액사용": { en: "Use all", ja: "全額使用" },
  "보유 적립금 {balance}": { en: "Points balance: {balance}", ja: "保有ポイント {balance}" },

  /* ---------- 가상계좌 ---------- */
  "가상계좌": { en: "Virtual account", ja: "仮想口座" },
  "계좌 발급받기": { en: "Issue account", ja: "口座を発行する" },
  "신청하면 이 주문 전용 계좌가 발급됩니다. 그 계좌로 입금하면 확인 절차 없이 자동으로 결제완료 처리됩니다.": {
    en: "A dedicated account for this order will be issued. Once you deposit into it, payment is confirmed automatically — no manual check needed.",
    ja: "この注文専用の口座が発行されます。その口座に入金すると、確認手続きなしで自動的に決済完了となります。",
  },
  "계좌 발급이 취소되었습니다": { en: "Account issuance was cancelled", ja: "口座発行がキャンセルされました" },
  "계좌 발급 중 오류가 발생했습니다": { en: "An error occurred while issuing the account", ja: "口座発行中にエラーが発生しました" },
  "가상계좌 발급 완료": { en: "Virtual account issued", ja: "仮想口座発行完了" },
  "입금기한": { en: "Deposit due", ja: "入金期限" },
  "이 계좌로 입금하시면 확인 절차 없이 자동으로 결제완료 처리됩니다.": {
    en: "Once you deposit into this account, payment is confirmed automatically — no manual check needed.",
    ja: "この口座に入金すると、確認手続きなしで自動的に決済完了となります。",
  },

  /* ---------- Works: 관리자 주문 상세 — 결제수단/쿠폰/적립금/가상계좌 ---------- */

  /* ---------- Works: 담당자 지정 · 내부 메모 · 인수인계 · 캘린더 ---------- */

  /* ---------- Works: 캘린더 ---------- */

  /* ---------- Works: 인수인계 노트 ---------- */

  /* ---------- Works: 사용 통계 ---------- */
};

/* 2026-09-26 번역 누락 보충 — 기존 항목(en/ja만 있던 키 등)을 덮어쓰지 않도록 병합한다. */
[    ["적립금 사용", {"en": "Use points", "ja": "ポイント利用"}],
  ["취소 사유를 입력해 주세요", {"en": "Please enter a cancellation reason", "ja": "キャンセル理由を入力してください"}],
  ["접수에 실패했습니다.", {"en": "Submission failed.", "ja": "送信に失敗しました。"}],
  ["사유를 입력해 주세요", {"en": "Please enter a reason", "ja": "理由を入力してください"}]
].forEach(([k, v]) => { I18N[k] = Object.assign({}, I18N[k], v); });

/* 2026-10-02(2차) 등급 배지·기간 일정 번역 */
[
  ["스튜디오 준비 중입니다", {"en":"Studio coming soon","ja":"スタジオ準備中です"}],
  ["지퍼 참을 달 수 있는 집업이 곧 다시 입고됩니다.", {"en":"Zip-ups that take charms will be back in stock soon.","ja":"チャームを付けられるジップアップがまもなく再入荷します。"}],  ].forEach(([k, v]) => { I18N[k] = Object.assign({}, I18N[k], v); });

/* 2026-10-02 회원 탈퇴·보기 전용 번역 */
[    ["회원 탈퇴", {"en": "Delete account", "ja": "退会"}],
  ["탈퇴하면 계정과 적립금이 즉시 삭제되며 되돌릴 수 없습니다. 주문 내역은 전자상거래법에 따라 정해진 기간 동안 보관되며, 비회원 주문 조회(주문번호+연락처)로 계속 확인할 수 있습니다. 진행 중인 주문이 있으면 탈퇴할 수 없습니다.", {"en": "Deleting your account removes it and your points immediately and cannot be undone. Order records are kept for the period required by Korean e-commerce law and remain viewable via guest order lookup (order number + phone). You cannot delete your account while an order is in progress.", "ja": "退会するとアカウントとポイントは即時削除され、元に戻せません。注文履歴は電子商取引法に基づき所定の期間保管され、非会員注文照会（注文番号＋連絡先）で引き続き確認できます。進行中の注文がある場合は退会できません。"}],
  ["확인을 위해 '탈퇴'를 입력해 주세요", {"en": "Type '탈퇴' to confirm", "ja": "確認のため「탈퇴」と入力してください"}],
  ["회원 탈퇴하기", {"en": "Delete my account", "ja": "退会する"}],
  ["확인 문구로 '탈퇴'를 정확히 입력해 주세요.", {"en": "Please type '탈퇴' exactly to confirm.", "ja": "確認のため「탈퇴」と正確に入力してください。"}],
  ["정말 탈퇴할까요? 계정과 적립금이 삭제되며 되돌릴 수 없습니다.", {"en": "Delete your account? Your account and points will be removed and this cannot be undone.", "ja": "本当に退会しますか？アカウントとポイントは削除され、元に戻せません。"}],
  ["탈퇴가 완료되었습니다. 그동안 이용해 주셔서 감사합니다.", {"en": "Your account has been deleted. Thank you for riding with us.", "ja": "退会が完了しました。ご利用ありがとうございました。"}]
].forEach(([k, v]) => { I18N[k] = Object.assign({}, I18N[k], v); });

/* 2026-09-26(4차) 컬러별 사진·상세 콘텐츠 번역 */
[    ["모델", {"en": "Model", "ja": "モデル"}],
  ["상세 정보", {"en": "Details", "ja": "詳細情報"}]
].forEach(([k, v]) => { I18N[k] = Object.assign({}, I18N[k], v); });


/* ---------- 2026-10-02: 부분 환불·구매확정·사이즈 추천·문의 이메일·운영 자동화 + 서버 오류 문구 ---------- */
[
  ["환불된 금액", {"en": "Refunded amount", "ja": "返金済み金額"}],
  ["가상계좌 입금 안내", {"en": "Virtual account deposit details", "ja": "バーチャル口座の入金案内"}],
  ["구매확정 완료", {"en": "Purchase confirmed", "ja": "購入確定済み"}],
  ["구매확정하면 적립금 {amount}이 바로 지급됩니다.", {"en": "Confirm your purchase to receive {amount} in points right away.", "ja": "購入を確定すると、ポイント{amount}がすぐに付与されます。"}],
  ["상품을 잘 받으셨다면 구매확정을 눌러 주세요.", {"en": "If your order arrived safely, please confirm your purchase.", "ja": "商品を無事に受け取られたら、購入確定を押してください。"}],
  ["누르지 않아도 {date}에 자동으로 구매확정됩니다.", {"en": "It will be confirmed automatically on {date} if you don't.", "ja": "押さなくても{date}に自動で購入確定されます。"}],
  ["구매확정", {"en": "Confirm purchase", "ja": "購入確定"}],
  ["구매를 확정할까요? 확정하면 적립금이 지급되고, 이후 반품·교환은 고객센터로 문의해 주셔야 합니다.", {"en": "Confirm this purchase? Points will be paid out, and any later return or exchange must go through customer support.", "ja": "購入を確定しますか？確定するとポイントが付与され、以降の返品・交換はカスタマーサポートへのお問い合わせが必要です。"}],
  ["구매확정에 실패했습니다.", {"en": "Couldn't confirm the purchase.", "ja": "購入確定に失敗しました。"}],
  ["구매확정했습니다. 적립금 {amount}이 지급됐어요.", {"en": "Purchase confirmed. {amount} in points has been added.", "ja": "購入を確定しました。ポイント{amount}が付与されました。"}],
  ["구매확정했습니다.", {"en": "Purchase confirmed.", "ja": "購入を確定しました。"}],
  ["참만으로는 주문할 수 없어요", {"en": "Charms can't be ordered on their own", "ja": "チャームだけではご注文いただけません"}],
  ["참은 후디·집업 등 상품과 함께 주문할 때만 구매할 수 있습니다.", {"en": "Charms can only be purchased together with a hoodie, zip-up or other item.", "ja": "チャームはフーディー・ジップアップなどの商品と一緒の場合のみご購入いただけます。"}],
  ["주문을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.", {"en": "We couldn't place your order. Please try again shortly.", "ja": "ご注文を受け付けられませんでした。しばらくしてからもう一度お試しください。"}],
  ["연결이 불안정해 주문 결과를 확인하지 못했습니다. 주문 조회 또는 메일함에서 접수 여부를 확인한 뒤 다시 시도해 주세요.", {"en": "Your connection dropped before we could confirm the order. Please check Order Lookup or your inbox before trying again.", "ja": "通信が不安定なため注文結果を確認できませんでした。注文照会またはメールで受付状況を確認してから、もう一度お試しください。"}],
  ["장바구니로 돌아가기", {"en": "Back to cart", "ja": "カートに戻る"}],
  ["결제를 확인하고 있어요…", {"en": "Confirming your payment…", "ja": "お支払いを確認しています…"}],
  ["결제가 이미 끝났다면 주문 조회에서 접수 여부를 확인해 주세요.", {"en": "If your payment already went through, please check Order Lookup.", "ja": "お支払いが完了している場合は、注文照会で受付状況をご確認ください。"}],
  ["조회에 실패했습니다. 잠시 후 다시 시도해 주세요.", {"en": "Lookup failed. Please try again shortly.", "ja": "照会に失敗しました。しばらくしてからもう一度お試しください。"}],
  ["보호대 위에 입는 걸 감안해 한 치수 크게 골랐어요.", {"en": "We went one size up so it fits over body armor.", "ja": "プロテクターの上に着ることを考え、ワンサイズ大きくしました。"}],
  ["넉넉한 핏을 원하셔서 한 치수 크게 봤어요.", {"en": "One size up for the roomier fit you asked for.", "ja": "ゆったりめのご希望に合わせ、ワンサイズ大きくしました。"}],
  ["딱 맞는 핏을 원하셔서 한 치수 작게 봤어요.", {"en": "One size down for the closer fit you asked for.", "ja": "ぴったりめのご希望に合わせ、ワンサイズ小さくしました。"}],
  ["이 상품에 있는 사이즈 중 가장 가까운 사이즈예요.", {"en": "This is the closest size this item comes in.", "ja": "この商品にあるサイズの中で最も近いサイズです。"}],
  ["내 사이즈 추천받기 (라이더용)", {"en": "Find my size (for riders)", "ja": "私のサイズを調べる（ライダー向け）"}],
  ["키 (cm)", {"en": "Height (cm)", "ja": "身長（cm）"}],
  ["몸무게 (kg)", {"en": "Weight (kg)", "ja": "体重（kg）"}],
  ["원하는 핏", {"en": "Preferred fit", "ja": "好みのフィット"}],
  ["딱 맞게", {"en": "Closer fit", "ja": "ぴったりめ"}],
  ["보통(디자인 그대로의 오버핏)", {"en": "Regular (the designed oversized fit)", "ja": "標準（デザイン通りのオーバーサイズ）"}],
  ["더 넉넉하게", {"en": "Roomier", "ja": "よりゆったり"}],
  ["이너 프로텍터(보호대) 위에 입을 거예요", {"en": "I'll wear it over inner body armor", "ja": "インナープロテクターの上に着ます"}],
  ["추천 사이즈 보기", {"en": "Show my size", "ja": "おすすめサイズを見る"}],
  ["추천 사이즈", {"en": "Recommended size", "ja": "おすすめサイズ"}],
  ["평소 사이즈 {size}", {"en": "usual size {size}", "ja": "普段のサイズ {size}"}],
  ["지금 고른 컬러는 이 사이즈가 품절이에요.", {"en": "This size is sold out in the color you picked.", "ja": "選択中のカラーではこのサイズは売り切れです。"}],
  ["{size} 선택하기", {"en": "Select {size}", "ja": "{size}を選ぶ"}],
  ["키·몸무게로 어림잡은 참고치예요. 아래 사이즈 실측표의 가슴단면도 함께 확인해 주세요.", {"en": "This is an estimate from height and weight. Please also check the chest width in the size chart below.", "ja": "身長・体重からの目安です。下のサイズ表の身幅もあわせてご確認ください。"}],
  ["답변 받을 이메일 <span class=\"req\">*</span>", {"en": "Email for our reply <span class=\"req\">*</span>", "ja": "回答を受け取るメール <span class=\"req\">*</span>"}],
  ["비회원으로 남긴 비밀글은 작성자도 사이트에서 다시 열어볼 수 없어요. 답변을 이메일로 보내드릴게요. (이메일은 답변 안내에만 쓰고 공개되지 않습니다)", {"en": "Private questions from guests can't be reopened on the site, even by you, so we'll email our reply. (Your email is only used for the reply and is never shown publicly.)", "ja": "非会員の非公開のお問い合わせは、ご本人もサイトで再表示できません。回答はメールでお送りします。（メールアドレスは回答のご案内にのみ使用し、公開されません）"}],
  ["답변 받을 이메일을 정확히 입력해 주세요.", {"en": "Please enter a valid email for our reply.", "ja": "回答を受け取るメールアドレスを正しく入力してください。"}],
  ["여러 상품 중 일부만 반품·교환하실 때는 상품명과 수량을 적어 주세요. 단순 변심 반품은 왕복 배송비가 환불 금액에서 차감되고, 상품 하자·오배송은 배송비를 판매자가 부담합니다.", {"en": "If you're returning or exchanging only some items, list the item names and quantities. For change-of-mind returns, round-trip shipping is deducted from the refund; for defects or wrong items, we cover shipping.", "ja": "一部の商品のみ返品・交換される場合は、商品名と数量をご記入ください。お客様都合の返品は往復送料が返金額から差し引かれ、不良・誤配送の場合は送料を当店が負担します。"}],
  ["회원으로 주문하신 상품에 사진 리뷰를 남기면, 승인 후 적립금 {amount}을 드려요.", {"en": "Leave a photo review on an item you ordered as a member and get {amount} in points once it's approved.", "ja": "会員としてご注文の商品に写真付きレビューを書くと、承認後にポイント{amount}を差し上げます。"}],
  ["장바구니 항목이 없습니다.", {"en": "Your cart is empty.", "ja": "カートが空です。"}],
  ["존재하지 않는 상품·참(charm) 또는 잘못된 수량이 포함되어 있습니다.", {"en": "Your cart has an item, charm or quantity that isn't available.", "ja": "存在しない商品・チャーム、または誤った数量が含まれています。"}],
  ["쿠폰 사용 횟수가 모두 소진되었습니다.", {"en": "This coupon has reached its usage limit.", "ja": "このクーポンは使用回数の上限に達しました。"}],
  ["포인트 잔액이 부족합니다.", {"en": "You don't have enough points.", "ja": "ポイント残高が不足しています。"}],
  ["재고 확인 중 오류가 발생했습니다.", {"en": "Something went wrong while checking stock.", "ja": "在庫確認中にエラーが発生しました。"}],
  ["주문 저장에 실패했습니다.", {"en": "Couldn't save your order.", "ja": "注文の保存に失敗しました。"}],
  ["결제 정보를 찾을 수 없습니다. 처음부터 다시 시도해 주세요.", {"en": "We couldn't find this payment. Please start again.", "ja": "お支払い情報が見つかりません。最初からやり直してください。"}],
  ["결제 확인 중 오류가 발생했습니다.", {"en": "Something went wrong while confirming your payment.", "ja": "お支払いの確認中にエラーが発生しました。"}],
  ["결제가 확인되지 않았습니다.", {"en": "Your payment couldn't be verified.", "ja": "お支払いを確認できませんでした。"}],
  ["카드결제가 아직 준비되지 않았습니다.", {"en": "Card payment isn't available yet.", "ja": "カード決済はまだご利用いただけません。"}],
  ["결제 준비에 실패했습니다.", {"en": "Couldn't start the payment.", "ja": "決済の準備に失敗しました。"}],
  ["주문 처리 중입니다. 잠시 후 주문 조회에서 확인해 주세요.", {"en": "Your order is still processing. Please check Order Lookup in a moment.", "ja": "ご注文を処理中です。しばらくしてから注文照会でご確認ください。"}],
  ["주문번호와 연락처를 입력해 주세요.", {"en": "Please enter your order number and phone number.", "ja": "注文番号と連絡先を入力してください。"}],
  ["조회 중 오류가 발생했습니다.", {"en": "Something went wrong during the lookup.", "ja": "照会中にエラーが発生しました。"}],
  ["주문번호·이름·연락처·사유를 모두 입력해 주세요.", {"en": "Please fill in the order number, name, phone and reason.", "ja": "注文番号・お名前・連絡先・理由をすべて入力してください。"}],
  ["'기타'를 선택했다면 사유를 직접 입력해 주세요.", {"en": "If you chose 'Other', please describe the reason.", "ja": "「その他」を選んだ場合は理由をご記入ください。"}],
  ["주문 확인 중 오류가 발생했습니다.", {"en": "Something went wrong while checking the order.", "ja": "注文の確認中にエラーが発生しました。"}],
  ["주문번호가 필요합니다.", {"en": "An order number is required.", "ja": "注文番号が必要です。"}],
  ["지금은 구매확정을 할 수 없습니다. 잠시 후 다시 시도해 주세요.", {"en": "Purchase confirmation isn't available right now. Please try again later.", "ja": "現在、購入確定はできません。しばらくしてからお試しください。"}],
  ["이미 구매확정된 주문입니다.", {"en": "This order is already confirmed.", "ja": "すでに購入確定済みのご注文です。"}],
  ["배송이 시작된 주문만 구매확정할 수 있습니다.", {"en": "Only shipped orders can be confirmed.", "ja": "発送済みのご注文のみ購入確定できます。"}],
  ["존재하지 않는 상품 또는 잘못된 수량이 포함되어 있습니다.", {"en": "Your cart has an item or quantity that isn't available.", "ja": "存在しない商品または誤った数量が含まれています。"}],
  ["서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.", {"en": "A server error occurred. Please try again shortly.", "ja": "サーバーエラーが発生しました。しばらくしてからお試しください。"}],
  ["요청 형식이 올바르지 않습니다.", {"en": "The request wasn't valid.", "ja": "リクエストの形式が正しくありません。"}],
  ["이용이 제한된 계정입니다. 문의가 필요하시면 고객센터로 연락해 주세요.", {"en": "This account has been restricted. Please contact customer support if you have questions.", "ja": "このアカウントは利用が制限されています。お問い合わせはカスタマーサポートまでご連絡ください。"}],
  ["로그인이 필요합니다.", {"en": "Please log in.", "ja": "ログインが必要です。"}],
  ["유효하지 않은 쿠폰 코드입니다.", {"en": "That coupon code isn't valid.", "ja": "無効なクーポンコードです。"}],
  ["아직 사용할 수 없는 쿠폰입니다.", {"en": "This coupon can't be used yet.", "ja": "このクーポンはまだご利用いただけません。"}],
  ["기간이 만료된 쿠폰입니다.", {"en": "This coupon has expired.", "ja": "有効期限が切れたクーポンです。"}],
  ["이 쿠폰은 {amount}원 이상 주문부터 사용할 수 있습니다.", {"en": "This coupon requires an order of at least ₩{amount}.", "ja": "このクーポンは{amount}ウォン以上のご注文からご利用いただけます。"}],
  ["이 쿠폰은 장바구니에 담긴 상품에 적용할 수 없습니다.", {"en": "This coupon doesn't apply to the items in your cart.", "ja": "このクーポンはカートの商品には適用できません。"}],
  ["존재하지 않는 상품입니다.", {"en": "That product doesn't exist.", "ja": "存在しない商品です。"}],
  ["이름과 문의 내용을 입력해 주세요.", {"en": "Please enter your name and your question.", "ja": "お名前とお問い合わせ内容を入力してください。"}],
  ["비회원 비밀글은 답변 받을 이메일을 입력해 주세요.", {"en": "Guests posting a private question need to leave an email for our reply.", "ja": "非会員の非公開のお問い合わせには、回答を受け取るメールアドレスをご入力ください。"}],
  ["문의 등록에 실패했습니다.", {"en": "Couldn't post your question.", "ja": "お問い合わせの登録に失敗しました。"}],
  ["사진 업로드에 실패했습니다(15MB 이하 이미지만 가능).", {"en": "Photo upload failed (images up to 15MB only).", "ja": "写真のアップロードに失敗しました（15MB以下の画像のみ）。"}],
  ["리뷰를 작성하려면 구매하신 주문번호와 연락처를 입력해 주세요.", {"en": "To write a review, enter the order number and phone number from your purchase.", "ja": "レビューを書くには、ご購入時の注文番号と連絡先を入力してください。"}],
  ["결제가 완료된 주문만 리뷰를 작성할 수 있습니다.", {"en": "Reviews can only be written for paid orders.", "ja": "お支払い済みのご注文のみレビューを書けます。"}],
  ["이 주문 내역에서 해당 상품을 찾을 수 없습니다.", {"en": "That item isn't in this order.", "ja": "このご注文に該当商品が見つかりません。"}],
  ["별점은 1~5 사이여야 합니다.", {"en": "Ratings must be between 1 and 5.", "ja": "評価は1〜5の間で選んでください。"}],
  ["이름과 리뷰 내용을 입력해 주세요.", {"en": "Please enter your name and review.", "ja": "お名前とレビュー内容を入力してください。"}],
  ["인스타그램 아이디 형식을 확인해 주세요.", {"en": "Please check your Instagram username.", "ja": "Instagramのユーザー名をご確認ください。"}],
  ["사진 업로드에 실패했습니다.", {"en": "Photo upload failed.", "ja": "写真のアップロードに失敗しました。"}],
  ["이미 이 주문으로 작성한 리뷰가 있습니다.", {"en": "You've already reviewed this item for this order.", "ja": "このご注文ではすでにレビューを書かれています。"}],
  ["리뷰 저장에 실패했습니다.", {"en": "Couldn't save your review.", "ja": "レビューの保存に失敗しました。"}],
  ["상품·컬러·사이즈 정보가 필요합니다.", {"en": "Product, color and size are required.", "ja": "商品・カラー・サイズの情報が必要です。"}],
  ["올바른 이메일 주소를 입력해 주세요.", {"en": "Please enter a valid email address.", "ja": "正しいメールアドレスを入力してください。"}],
  ["처리 중 오류가 발생했습니다.", {"en": "Something went wrong.", "ja": "処理中にエラーが発生しました。"}],
  ["존재하지 않는 상품·컬러·사이즈 조합입니다.", {"en": "That product, color and size combination doesn't exist.", "ja": "存在しない商品・カラー・サイズの組み合わせです。"}],
  ["지금은 품절 알림 신청을 받을 수 없습니다. 나중에 다시 시도해 주세요.", {"en": "Restock alerts aren't available right now. Please try again later.", "ja": "現在、再入荷通知の受付ができません。後ほどお試しください。"}],
  ["신청 저장에 실패했습니다.", {"en": "Couldn't save your request.", "ja": "申請の保存に失敗しました。"}],
  ["확인 문구가 올바르지 않습니다.", {"en": "The confirmation text doesn't match.", "ja": "確認用の文言が正しくありません。"}],
  ["진행 중인 주문(입금대기·입금확인·배송중)이 있어 지금은 탈퇴할 수 없습니다. 배송이 끝난 뒤 다시 시도하거나 고객센터로 문의해 주세요.", {"en": "You have an order in progress, so the account can't be deleted yet. Please try again after delivery or contact customer support.", "ja": "進行中のご注文があるため、現在は退会できません。配送完了後にお試しいただくか、カスタマーサポートへお問い合わせください。"}],
  ["탈퇴 처리에 실패했습니다. 잠시 후 다시 시도하거나 고객센터로 문의해 주세요.", {"en": "Couldn't delete the account. Please try again later or contact customer support.", "ja": "退会処理に失敗しました。しばらくしてからお試しいただくか、カスタマーサポートへお問い合わせください。"}],
].forEach(([k, v]) => { I18N[k] = Object.assign({}, I18N[k], v); });

/* ---------- 2026-10-02: 서버 오류 문구 — 고객 화면(영어·일본어)과 Works(독일어)에 나오던 한국어 오류 ---------- */
[
  ["관리자 계정은 탈퇴할 수 없습니다. 마스터 관리자에게 권한 해제를 먼저 요청해 주세요.", {"en": "Admin accounts can't be deleted. Please ask the master admin to remove your admin role first.", "ja": "管理者アカウントは退会できません。先にマスター管理者に権限の解除を依頼してください。"}],
  ["문의 목록을 불러오지 못했습니다.", {"en": "Couldn't load inquiries.", "ja": "お問い合わせ一覧を読み込めませんでした。"}],
  ["리뷰를 불러오지 못했습니다.", {"en": "Couldn't load reviews.", "ja": "レビューを読み込めませんでした。"}],
  ["처리에 실패했습니다.", {"en": "Something went wrong. Please try again.", "ja": "処理に失敗しました。"}],
  ["주문내역을 불러오지 못했습니다.", {"en": "Couldn't load your orders.", "ja": "注文履歴を読み込めませんでした。"}],
  ["customer 정보가 없습니다.", {"en": "Customer information is missing.", "ja": "お客様情報がありません。"}],
  ["필수 항목이 비었습니다: {fields}", {"en": "Required fields are empty: {fields}", "ja": "必須項目が未入力です: {fields}"}],
  ["존재하지 않는 API입니다.", {"en": "Unknown API.", "ja": "存在しないAPIです。"}],
  ["요청이 너무 큽니다.", {"en": "The request is too large.", "ja": "リクエストが大きすぎます。"}],
  ["저장에 실패했습니다.", {"en": "Couldn't save.", "ja": "保存に失敗しました。"}],
  ["존재하지 않는 주문입니다.", {"en": "This order doesn't exist.", "ja": "存在しない注文です。"}],
].forEach(([k, v]) => { I18N[k] = Object.assign({}, I18N[k], v); });

/* ---------- 2026-10-28 정기 감사: 오류 페이지(404·500)·택배사 이름·스튜디오/상품 컬러 없음·사이즈 추천 ---------- */
[
  ["페이지를 찾을 수 없습니다", {"en": "Page not found", "ja": "ページが見つかりません"}],
  ["길을 잃었어요", {"en": "You seem to be lost", "ja": "道に迷ったようです"}],
  ["찾으시는 페이지가 없거나 주소가 바뀌었습니다. 아래 버튼으로 돌아가 주세요.", {"en": "The page you're looking for doesn't exist or has moved. Please use the buttons below to go back.", "ja": "お探しのページは存在しないか、アドレスが変更されました。下のボタンからお戻りください。"}],
  ["일시적인 오류", {"en": "Temporary error", "ja": "一時的なエラー"}],
  ["잠시 문제가 생겼어요", {"en": "Something went wrong", "ja": "問題が発生しました"}],
  ["서버에 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요. 계속되면 고객센터로 문의 부탁드립니다.", {"en": "A temporary server error occurred. Please try again in a moment. If it continues, please contact customer service.", "ja": "サーバーで一時的なエラーが発生しました。しばらくしてから再度お試しください。解決しない場合はカスタマーセンターまでお問い合わせください。"}],
  ["홈으로 가기", {"en": "Go to home", "ja": "ホームへ"}],
  ["다시 시도", {"en": "Try again", "ja": "再試行"}],
  ["CJ대한통운", {"en": "CJ Logistics", "ja": "CJ大韓通運"}],
  ["한진택배", {"en": "Hanjin Express", "ja": "韓進宅配"}],
  ["롯데택배", {"en": "Lotte Global Logistics", "ja": "ロッテ宅配"}],
  ["로젠택배", {"en": "Logen", "ja": "ロジェン宅配"}],
  ["우체국택배", {"en": "Korea Post", "ja": "韓国郵便（郵便局宅配）"}],
  ["구매할 수 있는 컬러가 없습니다", {"en": "No colors available", "ja": "購入できるカラーがありません"}],
  ["이 상품은 사이즈 추천을 지원하지 않아요. 아래 사이즈 실측표를 확인해 주세요.", {"en": "Size recommendations aren't available for this item. Please check the size chart below.", "ja": "この商品はサイズ推薦に対応していません。下のサイズ実寸表をご確認ください。"}]
].forEach(([k, v]) => { I18N[k] = Object.assign({}, I18N[k], v); });

/* ---------- 2026-10-28 정기 감사: 새 오류·안내 문구 ---------- */
[
  ["결제 금액이 0원인 주문은 접수할 수 없습니다. 적립금 사용액을 줄이거나 관리자에게 문의해 주세요.", {"en": "Orders with a total of 0 won can't be placed. Please use fewer points or contact us.", "ja": "お支払い金額が0ウォンのご注文は受け付けできません。ポイントの使用額を減らすか、お問い合わせください。"}],
  ["리뷰를 찾을 수 없습니다.", {"en": "Review not found.", "ja": "レビューが見つかりません。"}],
].forEach(([k, v]) => { I18N[k] = Object.assign({}, I18N[k], v); });

/* ---------- 2026-10-28 정기 감사(2): 활동 로그 동작 이름·새 안내 문구 ---------- */
[
  // "PIN 설정"은 PIN 설정 창 제목(PIN festlegen)과 겹쳤다 — 활동 로그는 "PIN 설정함" 키를 쓴다(2026-10-28 정기 감사)
  // "PIN 변경"은 상단 버튼 이름(PIN ändern)과 겹쳐 버튼이 "PIN geändert"로 보였다 — 활동 로그는 "PIN 변경함" 키를 쓴다(2026-10-28 정기 감사)
  ["이 이메일로 신청한 재입고 알림이 너무 많습니다. 알림을 받은 뒤 다시 신청해 주세요.", {"en": "Too many restock alerts are registered for this email. Please sign up again after you receive one.", "ja": "このメールアドレスで登録された再入荷通知が多すぎます。通知を受け取った後に再度お申し込みください。"}],
].forEach(([k, v]) => { I18N[k] = Object.assign({}, I18N[k], v); });
/* ---------- 2026-10-28 정기 감사(4): 0원 주문·사이즈 오류·취소 되돌리기 ---------- */
[
  ["{name} {size} 사이즈는 지금 판매하지 않습니다. 장바구니에서 빼고 다시 담아 주세요.", {"en": "{name} in size {size} is no longer sold. Please remove it from your cart and add it again.", "ja": "{name}の{size}サイズは現在販売していません。カートから削除して、もう一度追加してください。"}],
  ["주문 확정", {"en": "Order confirmed", "ja": "ご注文確定"}],
  ["쿠폰·적립금으로 결제할 금액 없이 주문이 확정되었습니다.", {"en": "Your order is confirmed — coupons and points covered the full amount.", "ja": "クーポン・ポイントでお支払い金額なしでご注文が確定しました。"}],
  ["결제할 금액이 없는 주문입니다. 다시 시도해 주세요.", {"en": "There's nothing to pay for this order. Please try again.", "ja": "お支払い金額のないご注文です。もう一度お試しください。"}],
].forEach(([k, v]) => { I18N[k] = Object.assign({}, I18N[k], v); });
/* ---------- 2026-10-28 정기 감사(5): API 실행 테스트로 찾은 검증 문구 ---------- */
[
  ["이미 취소된 주문입니다.", {"en": "This order has already been cancelled.", "ja": "すでにキャンセルされたご注文です。"}],
  ["이미 출고된 주문은 취소 대신 반품으로 신청해 주세요.", {"en": "This order has already shipped. Please request a return instead.", "ja": "すでに出荷済みのご注文です。キャンセルではなく返品をお申し込みください。"}],
  ["출고 전 주문은 반품·교환 대신 주문취소로 신청해 주세요.", {"en": "This order hasn't shipped yet. Please request a cancellation instead.", "ja": "出荷前のご注文です。返品・交換ではなくキャンセルをお申し込みください。"}],
  ["이미 접수된 신청이 처리 중입니다. 처리 결과를 기다려 주세요.", {"en": "A request for this order is already being processed. Please wait for the result.", "ja": "すでに受け付けたお申し込みを処理中です。結果をお待ちください。"}],
  ["반품·교환 신청이 처리 중이라 지금은 구매확정할 수 없습니다.", {"en": "A return or exchange is in progress, so the purchase can't be confirmed right now.", "ja": "返品・交換を処理中のため、現在は購入確定できません。"}],
  ["주문자 정보 형식이 올바르지 않습니다.", {"en": "The customer information is invalid.", "ja": "ご注文者情報の形式が正しくありません。"}],
  ["연락처를 숫자로 정확히 입력해 주세요.", {"en": "Please enter a valid phone number.", "ja": "電話番号を正しく入力してください。"}],
  ["이메일 주소를 정확히 입력해 주세요.", {"en": "Please enter a valid email address.", "ja": "メールアドレスを正しく入力してください。"}],
  ["한 상품은 한 번에 99개까지 주문할 수 있습니다.", {"en": "You can order up to 99 of one item at a time.", "ja": "1つの商品は一度に99個までご注文いただけます。"}],
].forEach(([k, v]) => { I18N[k] = Object.assign({}, I18N[k], v); });
/* ---------- 2026-10-28 정기 감사(7): 고객 화면 브라우저 테스트 — 영어·일본어로 안 바뀌던 버튼·안내·제목 ---------- */
[
  ["결제하기", {"en":"Pay now","ja":"決済する"}],
  ["결제할 금액 없이 주문하기", {"en":"Place order (nothing to pay)","ja":"お支払いなしで注文する"}],
  ["결제에 실패했습니다", {"en":"Payment failed","ja":"決済に失敗しました"}],
  ["계좌 발급에 실패했습니다", {"en":"Couldn't issue the account","ja":"口座の発行に失敗しました"}],
  ["장바구니가 바뀌어 쿠폰을 다시 적용해 주세요", {"en":"Your cart changed. Please apply your coupon again.","ja":"カートが変更されました。クーポンをもう一度適用してください"}],
  ["키(cm)와 몸무게(kg)를 확인해 주세요.", {"en":"Please check your height (cm) and weight (kg).","ja":"身長（cm）と体重（kg）をご確認ください。"}],
  ["이름 <span class=\"req\">*</span>", {"en":"Name <span class=\"req\">*</span>","ja":"お名前 <span class=\"req\">*</span>"}],
  ["취소 사유 <span class=\"req\">*</span>", {"en":"Cancellation reason <span class=\"req\">*</span>","ja":"キャンセル理由 <span class=\"req\">*</span>"}],
  ["사유 직접 입력 <span class=\"req\">*</span>", {"en":"Enter reason <span class=\"req\">*</span>","ja":"理由を入力 <span class=\"req\">*</span>"}],
  ["문의 내용 <span class=\"req\">*</span>", {"en":"Your question <span class=\"req\">*</span>","ja":"お問い合わせ内容 <span class=\"req\">*</span>"}],
  ["신청 유형 <span class=\"req\">*</span>", {"en":"Request type <span class=\"req\">*</span>","ja":"申請の種類 <span class=\"req\">*</span>"}],
  ["사유 <span class=\"req\">*</span>", {"en":"Reason <span class=\"req\">*</span>","ja":"理由 <span class=\"req\">*</span>"}],
  ["반품", {"en":"Return","ja":"返品"}],
  ["교환", {"en":"Exchange","ja":"交換"}],
  ["최신순", {"en":"Newest","ja":"新着順"}],
  ["별점 높은순", {"en":"Highest rated","ja":"評価の高い順"}],
  ["별점 낮은순", {"en":"Lowest rated","ja":"評価の低い順"}],
  ["인기순", {"en":"Most helpful","ja":"人気順"}],
  ["확인을 위해 '{word}'를 입력해 주세요", {"en":"Type '{word}' to confirm","ja":"確認のため「{word}」と入力してください"}],
  ["확인 문구로 '{word}'를 정확히 입력해 주세요.", {"en":"Please type '{word}' exactly to confirm.","ja":"確認のため「{word}」と正確に入力してください。"}],
  ["이 문서는 한국어로 제공되며, 한국어 원문이 법적 효력을 갖습니다.", {"en":"This document is provided in Korean, which is the legally binding version.","ja":"本文書は韓国語で提供されており、韓国語の原文が法的効力を有します。"}],
  ["REITEN — 리플렉티브 라이딩 후디", {"en":"REITEN — Reflective Riding Hoodies","ja":"REITEN — リフレクティブ・ライディングフーディー"}],
  ["내 계정 — REITEN", {"en":"My Account — REITEN","ja":"マイアカウント — REITEN"}],
  ["장바구니 · 주문서 — REITEN", {"en":"Cart & Checkout — REITEN","ja":"カート・ご注文 — REITEN"}],
  ["Zip Studio — 지퍼 참 만들기 | REITEN", {"en":"Zip Studio — Build a Zip Charm | REITEN","ja":"Zip Studio — ジップチャームを作る | REITEN"}],
  ["주문 접수 완료 — REITEN", {"en":"Order Received — REITEN","ja":"ご注文受付完了 — REITEN"}],
  ["주문 조회 — REITEN", {"en":"Order Lookup — REITEN","ja":"注文照会 — REITEN"}],
  ["개인정보처리방침 — REITEN", {"en":"Privacy Policy — REITEN","ja":"プライバシーポリシー — REITEN"}],
  ["상품 — REITEN", {"en":"Product — REITEN","ja":"商品 — REITEN"}],
  ["상품 문의 — REITEN", {"en":"Product Q&A — REITEN","ja":"商品へのお問い合わせ — REITEN"}],
  ["반품 · 교환 신청 — REITEN", {"en":"Returns & Exchanges — REITEN","ja":"返品・交換のお申し込み — REITEN"}],
  ["이용약관 — REITEN", {"en":"Terms of Service — REITEN","ja":"利用規約 — REITEN"}],
  ["위시리스트 — REITEN", {"en":"Wishlist — REITEN","ja":"ウィッシュリスト — REITEN"}],
  ["페이지를 찾을 수 없습니다 — REITEN", {"en":"Page Not Found — REITEN","ja":"ページが見つかりません — REITEN"}],
  ["일시적인 오류 — REITEN", {"en":"Temporary Error — REITEN","ja":"一時的なエラー — REITEN"}],
  ["국민은행", {"en":"KB Kookmin Bank","ja":"国民銀行"}],
  ["신한은행", {"en":"Shinhan Bank","ja":"新韓銀行"}],
  ["우리은행", {"en":"Woori Bank","ja":"ウリィ銀行"}],
  ["하나은행", {"en":"Hana Bank","ja":"ハナ銀行"}],
  ["농협은행", {"en":"NongHyup Bank","ja":"農協銀行"}],
  ["기업은행", {"en":"IBK Industrial Bank of Korea","ja":"企業銀行（IBK）"}],
  ["SC제일은행", {"en":"SC First Bank","ja":"SC第一銀行"}],
  ["한국씨티은행", {"en":"Citibank Korea","ja":"韓国シティ銀行"}],
  ["산업은행", {"en":"KDB Korea Development Bank","ja":"産業銀行（KDB）"}],
  ["수협은행", {"en":"Suhyup Bank","ja":"水協銀行"}],
  ["새마을금고", {"en":"MG Saemaul Geumgo","ja":"セマウル金庫"}],
  ["신협", {"en":"Shinhyup (Credit Union)","ja":"信協"}],
  ["우체국", {"en":"Korea Post","ja":"郵便局"}],
  ["카카오뱅크", {"en":"KakaoBank","ja":"カカオバンク"}],
  ["토스뱅크", {"en":"Toss Bank","ja":"トスバンク"}],
  ["케이뱅크", {"en":"K bank","ja":"Kバンク"}],
  ["iM뱅크(대구)", {"en":"iM Bank (Daegu)","ja":"iMバンク（大邱）"}],
  ["부산은행", {"en":"Busan Bank","ja":"釜山銀行"}],
  ["광주은행", {"en":"Kwangju Bank","ja":"光州銀行"}],
  ["제주은행", {"en":"Jeju Bank","ja":"済州銀行"}],
  ["전북은행", {"en":"Jeonbuk Bank","ja":"全北銀行"}],
  ["경남은행", {"en":"Kyongnam Bank","ja":"慶南銀行"}],
].forEach(([k, v]) => { I18N[k] = Object.assign({}, I18N[k], v); });

/**
 * t("한국어 원문", { name: "값" })
 * - ko 상태: {var} 치환만 하고 그대로 반환
 * - en/ja 상태: 딕셔너리에 있으면 번역, 없으면 한국어 원문으로 폴백
 */
function t(key, vars) {
  const lang = getLang();
  let s = key;
  if (lang !== "ko" && I18N[key] && typeof I18N[key][lang] === "string") s = I18N[key][lang];
  if (vars) {
    Object.keys(vars).forEach((k) => {
      s = s.replaceAll(`{${k}}`, vars[k]);
    });
  }
  return s;
}

/* 정적 HTML에 남아 있는 텍스트 치환 — data-i18n="키" / data-i18n-html(innerHTML 허용) / data-i18n-attr="attr:키|attr2:키2" */
function applyI18n(root = document) {
  if (getLang() === "ko") return;
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const val = t(el.dataset.i18n);
    if (el.hasAttribute("data-i18n-html")) el.innerHTML = val;
    else el.textContent = val;
  });
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    el.dataset.i18nAttr.split("|").forEach((pair) => {
      const i = pair.indexOf(":");
      const attr = pair.slice(0, i);
      const key = pair.slice(i + 1);
      el.setAttribute(attr, t(key));
    });
  });
}

document.documentElement.lang = getLang();
