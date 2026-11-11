/* return-request.html 전용 스크립트 — 예전엔 HTML 안 인라인 <script>였다(2026-11-11 분리, 동작 동일). */
  applyI18n();
  renderHeader("");

  const el = (id) => document.getElementById(id);

  (async () => {
    const profile = await getCurrentProfile();
    if (profile && profile.name) el("rq-name").value = profile.name;
  })();

  el("rq-reason").addEventListener("change", () => {
    el("rq-custom-field").hidden = el("rq-reason").value !== "기타";
  });

  el("return-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const no = el("rq-no");
    const name = el("rq-name");
    const tel = el("rq-tel");
    const isOther = el("rq-reason").value === "기타";
    const custom = el("rq-custom");
    let ok = true;
    [
      [no, no.value.trim()],
      [name, name.value.trim()],
      [tel, tel.value.trim()],
    ].forEach(([field, val]) => {
      const invalid = !val;
      field.setAttribute("aria-invalid", String(invalid));
      field.closest(".field").querySelector(".err")?.classList.toggle("on", invalid);
      if (invalid) ok = false;
    });
    if (isOther && !custom.value.trim()) {
      custom.setAttribute("aria-invalid", "true");
      custom.closest(".field").querySelector(".err")?.classList.add("on");
      ok = false;
    } else {
      custom.setAttribute("aria-invalid", "false");
      custom.closest(".field").querySelector(".err")?.classList.remove("on");
    }
    if (!ok) { toast(t("입력값을 확인해 주세요")); return; }

    const btn = el("rq-submit");
    btn.disabled = true;

    try {
      const token = await getAccessToken();
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = "Bearer " + token;

      const res = await fetch("/api/returns", {
        method: "POST",
        headers,
        body: JSON.stringify({
          orderNo: no.value.trim(),
          contactName: name.value.trim(),
          contactTel: tel.value.trim(),
          reason: el("rq-reason").value,
          customReason: isOther ? custom.value.trim() : "",
          detail: el("rq-detail").value.trim(),
          requestType: el("rq-type").value === "exchange" ? "exchange" : "return",
        }),
      });
      if (!res.ok) {
        let message = "";
        try { message = apiErrorText(await res.json(), ""); } catch (e) {}
        toast(message || t("접수에 실패했습니다. server/가 실행 중인지 확인해 주세요."));
        btn.disabled = false;
        return;
      }

      el("return-form").hidden = true;
      el("done").hidden = false;
    } catch (err) {
      toast(t("접수에 실패했습니다. server/가 실행 중인지 확인해 주세요."));
      btn.disabled = false;
    }
  });

  renderFooter();
