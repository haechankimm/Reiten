/* wishlist.html 전용 스크립트 — 예전엔 HTML 안 인라인 <script>였다(2026-11-11 분리, 동작 동일). */
  applyI18n();
  renderHeader("");

  (async () => {
    const [fromServer] = await Promise.all([loadProducts(), loadColors()]);

    const gridEl = document.getElementById("grid");
    const emptyEl = document.getElementById("empty");

    /* 위시리스트에 담아둔 상품이 품절되면, 예전엔 상품 페이지에 따로 들어가야만 재입고
       알림을 신청할 수 있었다("위시리스트와 재입고 알림이 따로 논다"는 2026-09 코드 감사
       지적) — 품절 상품 카드엔 재입고 알림 신청 버튼을 바로 붙여, 상품 페이지의 재입고
       알림 폼(#restock-notify-box)으로 곧장 이동하게 한다. */
    function restockLinkHTML(p) {
      if (!isProductFullyOutOfStock(p)) return "";
      return `<button type="button" class="btn btn--sm btn--ghost js-restock-link" data-product-id="${esc(p.id)}" style="margin-top:10px;width:100%">${esc(t("재입고 알림 신청"))}</button>`;
    }

    function paint() {
      const ids = Wishlist.read();
      const list = ids.map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean);
      /* 판매 종료(비공개)·삭제된 상품 id가 남아 있으면 헤더 배지 숫자(Wishlist.count)와 화면 카드 수가
         달랐다 — 서버 목록을 제대로 받아왔을 때만 아는 id만 남겨 다시 저장한다. 서버 없이 data.js 정적
         목록만 있을 때 지우면 DB에만 있는 상품까지 사라지므로 그때는 건드리지 않는다(2026-10-28 정기 감사). */
      if (fromServer && list.length !== ids.length) {
        Wishlist.write(list.map((p) => p.id));
      }
      gridEl.innerHTML = list.map((p, i) => productCard(p, i * 50, restockLinkHTML(p))).join("");
      emptyEl.hidden = list.length > 0;
      bindWishlistButtons(gridEl);
      gridEl.querySelectorAll(".js-restock-link").forEach((btn) =>
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          location.href = `product.html?id=${encodeURIComponent(btn.dataset.productId)}#restock-notify-box`;
        })
      );
      // 이 페이지에서는 하트를 누르면 목록 자체에서 카드가 빠져야 한다(다른 페이지는 배지만
      // 갱신되면 충분하지만, 여기는 그 상품 자체가 화면의 전부라서) — 클릭 처리(toggle) 다음
      // 틱에 다시 그린다.
      gridEl.querySelectorAll(".js-wishlist-btn").forEach((btn) =>
        btn.addEventListener("click", () => setTimeout(paint, 0))
      );
      initReveal();
      initBeams();
    }

    paint();
  })();

  renderFooter();
