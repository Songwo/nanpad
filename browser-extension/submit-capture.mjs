// 内容脚本：开启「自动采集」后，在用户提交含密码的登录表单时读取账号密码，
// 经后台服务转发到本机司南待确认队列。默认关闭；关闭时不监听任何表单事件。
// 令牌不进入页面；本脚本不读取 iframe、封闭 Shadow DOM 或浏览器密码库。
(() => {
  if (window.__nanpadSubmitCapture) return;
  window.__nanpadSubmitCapture = true;
  const chrome = globalThis.chrome;
  const AUTO_KEY = "nanpadAutoCapture";
  let enabled = false;

  // 与 form-capture.mjs 相同的排除规则：验证码 / 一次性代码 / 安全码不参与账号识别。
  const EXCLUDED =
    /(?:^|[\s_-])(?:otp|captcha|cvc|cvv|verification|verifycode|search)(?:$|[\s_-])|验证码|动态码|安全码/i;

  function excluded(input) {
    return EXCLUDED.test(
      `${input.name ?? ""} ${input.id ?? ""} ${input.placeholder ?? ""} ${input.getAttribute("aria-label") ?? ""} ${input.autocomplete ?? ""}`,
    );
  }

  function scoreUsername(input) {
    const autocomplete = input.autocomplete || "";
    if (/username/i.test(autocomplete)) return 5;
    if (autocomplete === "email") return 4;
    const hint = `${input.name ?? ""} ${input.id ?? ""} ${input.placeholder ?? ""} ${input.getAttribute("aria-label") ?? ""}`.toLowerCase();
    if (/(user|email|e-mail|login|account|用户名|邮箱|账号|帐号)/.test(hint)) return 3;
    if (!/(name|address|postal|search|phone|mobile)/.test(hint)) return 1;
    return 0;
  }

  function formInputs(form) {
    const inputs = [...form.querySelectorAll("input")];
    return inputs.filter(
      (input) =>
        !input.disabled &&
        input.type !== "hidden" &&
        input.getClientRects().length > 0 &&
        input.value &&
        !excluded(input),
    );
  }

  function collect(form) {
    const inputs = formInputs(form);
    // 取第一个已填写的密码框作为登录密码；确认密码框通常在其后。
    const passwordInput = inputs.find((input) => input.type === "password");
    if (!passwordInput) return null;
    const usernameInput = inputs
      .filter((input) => ["text", "email", "tel"].includes(input.type))
      .sort(
        (a, b) =>
          scoreUsername(b) - scoreUsername(a) || inputs.indexOf(a) - inputs.indexOf(b),
      )[0];
    const username = (usernameInput?.value ?? "").trim().slice(0, 320);
    if (!username) return null;
    return {
      url: `${location.origin}/`,
      title: document.title,
      username,
      password: passwordInput.value.slice(0, 4096),
    };
  }

  function toast(ok) {
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent =
      ".box{font:12px/1.4 system-ui,sans-serif;color:#f5f7f6;background:#202a29;border-radius:8px;padding:8px 12px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:260px}";
    const box = document.createElement("div");
    box.className = "box";
    box.textContent = ok
      ? "司南：账号已发送，请在桌面端核对保存。"
      : "司南：未连接桌面端，账号未发送。";
    root.append(style, box);
    document.documentElement.append(host);
    setTimeout(() => host.remove(), 4000);
  }

  async function deliver(capture) {
    let reply;
    try {
      reply = await chrome.runtime.sendMessage({
        type: "nanpad-auto-capture",
        capture,
      });
    } catch {
      reply = null;
    }
    toast(Boolean(reply?.ok));
  }

  document.addEventListener(
    "submit",
    (event) => {
      if (!enabled) return;
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      try {
        // 必须在事件回调内同步读取：提交后页面可能立即跳转。
        const capture = collect(form);
        if (capture) void deliver(capture);
      } catch {
        /* 采集失败不打扰登录流程 */
      }
    },
    true,
  );

  async function refresh() {
    try {
      const stored = await chrome.storage.local.get(AUTO_KEY);
      enabled = stored[AUTO_KEY] === true;
    } catch {
      enabled = false;
    }
  }
  void refresh();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && AUTO_KEY in changes) enabled = changes[AUTO_KEY].newValue === true;
  });
})();
