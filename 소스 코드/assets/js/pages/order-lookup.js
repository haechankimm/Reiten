/* order-lookup.html 전용 스크립트 — 예전엔 HTML 안 인라인 <script>였다(2026-11-11 분리, 동작 동일). */
  // 주문 상품명을 지금 언어로 보여주려고 상품 목록을 미리 불러온다(2026-10-28)
  if (typeof loadProducts === "function") loadProducts().catch(() => {});
  // 옵션의 컬러 이름도 관리자가 추가한 색상까지 지금 언어로 보여주려고 팔레트를 받아온다(orderItemOptions, 2026-10-28 정기 감사)
  if (typeof loadColors === "function") loadColors().catch(() => {});
  applyI18n();
  renderHeader("");

  const el = (id) => document.getElementById(id);

  function trackingLinkHTML(courierKey, trackingNo) {
    const courier = COURIERS.find((c) => c.key === courierKey);
    if (!courier || !trackingNo) return "";
    const url = courier.urlTemplate.replace("{tracking}", encodeURIComponent(trackingNo));
    return `
      <b>${esc(t("배송 조회"))}</b><br>
      ${esc(t(courier.label))} · <span class="tnum">${esc(trackingNo)}</span><br>
      <a class="btn btn--sm" style="margin-top:10px" href="${esc(url)}" target="_blank" rel="noopener">${esc(t("배송 조회하기"))}</a>`;
  }

  el("lookup-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const no = el("lk-no");
    const tel = el("lk-tel");
    let ok = true;
    [[no, no.value.trim()], [tel, tel.value.trim()]].forEach(([field, val]) => {
      const invalid = !val;
      field.setAttribute("aria-invalid", String(invalid));
      field.closest(".field").querySelector(".err")?.classList.toggle("on", invalid);
      if (invalid) ok = false;
    });
    if (!ok) { toast(t("입력값을 확인해 주세요")); return; }

    const btn = el("lk-submit");
    btn.disabled = true;
    el("lk-notfound").hidden = true;
    el("lk-result").hidden = true;

    try {
      const res = await fetch("/api/orders/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNo: no.value.trim(), tel: tel.value.trim() }),
      });

      if (!res.ok) {
        // 404(주문번호·연락처 불일치)만 "찾을 수 없음" 안내 — 요청 과다(429) 등 다른 실패는 그 이유를 그대로 보여준다.
        if (res.status === 404) el("lk-notfound").hidden = false;
        else toast(apiErrorText(await res.json().catch(() => ({})), t("조회에 실패했습니다. 잠시 후 다시 시도해 주세요.")));
        return;
      }

      const o = await res.json();
      el("lk-title").textContent = t("주문번호") + " " + o.no;
      el("lk-status").textContent = t("주문 상태") + " · " + t(o.status || "입금대기") + " · " + new Date(o.at).toLocaleDateString(
        getLang() === "ko" ? "ko-KR" : getLang() === "ja" ? "ja-JP" : "en-US"
      );

      const trackHtml = trackingLinkHTML(o.courier, o.trackingNo);
      el("lk-tracking").innerHTML = trackHtml;
      el("lk-tracking").hidden = !trackHtml;

      el("lk-items").innerHTML = o.items.map((i) => `
        <tr>
          <td>${esc(orderItemName(i))}</td>
          <td style="text-align:left;color:var(--muted)">${esc(orderItemOptions(i))}</td>
          <td>${i.qty}</td>
          <td>${money(i.sum)}</td>
        </tr>`).join("") + orderAmountRowsHTML(o);

      // 입금대기면 입금 계좌, 배송된 주문이면 구매확정 버튼(lookup 응답은 lib/customerOrders.js)
      el("lk-extra").innerHTML = orderPaymentGuideHTML(o) + orderConfirmHTML(o);
      bindOrderConfirmButtons(el("lk-extra"), () => tel.value.trim(), () => el("lookup-form").requestSubmit());

      el("lk-result").hidden = false;

      // 발송 전(입금대기·입금확인) 상태에서만 고객이 스스로 주문취소를 신청할 수 있게 한다.
      lookedUpOrder = { no: o.no, tel: tel.value.trim() };
      el("lk-cancel-block").hidden = !["입금대기", "입금확인"].includes(o.status);
      el("lk-cancel-form").hidden = true;
      el("lk-cancel-done").hidden = true;
      // 한 번 "주문취소 신청"을 열거나 접수한 뒤 다시 조회하면 버튼이 숨겨진 채(또는 제출 버튼이 막힌 채)로 남아
      // 다시 신청할 수 없었다 — 조회할 때마다 처음 상태로 되돌린다(2026-10-28 정기 감사)
      el("lk-cancel-open").hidden = false;
      el("lk-cancel-submit").disabled = false;
    } catch (err) {
      toast(t("조회에 실패했습니다. server/가 실행 중인지 확인해 주세요."));
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- 주문취소 신청 ---------- */
  let lookedUpOrder = null;

  el("lk-cancel-open").addEventListener("click", () => {
    el("lk-cancel-form").hidden = false;
    el("lk-cancel-open").hidden = true;
  });

  el("ck-reason").addEventListener("change", () => {
    const isOther = el("ck-reason").value === "기타";
    el("ck-custom-field").hidden = !isOther;
  });

  el("lk-cancel-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!lookedUpOrder) return;

    const name = el("ck-name");
    const isOther = el("ck-reason").value === "기타";
    const custom = el("ck-custom");
    let ok = true;
    if (!name.value.trim()) { setErr(name, true); ok = false; } else setErr(name, false);
    if (isOther && !custom.value.trim()) { setErr(custom, true); ok = false; } else setErr(custom, false);
    if (!ok) { toast(t("입력값을 확인해 주세요")); return; }

    const btn = el("lk-cancel-submit");
    btn.disabled = true;
    try {
      const res = await fetch("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNo: lookedUpOrder.no,
          contactName: name.value.trim(),
          contactTel: lookedUpOrder.tel,
          reason: el("ck-reason").value,
          customReason: isOther ? custom.value.trim() : "",
          requestType: "cancel",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(apiErrorText(body, t("접수에 실패했습니다.")));
        btn.disabled = false;
        return;
      }
      el("lk-cancel-form").hidden = true;
      el("lk-cancel-done").hidden = false;
    } catch (err) {
      toast(t("접수에 실패했습니다. server/가 실행 중인지 확인해 주세요."));
      btn.disabled = false;
    }
  });

  function setErr(input, on) {
    input.setAttribute("aria-invalid", String(on));
    const err = input.closest(".field")?.querySelector(".err");
    if (err) err.classList.toggle("on", on);
  }

  renderFooter();
