const TYPES = new Set([
  "zhiyu-list",
  "zhiyu-fill",
  "zhiyu-stage",
  "zhiyu-pending",
  "zhiyu-save-pending",
  "zhiyu-dismiss-pending",
  "zhiyu-document",
  "zhiyu-save-account",
  "nanpad-auto-capture",
]);
const TOKEN_KEY = "nanpadConnectionToken";
export function safeSite(value) {
  const url = new URL(value);
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol))
    throw Error("invalid");
  return url;
}
export function canFill(value) {
  const url = safeSite(value);
  return url.protocol === "https:" || ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
}
export function createCompanionRouter({
  chrome,
  bridge,
  fetchImpl = fetch,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  const generations = new Map();
  const selections = new Map();
  const pending = new Map();
  const epoch = (id) => generations.get(id) || 0;
  const popupUrl = chrome.runtime.getURL("popup.html");
  function deletePending(id) {
    const record = pending.get(id);
    if (record?.timer) cancel(record.timer);
    pending.delete(id);
  }
  function invalidate(id, removed = false, nextUrl) {
    generations.set(id, epoch(id) + 1);
    selections.delete(id);
    if (removed || (nextUrl && pending.get(id)?.origin !== new URL(nextUrl).origin))
      deletePending(id);
    if (removed) generations.delete(id);
  }
  function clear() {
    selections.clear();
    for (const id of pending.keys()) deletePending(id);
  }
  async function context(message, sender) {
    if (sender.id !== chrome.runtime.id) throw Error("sender");
    // 扩展弹窗以独立标签打开时 Chrome 也可能提供 sender.tab；可信依据是浏览器提供的精确扩展 URL。
    const popup = sender.url === popupUrl && (sender.frameId === undefined || sender.frameId === 0);
    if (!popup && (sender.frameId !== 0 || !sender.tab || typeof sender.documentId !== "string"))
      throw Error("sender");
    const tabId = popup ? message.tabId : sender.tab.id;
    if (!Number.isInteger(tabId) || tabId < 0) throw Error("sender");
    const tab = await chrome.tabs.get(tabId);
    const url = safeSite(tab.url).href;
    if (!popup && safeSite(sender.url).href !== url) throw Error("navigated");
    if (tab.pendingUrl) throw Error("navigated");
    return {
      tabId,
      url,
      origin: new URL(url).origin,
      epoch: epoch(tabId),
      popup,
      documentId: popup ? undefined : sender.documentId,
    };
  }
  async function current(ctx) {
    const tab = await chrome.tabs.get(ctx.tabId);
    if (epoch(ctx.tabId) !== ctx.epoch || tab.pendingUrl || safeSite(tab.url).href !== ctx.url)
      throw Error("navigated");
  }
  async function request(path, body, ctx) {
    await current(ctx);
    const stored = await chrome.storage.session.get(TOKEN_KEY);
    const token = stored[TOKEN_KEY];
    if (typeof token !== "string" || !token) throw Error("unpaired");
    const response = await fetchImpl(`${bridge}${path}`, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(6000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      await chrome.storage.session.remove(TOKEN_KEY);
      clear();
      throw Error("unpaired");
    }
    if (response.status === 423) {
      clear();
      throw Error("locked");
    }
    if (response.status === 429) throw Error("rate");
    if (!response.ok) throw Error("rejected");
    const data = await response.json();
    await current(ctx);
    if ((await chrome.storage.session.get(TOKEN_KEY))[TOKEN_KEY] !== token) throw Error("unpaired");
    return data;
  }
  function capture(data, ctx) {
    if (!data || typeof data.username !== "string" || typeof data.password !== "string")
      throw Error("invalid");
    const username = data.username.trim();
    if (
      !username ||
      username.length > 320 ||
      /[\r\n\0]/.test(username) ||
      !data.password ||
      data.password.length > 4096
    )
      throw Error("invalid");
    return {
      url: `${ctx.origin}/`,
      title: String(data.title || new URL(ctx.url).hostname).slice(0, 120),
      username,
      password: data.password,
    };
  }
  function peek(ctx) {
    const record = pending.get(ctx.tabId);
    if (!record || record.expires <= now()) {
      deletePending(ctx.tabId);
      return null;
    }
    return record.origin === ctx.origin ? record : null;
  }
  async function pageMessage(ctx, message) {
    await current(ctx);
    const result = await chrome.tabs.sendMessage(
      ctx.tabId,
      message,
      ctx.documentId ? { documentId: ctx.documentId } : { frameId: 0 },
    );
    await current(ctx);
    return result;
  }
  async function handle(message, sender) {
    try {
      const ctx = await context(message, sender);
      const type = message.type;
      if (type === "zhiyu-stage" || type === "nanpad-auto-capture") {
        if (ctx.popup || !canFill(ctx.url)) throw Error("invalid");
        const prefs = await chrome.storage.local.get("nanpadAutoCapture");
        if (prefs.nanpadAutoCapture === false) throw Error("disabled");
        const stored = await chrome.storage.session.get(TOKEN_KEY);
        if (!stored[TOKEN_KEY]) throw Error("unpaired");
        await current(ctx);
        deletePending(ctx.tabId);
        while (pending.size >= 32) deletePending(pending.keys().next().value);
        const record = {
          origin: ctx.origin,
          expires: now() + 120000,
          capture: capture(message.capture, ctx),
        };
        record.timer = schedule(() => {
          if (pending.get(ctx.tabId) === record) deletePending(ctx.tabId);
        }, 120000);
        record.timer?.unref?.();
        pending.set(ctx.tabId, record);
        return { ok: true };
      }
      if (type === "zhiyu-pending") {
        const record = peek(ctx);
        return {
          ok: true,
          pending: record
            ? { username: record.capture.username, title: record.capture.title }
            : null,
        };
      }
      if (type === "zhiyu-dismiss-pending") {
        deletePending(ctx.tabId);
        return { ok: true };
      }
      if (type === "zhiyu-save-pending" || type === "zhiyu-save-account") {
        if (!canFill(ctx.url)) throw Error("insecure");
        const record = peek(ctx);
        const value =
          type === "zhiyu-save-account" && ctx.popup
            ? capture(message.capture, ctx)
            : record?.capture;
        if (!value) throw Error("expired");
        const result = await request("/v1/accounts/save", value, ctx);
        deletePending(ctx.tabId);
        selections.delete(ctx.tabId);
        return { ok: true, ...result };
      }
      if (type === "zhiyu-list") {
        if (!canFill(ctx.url)) throw Error("insecure");
        const result = await request("/v1/accounts/list", { url: `${ctx.origin}/` }, ctx);
        if (!Array.isArray(result.accounts) || typeof result.selectionToken !== "string")
          throw Error("rejected");
        const accounts = result.accounts
          .filter((item) => typeof item.id === "string" && typeof item.username === "string")
          .slice(0, 100);
        selections.set(ctx.tabId, {
          ...ctx,
          token: result.selectionToken,
          ids: new Set(accounts.map((item) => item.id)),
          expires: now() + 45000,
        });
        return {
          ok: true,
          accounts: accounts.map(({ id, title, username }) => ({ id, title, username })),
        };
      }
      if (type === "zhiyu-fill") {
        if (!canFill(ctx.url)) throw Error("insecure");
        const selection = selections.get(ctx.tabId);
        selections.delete(ctx.tabId);
        if (
          !selection ||
          selection.url !== ctx.url ||
          selection.epoch !== ctx.epoch ||
          selection.expires <= now() ||
          !selection.ids.has(message.id) ||
          (!ctx.popup && selection.documentId !== ctx.documentId)
        )
          throw Error("expired");
        const page = await pageMessage(ctx, { type: "zhiyu-page-ready", url: ctx.url });
        if (!page?.ready || typeof page.documentKey !== "string") throw Error("no-form");
        const credential = await request(
          "/v1/accounts/fill",
          { url: `${ctx.origin}/`, id: message.id, selectionToken: selection.token },
          ctx,
        );
        try {
          if (typeof credential.username !== "string" || typeof credential.password !== "string")
            throw Error("rejected");
          const result = await pageMessage(ctx, {
            type: "zhiyu-page-fill",
            url: ctx.url,
            documentKey: page.documentKey,
            credential,
          });
          if (!result?.ok) throw Error("no-form");
          return { ok: true };
        } finally {
          credential.password = "";
        }
      }
      if (type === "zhiyu-document") {
        // 正文由目标文档的内容脚本读取，弹窗/网页不能提交任意网站 URL。
        const document = await pageMessage(ctx, { type: "zhiyu-page-document", url: ctx.url });
        if (!document?.ok || typeof document.text !== "string" || document.text.length > 200000)
          throw Error("invalid");
        // 微信文章以 __biz/mid/idx/sn 定位；查询参数由桌面端按公开白名单清理。
        const source = new URL(ctx.url);
        source.hash = "";
        const result = await request(
          "/v1/documents",
          { url: source.href, title: document.title, text: document.text },
          ctx,
        );
        return { ok: true, ...result, partial: document.partial, sourceOnly: !document.text };
      }
      throw Error("invalid");
    } catch (error) {
      const known = [
        "unpaired",
        "locked",
        "rate",
        "rejected",
        "invalid",
        "navigated",
        "sender",
        "expired",
        "insecure",
        "no-form",
        "disabled",
      ];
      return { ok: false, reason: known.includes(error?.message) ? error.message : "offline" };
    }
  }
  return { accepts: (message) => TYPES.has(message?.type), handle, invalidate, clear };
}
