import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

// 协议参数核对自 sub2api v0.2.1；供应商接口变更时独立维护适配器。
export const AI_PROVIDERS = {
  grok: {
    name: "xAI / Grok",
    mode: "loopback",
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
    authorize: "https://auth.x.ai/oauth2/authorize",
    token: "https://auth.x.ai/oauth2/token",
    redirect: "http://127.0.0.1:56121/callback",
    scope: "openid profile email offline_access grok-cli:access api:access",
    userinfo: "https://auth.x.ai/oauth2/userinfo",
    usage: "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
  },
  gemini: {
    name: "Google / Gemini",
    mode: "loopback",
    clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
    // Gemini CLI 随客户端公开分发的桌面 OAuth 参数，不是用户 API Key。
    clientSecret: "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",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    redirect: "http://localhost:0/oauth2callback",
    scope:
      "openid https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
    userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    usage: "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
    profile: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
  },
  openai: {
    name: "OpenAI / ChatGPT",
    mode: "loopback",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    authorize: "https://auth.openai.com/oauth/authorize",
    token: "https://auth.openai.com/oauth/token",
    redirect: "http://localhost:1455/auth/callback",
    scope: "openid profile email offline_access",
    usage: "https://chatgpt.com/backend-api/wham/usage",
  },
  claude: {
    name: "Anthropic / Claude",
    mode: "code",
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    authorize: "https://claude.com/cai/oauth/authorize",
    token: "https://platform.claude.com/v1/oauth/token",
    redirect: "https://platform.claude.com/oauth/code/callback",
    scope:
      "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
    usage: "https://api.anthropic.com/api/oauth/usage",
  },
};
const nonce = () => randomBytes(32).toString("base64url");
const PREFIX = "ai-oauth:";
const iso = (value) => {
  if (value == null || value === "") return null;
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const str = (value) => (typeof value === "string" ? value.slice(0, 300) : "");

export function normalizeUsage(provider, value) {
  const windows = [];
  if (provider === "openai") {
    for (const [label, entry] of Object.entries(value.rate_limit ?? {})) {
      if (!entry || typeof entry !== "object" || !Number.isFinite(entry.used_percent)) continue;
      windows.push({ label, usedPercent: entry.used_percent, resetsAt: iso(entry.reset_at) });
    }
  } else if (provider === "grok") {
    const config = value.config ?? {};
    if (Number.isFinite(config.creditUsagePercent))
      windows.push({
        label: "weekly",
        usedPercent: config.creditUsagePercent,
        resetsAt: iso(config.currentPeriod?.end),
      });
    for (const entry of config.productUsage ?? [])
      if (Number.isFinite(entry.usagePercent))
        windows.push({
          label: str(entry.product),
          usedPercent: entry.usagePercent,
          resetsAt: iso(config.currentPeriod?.end),
        });
  } else if (provider === "gemini") {
    for (const entry of value.buckets ?? [])
      if (Number.isFinite(entry.remainingFraction))
        windows.push({
          label: `${str(entry.modelId)} ${str(entry.tokenType)}`.trim(),
          usedPercent: Math.round((1 - entry.remainingFraction) * 10000) / 100,
          resetsAt: iso(entry.resetTime),
        });
  } else {
    for (const [label, entry] of Object.entries(value)) {
      if (!entry || typeof entry !== "object" || !Number.isFinite(entry.utilization)) continue;
      windows.push({ label, usedPercent: entry.utilization, resetsAt: iso(entry.resets_at) });
    }
  }
  return {
    plan: str(value.plan_type),
    windows: windows.slice(0, 12),
    checkedAt: new Date().toISOString(),
  };
}

export class AiAccounts {
  constructor({
    vault,
    openExternal,
    fetchImpl = fetch,
    providers = AI_PROVIDERS,
    timeoutMs = 300000,
  }) {
    this.vault = vault;
    this.openExternal = openExternal;
    this.fetch = fetchImpl;
    this.providers = providers;
    this.timeoutMs = timeoutMs;
    this.sessions = new Map();
    this.queue = Promise.resolve();
  }
  exclusive(fn) {
    const task = this.queue.then(fn);
    this.queue = task.catch(() => {});
    return task;
  }
  provider(id) {
    if (!Object.hasOwn(this.providers, id)) throw new Error("不支持的 AI 授权服务商。");
    return this.providers[id];
  }
  async request(url, options = {}) {
    let response;
    try {
      response = await this.fetch(url, {
        ...options,
        redirect: "error",
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error("无法连接授权服务，请检查网络或重试。");
    }
    if (!response.ok)
      throw new Error(`授权服务请求失败（HTTP ${response.status}），请检查权限或重新登录。`);
    const text = await response.text();
    if (text.length > 1048576) throw new Error("授权服务响应过大。");
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("授权服务未返回有效 JSON。");
    }
  }
  async start(provider) {
    const p = this.provider(provider);
    if (!this.vault.unlocked) throw new Error("请先解锁密钥库。");
    for (const session of this.sessions.values()) this.close(session, "cancelled");
    this.sessions.clear();
    const session = {
      id: nonce(),
      provider,
      state: nonce(),
      verifier: nonce(),
      status: "pending",
      controller: new AbortController(),
      redirect: p.redirect,
    };
    this.sessions.set(session.id, session);
    session.timer = setTimeout(() => this.close(session, "expired"), this.timeoutMs);
    session.timer.unref?.();
    try {
      if (p.mode === "loopback") {
        const redirect = new URL(p.redirect);
        session.server = createServer((req, res) => {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          const incoming = new URL(req.url ?? "/", p.redirect);
          if (
            req.method !== "GET" ||
            incoming.pathname !== redirect.pathname ||
            incoming.searchParams.get("state") !== session.state
          ) {
            res.writeHead(400);
            res.end("无效的授权回调。");
            return;
          }
          if (incoming.searchParams.has("error")) {
            this.close(session, "error");
            session.error = "授权已拒绝。";
            res.end("授权已取消，可以返回司南。");
            return;
          }
          const code = incoming.searchParams.get("code");
          if (!code || session.status !== "pending") {
            res.writeHead(400);
            res.end("授权码无效或已使用。");
            return;
          }
          res.end("已收到授权结果，请返回司南查看连接状态。");
          void this.finish(session.id, `${code}#${session.state}`).catch(() => {});
        });
        await new Promise((resolve, reject) => {
          session.server.once("error", () =>
            reject(new Error("授权回调端口被占用，请关闭其他登录流程后重试。")),
          );
          session.server.listen(Number(redirect.port), "127.0.0.1", resolve);
        });
        // 测试可分配随机端口；生产使用供应商已登记的固定回调地址。
        redirect.port = String(session.server.address().port);
        session.redirect = redirect.toString();
      }
      const url = new URL(p.authorize);
      for (const [key, value] of Object.entries({
        client_id: p.clientId,
        response_type: "code",
        redirect_uri: session.redirect,
        scope: p.scope,
        state: session.state,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256").update(session.verifier).digest("base64url"),
      }))
        url.searchParams.set(key, value);
      if (provider === "openai") {
        url.searchParams.set("codex_cli_simplified_flow", "true");
        url.searchParams.set("id_token_add_organizations", "true");
      }
      if (provider === "claude") url.searchParams.set("code", "true");
      if (provider === "gemini") {
        url.searchParams.set("access_type", "offline");
        url.searchParams.set("prompt", "consent");
      }
      await this.openExternal(url.toString());
      return { id: session.id, mode: p.mode };
    } catch (error) {
      this.close(session, "error");
      throw error;
    }
  }
  status(id) {
    const session = this.sessions.get(id);
    return session
      ? { status: session.status, error: session.error ?? "" }
      : { status: "expired", error: "" };
  }
  close(session, status) {
    if (!session) return;
    clearTimeout(session.timer);
    session.server?.close();
    session.controller.abort();
    session.status = status;
    delete session.verifier;
  }
  cancel(id) {
    this.close(this.sessions.get(id), "cancelled");
    return true;
  }
  stop() {
    for (const session of this.sessions.values()) this.close(session, "cancelled");
  }
  async exchange(p, body, signal) {
    if (p.clientSecret) body = { ...body, client_secret: p.clientSecret };
    const form = p.mode === "loopback";
    const tokens = await this.request(p.token, {
      method: "POST",
      signal,
      headers: { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    });
    if (
      !tokens ||
      typeof tokens.access_token !== "string" ||
      !tokens.access_token ||
      !Number.isFinite(tokens.expires_in) ||
      tokens.expires_in <= 0
    )
      throw new Error("授权服务返回的令牌不完整。");
    return tokens;
  }
  finish(id, input) {
    const session = this.sessions.get(id);
    if (!session || session.status !== "pending")
      return Promise.reject(new Error("授权已结束，请重新登录。"));
    const [code, state] = String(input).trim().split("#");
    if (!code || !state || state !== session.state)
      return Promise.reject(new Error("授权码或 state 不匹配，请粘贴完整的 code#state。"));
    session.status = "exchanging";
    return this.exclusive(async () => {
      try {
        const p = this.provider(session.provider);
        const tokens = await this.exchange(
          p,
          {
            grant_type: "authorization_code",
            client_id: p.clientId,
            redirect_uri: session.redirect,
            code_verifier: session.verifier,
            code,
            ...(session.provider === "claude" ? { state } : {}),
          },
          session.controller.signal,
        );
        if (session.controller.signal.aborted) throw new Error("授权已取消。");
        const identity = this.identity(session.provider, tokens);
        if (p.userinfo) {
          const info = await this.request(p.userinfo, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
            signal: session.controller.signal,
          });
          identity.accountId = str(info.sub);
          identity.email = str(info.email);
        }
        if (session.controller.signal.aborted) throw new Error("授权已取消。");
        if (!identity.accountId) throw new Error("授权服务没有返回账号标识。");
        const account = {
          ...identity,
          provider: session.provider,
          tokens,
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          usage: null,
        };
        const key =
          PREFIX +
          createHash("sha256").update(`${session.provider}:${identity.accountId}`).digest("hex");
        await this.vault.set(key, account);
        this.close(session, "connected");
        return this.publicAccount(key, account);
      } catch (error) {
        session.error = error.message;
        if (session.status !== "cancelled" && session.status !== "expired")
          this.close(session, "error");
        throw error;
      }
    });
  }
  identity(provider, tokens) {
    if (provider === "claude")
      return {
        accountId: str(tokens.account?.uuid ?? tokens.organization?.uuid),
        email: str(tokens.account?.email_address),
        plan: "",
      };
    // 仅显示从 TLS 令牌响应解码的元信息，不将未验签 JWT 用于权限决策。
    let claims = {};
    try {
      claims = JSON.parse(
        Buffer.from((tokens.id_token ?? tokens.access_token).split(".")[1], "base64url").toString(),
      );
    } catch {
      /* 部分令牌不包含 JWT 元信息。 */
    }
    const auth = claims["https://api.openai.com/auth"] ?? {};
    return {
      accountId: str(auth.chatgpt_account_id ?? claims.sub),
      email: str(claims.email),
      plan: str(auth.chatgpt_plan_type),
    };
  }
  publicAccount(id, account) {
    return {
      id,
      provider: account.provider,
      accountId: account.accountId,
      email: account.email,
      plan: account.plan,
      tokenExpiresAt: account.tokenExpiresAt,
      subscriptionExpiresAt: null,
      usage: account.usage ?? null,
      refreshable: Boolean(account.tokens.refresh_token),
    };
  }
  async list() {
    if (!this.vault.unlocked) throw new Error("请先解锁密钥库。");
    const result = [];
    for (const id of await this.vault.list())
      if (id.startsWith(PREFIX)) {
        const account = await this.vault.get(id);
        if (account) result.push(this.publicAccount(id, account));
      }
    return result;
  }
  async get(id) {
    if (typeof id !== "string" || !id.startsWith(PREFIX)) throw new Error("无效的 AI 账号。");
    const account = await this.vault.get(id);
    if (!account) throw new Error("AI 账号不存在。");
    return account;
  }
  remove(id) {
    return this.exclusive(async () => {
      await this.get(id);
      await this.vault.remove(id);
      return true;
    });
  }
  refresh(id) {
    return this.exclusive(async () => {
      const account = await this.get(id),
        p = this.provider(account.provider);
      const refreshTokens = async () => {
        if (!account.tokens.refresh_token) throw new Error("登录已过期，请重新授权。");
        const tokens = await this.exchange(p, {
          grant_type: "refresh_token",
          client_id: p.clientId,
          refresh_token: account.tokens.refresh_token,
        });
        account.tokens = { ...account.tokens, ...tokens };
        account.tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
        // 先保存轮换后的刷新令牌，避免额度请求失败导致旧令牌被重复使用。
        await this.vault.set(id, account);
      };
      if (Date.parse(account.tokenExpiresAt) < Date.now() + 60000) await refreshTokens();
      const headers = {
        Authorization: `Bearer ${account.tokens.access_token}`,
        Accept: "application/json",
      };
      if (account.provider === "claude") headers["anthropic-beta"] = "oauth-2025-04-20";
      else if (account.provider === "openai") {
        headers["ChatGPT-Account-Id"] = account.accountId;
        headers["OpenAI-Beta"] = "codex-1";
      } else if (account.provider === "grok") {
        headers["x-xai-token-auth"] = "xai-grok-cli";
        headers["x-grok-client-version"] = "0.2.120";
      }
      let usage;
      if (account.provider === "gemini") {
        headers["Content-Type"] = "application/json";
        const profile = await this.request(p.profile, {
          method: "POST",
          headers,
          body: JSON.stringify({
            metadata: {
              ideType: "IDE_UNSPECIFIED",
              platform: "PLATFORM_UNSPECIFIED",
              pluginType: "GEMINI",
            },
          }),
        });
        if (!profile.cloudaicompanionProject)
          throw new Error("Google 未返回 Code Assist 项目，请先在 Gemini CLI 完成账号开通。");
        account.plan = str(
          profile.paidTier?.name ?? profile.currentTier?.name ?? profile.currentTier?.id,
        );
        usage = await this.request(p.usage, {
          method: "POST",
          headers,
          body: JSON.stringify({ project: profile.cloudaicompanionProject }),
        });
      } else usage = await this.request(p.usage, { headers });
      account.usage = normalizeUsage(account.provider, usage);
      if (account.usage.plan) account.plan = account.usage.plan;
      if (typeof usage.email === "string") account.email = str(usage.email);
      await this.vault.set(id, account);
      return this.publicAccount(id, account);
    });
  }
}
