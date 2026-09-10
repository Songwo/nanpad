import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { normalizeCapture } from "./browser-capture.mjs";

const DEFAULT_PORT = 47832;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_CLIENTS = 8;
const MAX_PENDING = 10;
const LIFETIME_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
const RATE_WINDOW_MS = 60 * 1000;
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const HEX_SECRET = /^[a-f0-9]{64}$/;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function secretEquals(actual, expected) {
  return (
    typeof actual === "string" &&
    HEX_SECRET.test(actual) &&
    typeof expected === "string" &&
    HEX_SECRET.test(expected) &&
    timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
  );
}

function singleHeader(request, name) {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === name) count++;
  }
  return count === 1 && typeof request.headers[name] === "string"
    ? request.headers[name]
    : undefined;
}

function objectWithKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function normalizeCredentialCapture(value) {
  // source 是唯一的可选键：自动采集标记为 "auto"，其他值或不带该键都按手动采集处理。
  const keys =
    value?.source === "auto"
      ? ["url", "title", "username", "password", "source"]
      : ["url", "title", "username", "password"];
  if (
    !objectWithKeys(value, keys) ||
    typeof value.url !== "string" ||
    value.url.length > 4096 ||
    typeof value.title !== "string" ||
    value.title.length > 512 ||
    typeof value.username !== "string" ||
    value.username.length > 320 ||
    !value.username.trim() ||
    /[\r\n\0]/u.test(value.username) ||
    typeof value.password !== "string" ||
    !value.password.length ||
    value.password.length > 4096
  ) {
    throw new RequestError(400, "账号信息格式不正确。");
  }
  try {
    return {
      ...normalizeCapture(value),
      username: value.username.trim(),
      password: value.password,
      ...(value.source === "auto" ? { source: "auto" } : {}),
    };
  } catch {
    throw new RequestError(400, "网站地址不正确。");
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
      chunks = [];
    };
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error);
      else resolve(result);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish(new RequestError(413, "请求内容过大。"));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      try {
        finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        finish(new RequestError(400, "请求内容不是有效的 JSON。"));
      }
    };
    const onError = () => finish(new RequestError(400, "本机连接已中断。"));
    const onAborted = () => finish(new RequestError(400, "本机连接已中断。"));
    const timer = setTimeout(
      () => finish(new RequestError(408, "请求超时，请重试。")),
      REQUEST_TIMEOUT_MS,
    );
    timer.unref?.();
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
  });
}

export class ExtensionBridge {
  #isUnlocked;
  #onCapture;
  #onChange;
  #configuredPort;
  #port;
  #server = null;
  #accepting = false;
  #error;
  #pairing = null;
  #clients = new Map();
  #pending = new Map();
  #timer = null;
  #generation = 0;
  #operations = Promise.resolve();
  #intent = 0;
  #lastStop = 0;
  #requestRate = { startedAt: 0, count: 0 };
  #pairRate = { startedAt: 0, count: 0 };

  constructor({ isUnlocked, onCapture, onChange, port = DEFAULT_PORT }) {
    if (typeof isUnlocked !== "function") throw new TypeError("需要提供密钥库状态检查函数。");
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new TypeError("本机连接端口不正确。");
    this.#isUnlocked = isUnlocked;
    this.#onCapture = onCapture;
    this.#onChange = onChange;
    this.#configuredPort = port;
    this.#port = port;
  }

  #unlocked() {
    try {
      return this.#isUnlocked() === true;
    } catch {
      return false;
    }
  }

  #snapshot() {
    return {
      running: this.#accepting && Boolean(this.#server?.listening),
      port: this.#port,
      pairedClients: this.#clients.size,
      pairingPending: Boolean(this.#pairing),
      pendingCount: this.#pending.size,
      ...(this.#error ? { error: this.#error } : {}),
    };
  }

  #call(callback, ...args) {
    try {
      const result = callback?.(...args);
      result?.catch?.(() => {});
    } catch {
      // 界面通知失败不应中断本机服务或暴露请求内容。
    }
  }

  #notify() {
    this.#call(this.#onChange, this.#snapshot());
  }

  #scheduleExpiry() {
    clearTimeout(this.#timer);
    this.#timer = null;
    const deadlines = [...this.#pending.values()].map((item) => item.expiresAt);
    if (this.#pairing) deadlines.push(this.#pairing.expiresAt);
    if (!deadlines.length) return;
    this.#timer = setTimeout(
      () => this.#refresh(),
      Math.max(1, Math.min(...deadlines) - Date.now()),
    );
    this.#timer.unref?.();
  }

  #refresh() {
    if (!this.#unlocked() && (this.#pairing || this.#clients.size || this.#pending.size)) {
      this.revoke();
      return;
    }
    const now = Date.now();
    let changed = false;
    if (this.#pairing && this.#pairing.expiresAt <= now) {
      this.#pairing = null;
      changed = true;
    }
    for (const [id, item] of this.#pending) {
      if (item.expiresAt <= now) {
        this.#pending.delete(id);
        changed = true;
      }
    }
    this.#scheduleExpiry();
    if (changed) this.#notify();
  }

  status() {
    this.#refresh();
    return this.#snapshot();
  }

  #enqueue(operation) {
    const pending = this.#operations.then(operation, operation);
    this.#operations = pending.catch(() => {});
    return pending;
  }

  start() {
    const intent = ++this.#intent;
    return this.#enqueue(async () => {
      if (intent < this.#lastStop || this.#server?.listening) return this.status();
      this.#error = undefined;
      const server = createServer(
        {
          maxHeaderSize: 8192,
          headersTimeout: REQUEST_TIMEOUT_MS,
          requestTimeout: REQUEST_TIMEOUT_MS,
          connectionsCheckingInterval: 1000,
          keepAliveTimeout: 1000,
        },
        (request, response) => {
          void this.#handle(request, response);
        },
      );
      this.#server = server;
      server.maxConnections = 32;
      server.setTimeout(REQUEST_TIMEOUT_MS, (socket) => socket.destroy());
      server.on("clientError", (error, socket) => {
        if (!socket.writable || socket.destroyed) return;
        const status =
          error.code === "HPE_HEADER_OVERFLOW"
            ? "431 Request Header Fields Too Large"
            : error.code === "ERR_HTTP_REQUEST_TIMEOUT"
              ? "408 Request Timeout"
              : "400 Bad Request";
        socket.end(
          `HTTP/1.1 ${status}\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n`,
        );
      });
      server.on("error", (error) => {
        if (this.#server !== server) return;
        this.#accepting = false;
        this.#error =
          error.code === "EADDRINUSE"
            ? "浏览器连接端口被占用，请关闭其他司南实例后重试。"
            : "无法启动浏览器连接服务，请重试。";
        this.revoke();
      });
      const started = await new Promise((resolve) => {
        const onError = () => {
          server.off("listening", onListening);
          resolve(false);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve(true);
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(this.#configuredPort, "127.0.0.1");
      });
      if (!started || intent < this.#lastStop) {
        await this.#close(server);
        if (this.#server === server) this.#server = null;
        return this.status();
      }
      this.#port = server.address().port;
      this.#accepting = true;
      this.#notify();
      return this.status();
    });
  }

  async #close(server) {
    if (!server) return;
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  stop() {
    this.#lastStop = ++this.#intent;
    this.#accepting = false;
    this.revoke();
    return this.#enqueue(async () => {
      const server = this.#server;
      await this.#close(server);
      if (this.#server === server) this.#server = null;
      this.#notify();
      return this.status();
    });
  }

  beginPairing() {
    this.#refresh();
    if (!this.#unlocked()) throw new Error("请先解锁密钥库再连接浏览器插件。");
    if (!this.#accepting || !this.#server?.listening)
      throw new Error("浏览器连接服务尚未启动，请重试。");
    this.#pairing = {
      code: randomBytes(32).toString("hex"),
      expiresAt: Date.now() + LIFETIME_MS,
    };
    this.#scheduleExpiry();
    this.#notify();
    return { ...this.#pairing, port: this.#port };
  }

  revoke() {
    this.#generation++;
    this.#pairing = null;
    this.#clients.clear();
    this.#pending.clear();
    clearTimeout(this.#timer);
    this.#timer = null;
    this.#notify();
  }

  list() {
    this.#refresh();
    if (!this.#unlocked()) return [];
    return [...this.#pending.values()].map((item) => ({
      id: item.id,
      url: item.url,
      title: item.title,
      username: item.username,
      hasCredential: true,
      source: item.source === "auto" ? "auto" : "manual",
      createdAt: item.createdAt,
    }));
  }

  take(id) {
    this.#refresh();
    if (!this.#unlocked()) throw new Error("请先解锁密钥库。");
    const item = this.#pending.get(id);
    if (!item) throw new Error("待保存账号已过期或已被处理。");
    this.#pending.delete(id);
    this.#scheduleExpiry();
    this.#notify();
    return {
      id: item.id,
      url: item.url,
      title: item.title,
      username: item.username,
      password: item.password,
      source: item.source === "auto" ? "auto" : "manual",
    };
  }

  discard(id) {
    if (!this.#pending.delete(id)) return;
    this.#scheduleExpiry();
    this.#notify();
  }

  #rateAllowed(window, limit) {
    const now = Date.now();
    if (now - window.startedAt >= RATE_WINDOW_MS || now < window.startedAt) {
      window.startedAt = now;
      window.count = 0;
    }
    return ++window.count <= limit;
  }

  #authenticate(request, origin) {
    const authorization = singleHeader(request, "authorization");
    const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization ?? "")?.[1];
    let matched = null;
    for (const client of this.#clients.values()) {
      if (secretEquals(token, client.token) && client.origin === origin) matched = client;
    }
    if (!matched) throw new RequestError(401, "插件尚未连接，请重新配对。");
    return matched;
  }

  #requireCurrent(generation) {
    if (!this.#unlocked()) {
      this.revoke();
      throw new RequestError(423, "密钥库已锁定，请先解锁并重新配对。");
    }
    if (!this.#accepting || generation !== this.#generation)
      throw new RequestError(401, "连接已撤销，请重新配对。");
  }

  #respond(response, status, value) {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Connection: "close",
      ...(status === 429 ? { "Retry-After": "60" } : {}),
    });
    response.end(status === 204 ? undefined : JSON.stringify(value));
  }

  async #handle(request, response) {
    try {
      const origin = singleHeader(request, "origin");
      if (!origin || !EXTENSION_ORIGIN.test(origin))
        throw new RequestError(403, "不允许此来源连接。");
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      if (
        singleHeader(request, "host") !== `127.0.0.1:${this.#port}` ||
        request.socket.remoteAddress !== "127.0.0.1"
      )
        throw new RequestError(403, "仅允许直接连接本机服务。");
      if (!this.#accepting) throw new RequestError(503, "浏览器连接服务尚未就绪。");
      if (!this.#rateAllowed(this.#requestRate, 120))
        throw new RequestError(429, "请求过于频繁，请稍后重试。");
      this.#refresh();
      const generation = this.#generation;
      const route = request.url;
      if (!["/v1/pair", "/v1/status", "/v1/captures"].includes(route))
        throw new RequestError(404, "接口不存在。");
      const expectedMethod = "POST";
      if (request.method === "OPTIONS") {
        const method = singleHeader(request, "access-control-request-method");
        const requestedHeaders = (request.headers["access-control-request-headers"] ?? "")
          .split(",")
          .map((header) => header.trim().toLowerCase())
          .filter(Boolean);
        if (
          method !== expectedMethod ||
          requestedHeaders.some((header) => !["authorization", "content-type"].includes(header))
        )
          throw new RequestError(403, "不允许此预检请求。");
        response.setHeader("Access-Control-Allow-Methods", expectedMethod);
        response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        if (request.headers["access-control-request-private-network"] === "true")
          response.setHeader("Access-Control-Allow-Private-Network", "true");
        this.#respond(response, 204);
        return;
      }
      if (request.method !== expectedMethod) throw new RequestError(405, "不支持此请求方法。");
      this.#requireCurrent(generation);
      const client = route === "/v1/pair" ? null : this.#authenticate(request, origin);
      if (
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          singleHeader(request, "content-type") ?? "",
        )
      )
        throw new RequestError(415, "仅支持 JSON 请求。");
      if (Number(request.headers["content-length"] ?? 0) > MAX_BODY_BYTES)
        throw new RequestError(413, "请求内容过大。");
      if (
        (route === "/v1/pair" && !this.#rateAllowed(this.#pairRate, 10)) ||
        (route === "/v1/captures" && client && !this.#rateAllowed(client.rate, 30))
      )
        throw new RequestError(429, "请求过于频繁，请稍后重试。");
      const value = await readJson(request);
      // 读请求期间可能锁库或撤销授权，写入内存前必须重新核对这一代会话。
      this.#refresh();
      this.#requireCurrent(generation);
      if (route === "/v1/pair") {
        if (
          !objectWithKeys(value, ["code"]) ||
          !this.#pairing ||
          !secretEquals(value.code, this.#pairing.code)
        )
          throw new RequestError(401, "配对码无效或已过期，请重新生成。");
        const existing = [...this.#clients.values()].find((item) => item.origin === origin);
        if (!existing && this.#clients.size >= MAX_CLIENTS)
          throw new RequestError(409, "连接数量已达上限，请先断开已有连接。");
        const token = randomBytes(32).toString("hex");
        if (existing) this.#clients.delete(existing.token);
        this.#clients.set(token, {
          token,
          origin,
          rate: { startedAt: Date.now(), count: 0 },
        });
        this.#pairing = null;
        this.#scheduleExpiry();
        this.#notify();
        this.#respond(response, 200, { token });
        return;
      }
      // 同一插件重新配对也会撤销旧令牌，包括已经开始上传的旧请求。
      this.#authenticate(request, origin);
      if (route === "/v1/status") {
        if (!objectWithKeys(value, [])) throw new RequestError(400, "状态请求内容必须为空对象。");
        this.#respond(response, 200, { unlocked: true });
        return;
      }
      const capture = normalizeCredentialCapture(value);
      if (this.#pending.size >= MAX_PENDING)
        throw new RequestError(409, "待保存账号已达上限，请先在司南中处理。");
      const id = randomBytes(16).toString("hex");
      const createdAt = Date.now();
      this.#pending.set(id, {
        ...capture,
        id,
        createdAt,
        expiresAt: createdAt + LIFETIME_MS,
      });
      this.#scheduleExpiry();
      this.#notify();
      // 只把不含密码的元信息交给回调，桌面端据此决定是否聚焦窗口（自动采集不抢前台）。
      this.#call(
        this.#onCapture,
        {
          id,
          url: capture.url,
          title: capture.title,
          username: capture.username,
          source: capture.source === "auto" ? "auto" : "manual",
        },
      );
      this.#respond(response, 201, { id });
    } catch (error) {
      this.#respond(response, error instanceof RequestError ? error.status : 500, {
        error: error instanceof RequestError ? error.message : "本机连接请求未完成，请重试。",
      });
    }
  }
}
