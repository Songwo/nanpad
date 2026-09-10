// 函数会由浏览器序列化到当前标签页，所有依赖都限定在函数内部。
export function collectLoginForms() {
  const fields = [];
  let inspected = 0;
  const visit = (root) => {
    for (const element of root.querySelectorAll("*")) {
      if (++inspected > 12000 || fields.length >= 160) return;
      if (element instanceof HTMLInputElement) fields.push(element);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  visit(document);
  const visible = (input) => {
    if (input.disabled || input.type === "hidden" || !input.getClientRects().length) return false;
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
  };
  const description = (input) =>
    `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute("aria-label") || ""}`.toLowerCase();
  const excluded = (input) =>
    input.autocomplete.toLowerCase().split(/\s+/).includes("one-time-code") ||
    /(?:^|[\s_-])(?:otp|captcha|cvc|cvv|verification|verifycode|search)(?:$|[\s_-])|验证码|动态码|安全码/.test(
      description(input),
    );
  const usable = fields.filter((field) => visible(field) && !excluded(field));
  const groupOf = (input) => input.form || input.closest('[role="form"]') || input.getRootNode();
  const usernameScore = (input) => {
    if (!["text", "email", "tel"].includes(input.type)) return 0;
    const autocomplete = input.autocomplete.toLowerCase().split(/\s+/);
    if (autocomplete.includes("username")) return 5;
    if (autocomplete.includes("email") || input.type === "email") return 4;
    if (/user|email|e-mail|login|account|用户名|邮箱|账号|帐号/.test(description(input))) return 3;
    if (
      input.type === "text" &&
      !autocomplete.some((part) => /name|address|postal|cc-|bday/.test(part))
    )
      return 1;
    return 0;
  };
  const results = [];
  for (const password of usable.filter((input) => input.type === "password")) {
    const group = groupOf(password);
    const grouped = usable.filter((input) => groupOf(input) === group);
    const passwordIndex = grouped.indexOf(password);
    const candidates = grouped
      .map((input, index) => ({ input, index, score: usernameScore(input) }))
      .filter((candidate) => candidate.score > 0);
    const precedingPassword = grouped
      .slice(0, passwordIndex)
      .findLastIndex((input) => input.type === "password");
    const nearby = candidates.filter(
      (candidate) => candidate.index < passwordIndex && candidate.index > precedingPassword,
    );
    const pool = nearby.length
      ? nearby
      : candidates.filter((candidate) => candidate.index < passwordIndex);
    const fallback = pool.length ? pool : candidates.filter((candidate) => candidate.score >= 3);
    fallback.sort(
      (a, b) =>
        b.score - a.score || Math.abs(a.index - passwordIndex) - Math.abs(b.index - passwordIndex),
    );
    const rawUsername = fallback[0]?.input.value.trim() || "";
    const oversized = rawUsername.length > 320 || password.value.length > 4096;
    const username = rawUsername.length <= 320 ? rawUsername : "";
    const value = password.value.length <= 4096 ? password.value : "";
    const confirmation = /confirm|repeat|retype|确认|再次|重复/.test(description(password));
    if (confirmation && results.some((item) => item.group === group && item.username === username))
      continue;
    if (
      results.some(
        (item) => item.group === group && item.username === username && item.password === value,
      )
    )
      continue;
    results.push({
      group,
      username,
      password: value,
      oversized,
      kind: password.autocomplete.toLowerCase().split(/\s+/).includes("new-password")
        ? "new"
        : "login",
    });
    if (results.length === 8) break;
  }
  if (!results.length) {
    for (const field of usable.filter((input) => usernameScore(input) >= 3 && input.value.trim())) {
      if (field.value.trim().length > 320) continue;
      const username = field.value.trim();
      if (!results.some((item) => item.username === username))
        results.push({ username, password: "", kind: "account" });
      if (results.length === 8) break;
    }
  }
  return results.map(({ username, password, kind, oversized }) => ({
    username,
    password,
    kind,
    ...(oversized ? { oversized: true } : {}),
  }));
}
