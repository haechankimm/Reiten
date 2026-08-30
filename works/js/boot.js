  /* ---------- 부팅 ---------- */
  (async () => {
    const [client] = await Promise.all([getSupabaseClient(), loadColorsLocal()]);
    if (!client) {
      el("no-server-notice").hidden = false;
      return;
    }

    const isRecovery = /type=recovery/.test(location.hash);
    const profile = isRecovery ? null : await getCurrentProfile();

    const savedEmail = localStorage.getItem("works_saved_email");
    if (savedEmail) {
      el("li-email").value = savedEmail;
      el("li-remember").checked = true;
    }

    if (isRecovery) {
      el("auth-view").hidden = false;
      el("login-form").hidden = true;
      el("reset-confirm-form").hidden = false;
    } else if (!profile) {
      el("auth-view").hidden = false;
    } else {
      const ok = await tryShowAdminPanel(profile);
      if (!ok) {
        await client.auth.signOut();
        el("auth-view").hidden = false;
        el("li-err").textContent = t("관리자 계정으로만 접속할 수 있습니다.");
        el("li-err").classList.add("on");
      }
    }

    /* 로그인 자체는 브라우저가 Supabase를 직접 호출해서 이뤄지고 서버(server/)는 그 결과를
       볼 수 없다 — 그래서 시도 전에는 지금 잠겨 있는지 물어보고, 시도 후에는 성공/실패를
       서버에 보고해서 같은 이메일이 7번 연속 실패하면 잠기게 한다(server.js의
       /api/admin/login-lock 참고). 이 보고 자체가 실패해도(네트워크 오류 등) 로그인 흐름을
       막으면 안 되므로 항상 조용히 넘어간다. */
    async function checkLoginLock(email) {
      try {
        const res = await fetch(`/api/admin/login-lock?email=${encodeURIComponent(email)}`);
        if (!res.ok) return { locked: false };
        return res.json();
      } catch (e) {
        return { locked: false };
      }
    }
    function reportLoginAttempt(email, success) {
      fetch("/api/admin/login-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, success }),
      }).catch(() => {});
    }

    el("login-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = el("li-submit");
      const email = el("li-email").value.trim();
      btn.disabled = true;

      const lock = await checkLoginLock(email);
      if (lock.locked) {
        const minutes = Math.max(1, Math.ceil((lock.retryAfterSeconds || 0) / 60));
        el("li-err").textContent = t("로그인 실패가 너무 많아 {n}분간 잠겼습니다. 잠시 후 다시 시도해 주세요.", { n: minutes });
        el("li-err").classList.add("on");
        btn.disabled = false;
        return;
      }

      const { error } = await client.auth.signInWithPassword({ email, password: el("li-pw").value });
      reportLoginAttempt(email, !error);
      if (error) {
        el("li-err").textContent = t("이메일 또는 비밀번호가 올바르지 않습니다.");
        el("li-err").classList.add("on");
        btn.disabled = false;
        return;
      }
      if (el("li-remember").checked) localStorage.setItem("works_saved_email", email);
      else localStorage.removeItem("works_saved_email");
      location.reload();
    });

    el("forgot-pw-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      el("login-form").hidden = true;
      el("reset-request-form").hidden = false;
    });

    el("rq-cancel")?.addEventListener("click", () => {
      el("reset-request-form").hidden = true;
      el("login-form").hidden = false;
    });

    el("reset-request-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = el("rq-submit");
      btn.disabled = true;
      const { error } = await client.auth.resetPasswordForEmail(el("rq-email").value.trim(), {
        redirectTo: location.origin + "/",
      });
      btn.disabled = false;
      if (error) {
        el("rq-err").textContent = authErrorMessage(error);
        el("rq-err").classList.add("on");
        return;
      }
      toast(t("재설정 링크를 이메일로 보내드렸습니다."));
      el("reset-request-form").hidden = true;
      el("login-form").hidden = false;
    });

    el("reset-confirm-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pw1 = el("rc-pw").value;
      const pw2 = el("rc-pw2").value;
      if (pw1.length < 6) {
        el("rc-err").textContent = t("비밀번호는 6자 이상이어야 합니다.");
        el("rc-err").classList.add("on");
        return;
      }
      if (pw1 !== pw2) {
        el("rc-err").textContent = t("비밀번호가 일치하지 않습니다.");
        el("rc-err").classList.add("on");
        return;
      }
      const btn = el("rc-submit");
      btn.disabled = true;
      const { error } = await client.auth.updateUser({ password: pw1 });
      btn.disabled = false;
      if (error) {
        el("rc-err").textContent = authErrorMessage(error);
        el("rc-err").classList.add("on");
        return;
      }
      toast(t("비밀번호가 변경되었습니다. 다시 로그인해 주세요."));
      await client.auth.signOut();
      location.href = "/";
    });

    el("logout")?.addEventListener("click", async () => {
      await client.auth.signOut();
      location.reload();
    });
  })();
