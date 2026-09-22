import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const TYPES = new Set(["3x-ui", "subscription", "openai-api", "anthropic-api"]);
const numeric = (x) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);
export function subscriptionUsage(header) {
  if (!header) throw new Error("机场未提供 subscription-userinfo 用量头，无法采集真实流量");
  const fields = Object.fromEntries(header.split(";").map((x) => x.trim().split("=")));
  const read = (k) =>
    fields[k] !== undefined && fields[k].trim() !== "" ? numeric(Number(fields[k])) : null;
  const upload = read("upload"),
    download = read("download");
  if (upload === null || download === null) throw new Error("机场用量头缺少有效的上传或下载字节数");
  const expire = read("expire");
  return [
    {
      key: "traffic",
      label: "机场订阅",
      kind: "traffic",
      upload,
      download,
      total: read("total"),
      expiresAt: expire && expire < 8640000000000 ? new Date(expire * 1000).toISOString() : null,
    },
  ];
}
export function panelUsage(inbounds, filter = {}) {
  if (!Array.isArray(inbounds)) throw new Error("3x-ui 返回的入站列表无效");
  const rows = [];
  for (const inbound of inbounds) {
    if (filter.inboundId && String(inbound.id) !== String(filter.inboundId)) continue;
    const clients = filter.clientEmail
      ? (inbound.clientStats ?? []).filter((c) => c.email === filter.clientEmail)
      : null;
    for (const item of clients ?? [inbound]) {
      const upload = numeric(item.up),
        download = numeric(item.down);
      if (upload === null || download === null) continue;
      const expiry = numeric(item.expiryTime);
      rows.push({
        key: `inbound:${inbound.id}:${clients ? item.email : "all"}`,
        label: clients ? item.email : inbound.remark || `入站 ${inbound.id}`,
        kind: "traffic",
        upload,
        download,
        total: numeric(item.total),
        expiresAt: expiry && expiry < 8640000000000000 ? new Date(expiry).toISOString() : null,
      });
    }
  }
  if (!rows.length) throw new Error("未找到匹配的入站或客户端流量，请检查入站 ID 和客户端 Email");
  return rows;
}
function endpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("请输入有效的服务地址");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("服务地址只支持 HTTP / HTTPS，账号密码请单独填写");
  return url;
}
async function request(fetchImpl, url, options = {}, json = true, context = "AI API 用量") {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error(`${context}连接失败或超时，请检查服务地址、证书和网络`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    let hint = "";
    if ([401, 403].includes(response.status)) {
      if (context === "3x-ui 登录")
        hint =
          "：登录请求被拒绝。请核对面板根地址（含自定义路径，不含 /panel/ 页面后缀），以及反向代理、WAF 和 IP 访问限制；若启用了两步验证，当前自动采集尚不支持验证码登录";
      else if (context === "3x-ui 读取入站流量")
        hint =
          "：登录后的会话未被接口接受，或请求被代理拦截。请核对面板版本的 API 鉴权方式和反向代理规则";
      else if (context.startsWith("3x-ui"))
        hint = "：面板页面请求被拒绝，请检查访问地址和反向代理规则";
      else if (context === "机场订阅")
        hint = "：订阅地址失效、无权限或被机场访问规则拦截，请核对订阅地址";
      else hint = "：凭据无效或无用量查询权限；AI API 用量通常需要组织 Admin Key";
    }
    if (response.headers.get("cf-mitigated") === "challenge")
      hint += "；响应标记为 Cloudflare challenge，当前请求遇到了浏览器验证";
    throw new Error(context + " HTTP " + response.status + hint);
  }
  if (!json) {
    const result = subscriptionUsage(response.headers.get("subscription-userinfo"));
    await response.body?.cancel();
    return result;
  }
  let body = "",
    size = 0;
  const reader = response.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) throw new Error("用量响应超过 8 MiB");
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  if (json === "text") return { data: body, response };
  try {
    return { data: JSON.parse(body), response };
  } catch {
    throw new Error("用量接口未返回有效 JSON");
  }
}
export async function collectUsage(config, fetchImpl = fetch, now = Date.now()) {
  if (config.type === "subscription")
    return request(fetchImpl, endpoint(config.url), {}, false, "机场订阅");
  if (config.type === "3x-ui") {
    const base = endpoint(config.url);
    base.pathname = base.pathname.replace(/\/?$/, "/");
    base.search = "";
    base.hash = "";
    const cookies = new Map();
    const remember = (response) => {
      const headers = response.headers.getSetCookie?.() ?? [
        response.headers.get("set-cookie") ?? "",
      ];
      for (const header of headers) {
        const pair = header.split(";")[0];
        const split = pair.indexOf("=");
        if (split > 0) cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
    };
    const cookieHeader = () => [...cookies].map(([key, value]) => key + "=" + value).join("; ");
    const page = await request(
      fetchImpl,
      base,
      { headers: { "X-Requested-With": "XMLHttpRequest" } },
      "text",
      "3x-ui 初始化登录",
    );
    remember(page.response);
    const meta =
      String(page.data).match(/<meta\b[^>]*\bname\s*=\s*["']csrf-token["'][^>]*>/i)?.[0] ?? "";
    const csrf = meta.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    const loginHeaders = {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Origin: base.origin,
      Referer: base.href,
    };
    if (cookieHeader()) loginHeaders.Cookie = cookieHeader();
    if (csrf) loginHeaders["X-CSRF-Token"] = csrf;
    const login = await request(
      fetchImpl,
      new URL("login", base),
      {
        method: "POST",
        headers: loginHeaders,
        body: new URLSearchParams({ username: config.username, password: config.password }),
      },
      true,
      "3x-ui 登录",
    );
    if (login.data.success !== true)
      throw new Error("3x-ui 登录失败，请检查账号密码或面板二步验证设置");
    remember(login.response);
    if (!cookieHeader()) throw new Error("3x-ui 未返回会话 Cookie");
    const result = await request(
      fetchImpl,
      new URL("panel/api/inbounds/list", base),
      {
        headers: {
          Cookie: cookieHeader(),
          "X-Requested-With": "XMLHttpRequest",
          Referer: base.href,
        },
      },
      true,
      "3x-ui 读取入站流量",
    );
    if (result.data.success !== true) throw new Error("3x-ui 入站用量读取失败");
    return panelUsage(result.data.obj, config);
  }
  const openai = config.type === "openai-api";
  if (!openai && config.type !== "anthropic-api") throw new Error("不支持的用量来源");
  const start = Math.floor((now - 30 * 86400000) / 86400000) * 86400;
  const url = new URL(
    openai
      ? "https://api.openai.com/v1/organization/usage/completions"
      : "https://api.anthropic.com/v1/organizations/usage_report/messages",
  );
  url.searchParams.set(
    openai ? "start_time" : "starting_at",
    openai ? String(start) : new Date(start * 1000).toISOString(),
  );
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("limit", "31");
  const headers = openai
    ? { Authorization: `Bearer ${config.apiKey}` }
    : { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" };
  const rows = [],
    pages = new Set();
  for (let i = 0; i < 40; i++) {
    const { data } = await request(fetchImpl, url, { headers });
    if (!Array.isArray(data.data)) throw new Error("API 用量响应缺少时间桶");
    for (const bucket of data.data) {
      const bucketStart = openai
        ? new Date(bucket.start_time * 1000).toISOString()
        : new Date(bucket.starting_at).toISOString();
      let input = 0,
        output = 0,
        cached = 0,
        cacheWrite = 0;
      for (const row of bucket.results ?? []) {
        const a = numeric(openai ? row.input_tokens : row.uncached_input_tokens),
          b = numeric(row.output_tokens);
        if (a === null || b === null)
          throw new Error("API 未返回完整的输入 / 输出 Token，未写入不完整统计");
        const c = numeric(openai ? row.input_cached_tokens : row.cache_read_input_tokens) ?? 0;
        const w = openai
          ? 0
          : (numeric(row.cache_creation?.ephemeral_5m_input_tokens) ?? 0) +
            (numeric(row.cache_creation?.ephemeral_1h_input_tokens) ?? 0);
        input += a + (openai ? 0 : c + w);
        output += b;
        cached += c;
        cacheWrite += w;
      }
      rows.push({
        key: bucketStart,
        label: "组织 API · 全部 Key / 模型",
        kind: "tokens",
        bucketStart,
        input,
        output,
        cached,
        cacheWrite,
      });
    }
    if (!data.has_more) return rows;
    if (!data.next_page || pages.has(data.next_page))
      throw new Error("API 分页异常，未保存不完整统计");
    pages.add(data.next_page);
    url.searchParams.set("page", data.next_page);
  }
  throw new Error("API 用量分页超过上限");
}

export class UsageStore {
  #file;
  #vault;
  #fetch;
  #queue = Promise.resolve();
  #active = new Map();
  constructor(file, vault, fetchImpl = fetch) {
    this.#file = file;
    this.#vault = vault;
    this.#fetch = fetchImpl;
  }
  async #read() {
    try {
      return JSON.parse(await readFile(this.#file, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return { sources: [], records: [] };
      throw e;
    }
  }
  #write(fn) {
    const task = this.#queue.then(async () => {
      const state = await this.#read();
      const result = await fn(state);
      await mkdir(dirname(this.#file), { recursive: true });
      await writeFile(this.#file + ".tmp", JSON.stringify(state));
      await rename(this.#file + ".tmp", this.#file);
      return result;
    });
    this.#queue = task.catch(() => {});
    return task;
  }
  async list() {
    await this.#queue;
    return this.#read();
  }
  async add(input) {
    if (!TYPES.has(input?.type) || !String(input.name ?? "").trim())
      throw new Error("请填写来源名称和类型");
    const config = { type: input.type };
    if (["3x-ui", "subscription"].includes(input.type)) config.url = endpoint(input.url).href;
    if (input.type === "3x-ui") {
      if (!input.username || !input.password) throw new Error("请填写面板用户名和密码");
      Object.assign(config, {
        username: String(input.username),
        password: String(input.password),
        inboundId: String(input.inboundId ?? ""),
        clientEmail: String(input.clientEmail ?? ""),
      });
    }
    if (input.type.endsWith("-api")) {
      if (!input.apiKey?.trim()) throw new Error("请填写组织 Admin Key");
      config.apiKey = input.apiKey.trim();
    }
    const id = "usage-" + randomUUID();
    await this.#vault.set(id, config);
    return this.#write((state) => {
      const source = {
        id,
        name: String(input.name).trim().slice(0, 100),
        type: input.type,
        nodeId: typeof input.nodeId === "string" ? input.nodeId : "",
        createdAt: new Date().toISOString(),
      };
      state.sources.push(source);
      return source;
    });
  }
  async remove(id) {
    if (!/^usage-[\w-]+$/.test(id)) throw new Error("来源标识无效");
    await this.#vault.remove(id);
    return this.#write((state) => {
      state.sources = state.sources.filter((s) => s.id !== id);
    });
  }
  async record(id, rows, meta = {}) {
    const checkedAt = new Date().toISOString();
    return this.#write((state) => {
      let source = state.sources.find((s) => s.id === id);
      if (!source && meta.type === "oauth") {
        source = { id, name: meta.name, type: "oauth" };
        state.sources.push(source);
      }
      if (!source) return;
      source.checkedAt = checkedAt;
      source.error = "";
      for (const row of rows) {
        const old = [...state.records]
          .reverse()
          .find((r) => r.sourceId === id && r.key === row.key);
        const reset =
          row.kind === "traffic" && old && (row.upload < old.upload || row.download < old.download);
        const record = {
          ...row,
          sourceId: id,
          sourceName: source.name,
          checkedAt,
          ...(row.kind === "traffic"
            ? {
                counterReset: Boolean(reset),
                deltaUpload: old && !reset ? row.upload - old.upload : null,
                deltaDownload: old && !reset ? row.download - old.download : null,
              }
            : {}),
        };
        if (row.kind === "tokens")
          state.records = state.records.filter((r) => !(r.sourceId === id && r.key === row.key));
        if (row.kind === "quota" && old?.sampleAt === row.sampleAt) continue;
        state.records.push(record);
      }
    });
  }
  async markFailure(id, message) {
    return this.#write((state) => {
      const source = state.sources.find((s) => s.id === id);
      if (source) {
        source.error = message;
        source.attemptedAt = new Date().toISOString();
      }
    });
  }
  async recordAccount(account) {
    if (
      !account.usage ||
      account.usage.status === "stale" ||
      account.usageRefresh?.status === "error"
    )
      return;
    await this.record(
      "oauth:" + account.id,
      (account.usage.windows ?? []).map((window, index) => ({
        key: `${window.label}:${window.model ?? ""}:${index}`,
        kind: "quota",
        label: window.label,
        usedPercent: window.usedPercent ?? null,
        unit: window.unit ?? "percent",
        used: window.used ?? null,
        limit: window.limit ?? null,
        resetsAt: window.resetsAt,
        sampleAt: account.usage.checkedAt,
        scope: account.usage.scope ?? account.provider,
      })),
      { type: "oauth", name: `${account.provider} · ${account.email || account.accountId}` },
    );
  }
  refresh(id) {
    if (!/^usage-[\w-]+$/.test(id)) throw new Error("来源标识无效");
    if (this.#active.has(id)) return this.#active.get(id);
    const work = (async () => {
      const config = await this.#vault.get(id);
      if (!config) throw new Error("用量来源凭据不存在");
      try {
        await this.record(id, await collectUsage(config, this.#fetch));
      } catch (e) {
        await this.#write((state) => {
          const source = state.sources.find((s) => s.id === id);
          if (source) {
            source.error = e.message;
            source.attemptedAt = new Date().toISOString();
          }
        });
        throw e;
      }
      return this.list();
    })().finally(() => this.#active.delete(id));
    this.#active.set(id, work);
    return work;
  }
}
