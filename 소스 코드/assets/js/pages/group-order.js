/* group-order.html 전용 — 라이딩 크루·동호회 단체 주문 문의(2026-11-21). 서버: server/routes/groupInquiries.js */
  applyI18n();
  renderHeader("");

  const el = (id) => document.getElementById(id);

  (async () => {
    const profile = await getCurrentProfile();
    if (profile && profile.name) el("gi-name").value = profile.name;
    if (profile && profile.email) el("gi-email").value = profile.email;
  })();

  function setErr(input, on) {
    input.setAttribute("aria-invalid", String(on));
    input.closest(".field")?.querySelector(".err")?.classList.toggle("on", on);
  }

  el("group-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const checks = [
      ["gi-team", (v) => v.trim().length > 0],
      ["gi-name", (v) => v.trim().length > 0],
      ["gi-tel", (v) => /^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(v.replace(/\s/g, ""))],
      ["gi-email", (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())],
      ["gi-qty", (v) => Number(v) >= 5 && Number(v) <= 5000],
    ];
    let ok = true;
    checks.forEach(([id, fn]) => {
      const bad = !fn(el(id).value);
      setErr(el(id), bad);
      if (bad) ok = false;
    });
    if (!el("gi-agree").checked) {
      toast(t("개인정보 수집 및 이용에 동의해 주세요."));
      return;
    }
    if (!ok) { toast(t("입력값을 확인해 주세요")); return; }

    const btn = el("gi-submit");
    btn.disabled = true;
    try {
      const res = await fetch("/api/group-inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName: el("gi-team").value.trim(),
          contactName: el("gi-name").value.trim(),
          tel: el("gi-tel").value.trim(),
          email: el("gi-email").value.trim(),
          quantity: Number(el("gi-qty").value),
          desiredDate: el("gi-date").value || "",
          products: el("gi-products").value.trim(),
          customization: el("gi-custom").value.trim(),
          message: el("gi-message").value.trim(),
          website: el("gi-website").value,
        }),
      });
      if (!res.ok) {
        toast(apiErrorText(await res.json().catch(() => ({})), t("접수에 실패했습니다.")));
        btn.disabled = false;
        return;
      }
      el("group-form").hidden = true;
      el("gi-done").hidden = false;
      el("gi-done").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      toast(t("접수에 실패했습니다."));
      btn.disabled = false;
    }
  });

  renderFooter();
