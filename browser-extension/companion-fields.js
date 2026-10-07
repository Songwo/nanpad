// 运行于扩展隔离世界；页面脚本不能调用这些方法或读取保存的 DOM 引用。
(() => {
  const EXCLUDED =
    /(?:^|[\s_-])(?:otp|captcha|cvc|cvv|verification|verifycode|search)(?:$|[\s_-])|验证码|动态码|安全码/i;
  function visible(input) {
    if (
      !(input instanceof Element) ||
      !input.isConnected ||
      input.disabled ||
      input.readOnly ||
      input.type === "hidden" ||
      !input.getClientRects().length
    )
      return false;
    let node = input;
    while (node instanceof Element) {
      const style = getComputedStyle(node);
      if (
        node.hidden ||
        node.inert ||
        node.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility !== "visible" ||
        Number(style.opacity) === 0
      )
        return false;
      node = node.parentElement || node.getRootNode().host;
    }
    return true;
  }
  const hint = (input) =>
    `${input.name || ""} ${input.id || ""} ${input.placeholder || ""} ${input.getAttribute("aria-label") || ""} ${input.autocomplete || ""}`;
  const score = (input) => {
    if (
      !["text", "email", "tel"].includes(input.type) ||
      EXCLUDED.test(hint(input)) ||
      /one-time-code/.test(input.autocomplete)
    )
      return 0;
    if (/username/.test(input.autocomplete)) return 5;
    if (input.type === "email" || /email/.test(input.autocomplete)) return 4;
    if (/user|email|login|account|用户名|邮箱|账号|帐号/i.test(hint(input))) return 3;
    return input.type === "text" && !/search|address|name|postal|cc-|bday/i.test(input.autocomplete)
      ? 1
      : 0;
  };
  function roots() {
    const found = [document];
    let count = 0;
    for (let i = 0; i < found.length && i < 32; i++) {
      for (const el of found[i].querySelectorAll("*")) {
        if (++count > 12000) return found;
        if (el.shadowRoot) found.push(el.shadowRoot);
      }
    }
    return found;
  }
  function forms() {
    const matches = [];
    for (const root of roots()) {
      for (const password of [...root.querySelectorAll('input[type="password"]')].slice(0, 80)) {
        if (
          !visible(password) ||
          EXCLUDED.test(hint(password)) ||
          /one-time-code|new-password|confirm|repeat|new.?pass|old.?pass|确认|新密码/i.test(
            hint(password),
          )
        )
          continue;
        let scope = password.form || password.closest('[role="form"]');
        if (!scope) {
          scope = password.parentElement || root;
          for (
            let depth = 0;
            depth < 6 &&
            scope.parentElement &&
            ![...scope.querySelectorAll("input")].some((input) => score(input) > 0);
            depth++
          )
            scope = scope.parentElement;
        }
        const fields = [...scope.querySelectorAll("input")].filter(visible);
        if (
          fields.filter((input) => input.type === "password" && !EXCLUDED.test(hint(input)))
            .length !== 1
        )
          continue;
        const purpose = `${scope.id || ""} ${scope.getAttribute?.("name") || ""} ${scope.getAttribute?.("action") || ""} ${scope.getAttribute?.("aria-label") || ""}`;
        if (/sign.?up|register|reset|change.?pass|注册|重置|修改密码/i.test(purpose)) continue;
        if (password.form) {
          try {
            if (new URL(password.form.action, location.href).origin !== location.origin) continue;
          } catch {
            continue;
          }
        }
        const user = fields
          .filter((input) => score(input) > 0)
          .sort((a, b) => score(b) - score(a))[0];
        if (!user || user.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_PRECEDING)
          continue;
        matches.push({ username: user, password, scope });
      }
    }
    return matches;
  }
  function target() {
    const matches = forms();
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    const focused = matches.find((item) => item.username === active || item.password === active);
    return focused || (matches.length === 1 ? matches[0] : null);
  }
  function fill(pair, credential) {
    // 重新检测可见性与注册/改密状态，绝不覆盖用户正在输入的密码。
    if (
      !pair ||
      !forms().some((item) => item.username === pair.username && item.password === pair.password) ||
      pair.password.value
    )
      return false;
    if (
      typeof credential.username !== "string" ||
      typeof credential.password !== "string" ||
      credential.username.length > 320 ||
      credential.password.length > 4096 ||
      !credential.password
    )
      return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const originalUrl = location.href;
    for (const [input, value] of [
      [pair.username, credential.username],
      [pair.password, credential.password],
    ]) {
      if (
        location.href !== originalUrl ||
        !visible(input) ||
        !forms().some((item) => item.username === pair.username && item.password === pair.password)
      )
        return false;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }
    pair.password.focus();
    return true;
  }
  globalThis.__zhiyuFields = { visible, roots, forms, target, fill };
})();
