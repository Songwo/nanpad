import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import { ExtensionBridge } from "./extension-bridge.mjs";

const ORIGIN = `chrome-extension://${"a".repeat(32)}`;
const OTHER_ORIGIN = `chrome-extension://${"b".repeat(32)}`;
const CAPTURE = {
  url: "https://embedded:credential@example.test/reset/private?token=private#secret",
  title: "测试网站",
  username: "person@example.test",
  password: "private-password-123!",
};

function send(port, path, options = {}) {
  const method =
    options.method ?? (path === "/v1/status" || options.body !== undefined ? "POST" : "GET");
  const value =
    options.body === undefined && path === "/v1/status" && method === "POST" ? {} : options.body;
  const body = options.rawBody ?? (value === undefined ? undefined : JSON.stringify(value));
  const headers = {
    ...(options.origin !== null ? { Origin: options.origin ?? ORIGIN } : {}),
    ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(body !== undefined ? { "Content-Length": Buffer.byteLength(body) } : {}),
    ...options.headers,
  };
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) delete headers[key];
  }
  return new Promise((resolve, reject) => {
    const connection = request(
      { hostname: "127.0.0.1", port, path, method, headers, agent: false },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text,
            body: text ? JSON.parse(text) : null,
          });
        });
        response.once("error", reject);
      },
    );
    connection.once("error", reject);
    connection.end(body);
  });
}

async function fixture(t, options = {}) {
  let unlocked = true;
  let checks = 0;
  const changes = [];
  const captures = [];
  const bridge = new ExtensionBridge({
    port: 0,
    isUnlocked: () => {
      checks++;
      return unlocked;
    },
    onChange: (value) => changes.push(value),
    onCapture: (...args) => captures.push(args),
    ...options,
  });
  await bridge.start();
  t.after(() => bridge.stop());
  return {
    bridge,
    changes,
    captures,
    port: bridge.status().port,
    get checks() {
      return checks;
    },
    lock() {
      unlocked = false;
      bridge.revoke();
    },
    unlock() {
      unlocked = true;
    },
    setUnlocked(value) {
      unlocked = value;
    },
  };
}

async function pair(value, origin = ORIGIN) {
  const pairing = value.bridge.beginPairing();
  const response = await send(value.port, "/v1/pair", {
    body: { code: pairing.code },
    origin,
  });
  assert.equal(response.status, 200);
  assert.match(response.body.token, /^[a-f0-9]{64}$/);
  return { ...pairing, token: response.body.token };
}

function assertNoSecrets(value, secrets = [CAPTURE.password, "embedded", "reset/private"]) {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) assert.ok(!serialized.includes(secret));
}

test("真实 HTTP 配对、核对元数据和一次性取出；响应与通知不含凭据", async (t) => {
  const value = await fixture(t);
  const pairing = await pair(value);
  assert.equal(pairing.port, value.port);
  assert.ok(pairing.expiresAt > Date.now());
  const status = await send(value.port, "/v1/status", { token: pairing.token });
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, { unlocked: true });
  const response = await send(value.port, "/v1/captures", {
    token: pairing.token,
    body: CAPTURE,
  });
  assert.equal(response.status, 201);
  assert.match(response.body.id, /^[a-f0-9]{32}$/);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["access-control-allow-origin"], ORIGIN);
  assert.deepEqual(Object.keys(response.body), ["id"]);
  const items = value.bridge.list();
  assert.deepEqual(items, [
    {
      id: response.body.id,
      url: "https://example.test/",
      title: CAPTURE.title,
      username: CAPTURE.username,
      hasCredential: true,
      createdAt: items[0].createdAt,
    },
  ]);
  assert.equal(typeof items[0].createdAt, "number");
  items[0].username = "modified";
  assert.equal(value.bridge.list()[0].username, CAPTURE.username);
  assertNoSecrets([response, value.changes, value.captures, value.bridge.list()]);
  assertNoSecrets(value.changes, [pairing.code, pairing.token, CAPTURE.username]);
  assert.deepEqual(value.captures, [[]]);
  assert.deepEqual(value.bridge.take(response.body.id), {
    id: response.body.id,
    url: "https://example.test/",
    title: CAPTURE.title,
    username: CAPTURE.username,
    password: CAPTURE.password,
  });
  assert.throws(() => value.bridge.take(response.body.id), /已过期或已被处理/u);
  assert.deepEqual(value.bridge.list(), []);
});

test("拒绝非扩展来源、伪造 Host 和未认证请求，错误均禁止缓存", async (t) => {
  const value = await fixture(t);
  const pairing = await pair(value);
  for (const origin of [
    null,
    "null",
    "https://example.test",
    "chrome-extension://invalid",
    `${ORIGIN}/`,
    `chrome-extension://${"z".repeat(32)}`,
  ]) {
    const response = await send(value.port, "/v1/status", {
      token: pairing.token,
      origin,
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  for (const host of ["localhost", `localhost:${value.port}`, "evil.test", "127.0.0.1:1"]) {
    const response = await send(value.port, "/v1/status", {
      token: pairing.token,
      headers: { Host: host },
    });
    assert.equal(response.status, 403);
  }
  for (const token of [undefined, "wrong-token", "f".repeat(64)]) {
    const response = await send(value.port, "/v1/status", { token });
    assert.equal(response.status, 401);
    assertNoSecrets(response, [pairing.code, pairing.token]);
  }
  const spoofed = await send(value.port, "/v1/status", {
    token: pairing.token,
    origin: OTHER_ORIGIN,
  });
  assert.equal(spoofed.status, 401);
  const duplicateOrigin = await send(value.port, "/v1/status", {
    token: pairing.token,
    headers: { Origin: [ORIGIN, OTHER_ORIGIN] },
  });
  assert.equal(duplicateOrigin.status, 403);
});

test("预检只允许已声明的扩展来源、方法和请求头", async (t) => {
  const value = await fixture(t);
  const response = await send(value.port, "/v1/captures", {
    method: "OPTIONS",
    headers: {
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type",
      "Access-Control-Request-Private-Network": "true",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers["access-control-allow-origin"], ORIGIN);
  assert.equal(response.headers["access-control-allow-private-network"], "true");
  assert.equal(response.headers["cache-control"], "no-store");
  for (const headers of [
    { "Access-Control-Request-Method": "DELETE" },
    {
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "x-unknown-header",
    },
  ]) {
    assert.equal(
      (await send(value.port, "/v1/captures", { method: "OPTIONS", headers })).status,
      403,
    );
  }
  const statusPreflight = await send(value.port, "/v1/status", {
    method: "OPTIONS",
    headers: {
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type",
    },
  });
  assert.equal(statusPreflight.status, 204);
  assert.equal(statusPreflight.headers["access-control-allow-methods"], "POST");
  for (const headers of [
    { "Access-Control-Request-Method": "GET" },
    {
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "x-unknown-header",
    },
  ]) {
    assert.equal(
      (await send(value.port, "/v1/status", { method: "OPTIONS", headers })).status,
      403,
    );
  }
});

test("状态接口仅接收 POST 空 JSON 对象并遵守正文大小和格式限制", async (t) => {
  const value = await fixture(t);
  const pairing = await pair(value);
  const options = { token: pairing.token };
  const response = await send(value.port, "/v1/status", options);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { unlocked: true });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal((await send(value.port, "/v1/status", { ...options, method: "GET" })).status, 405);
  for (const body of [null, [], false, 0, "", { token: pairing.token }, { extra: true }]) {
    const rejected = await send(value.port, "/v1/status", { ...options, body });
    assert.equal(rejected.status, 400);
    assertNoSecrets(rejected, [pairing.token]);
  }
  for (const rawBody of ["", "{broken"]) {
    assert.equal((await send(value.port, "/v1/status", { ...options, rawBody })).status, 400);
  }
  assert.equal(
    (
      await send(value.port, "/v1/status", {
        ...options,
        headers: { "Content-Type": "text/plain" },
      })
    ).status,
    415,
  );
  for (const headers of [{}, { "Content-Length": undefined, "Transfer-Encoding": "chunked" }]) {
    assert.equal(
      (
        await send(value.port, "/v1/status", {
          ...options,
          rawBody: " ".repeat(16 * 1024) + "{}",
          headers,
        })
      ).status,
      413,
    );
  }
  assert.equal(value.bridge.status().pendingCount, 0);
});

test("读取状态请求期间锁库或重新配对，读完后必须重新验证授权", async (t) => {
  for (const action of ["lock", "re-pair"]) {
    await t.test(action, async (t) => {
      const value = await fixture(t);
      const pairing = await pair(value);
      const checks = value.checks;
      let connection;
      const result = new Promise((resolve, reject) => {
        connection = request(
          {
            hostname: "127.0.0.1",
            port: value.port,
            method: "POST",
            path: "/v1/status",
            headers: {
              Origin: ORIGIN,
              Authorization: `Bearer ${pairing.token}`,
              "Content-Type": "application/json",
              "Content-Length": 2,
            },
            agent: false,
          },
          (response) => {
            response.resume();
            response.once("end", () => resolve(response.statusCode));
            response.once("error", reject);
          },
        );
        connection.once("error", reject);
        connection.write("{");
      });
      for (let attempt = 0; value.checks < checks + 2 && attempt < 100; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.ok(value.checks >= checks + 2);
      if (action === "lock") {
        value.lock();
        value.unlock();
      } else {
        await pair(value);
      }
      connection.end("}");
      assert.equal(await result, 401);
      assert.equal(value.bridge.status().pendingCount, 0);
    });
  }
});

test("配对码单次使用，重新生成使旧码失效，同一插件重配撤销旧令牌", async (t) => {
  const value = await fixture(t);
  const stale = value.bridge.beginPairing();
  const pairing = await pair(value);
  for (const code of [stale.code, pairing.code]) {
    const response = await send(value.port, "/v1/pair", { body: { code } });
    assert.equal(response.status, 401);
    assertNoSecrets(response, [code]);
  }
  const newer = await pair(value);
  assert.notEqual(newer.token, pairing.token);
  assert.equal(value.bridge.status().pairedClients, 1);
  assert.equal((await send(value.port, "/v1/status", { token: pairing.token })).status, 401);
  assert.equal((await send(value.port, "/v1/status", { token: newer.token })).status, 200);
});

test("锁库立即清理待保存内容、配对码及令牌；重新解锁必须重新配对", async (t) => {
  const value = await fixture(t);
  const pairing = await pair(value);
  const response = await send(value.port, "/v1/captures", {
    token: pairing.token,
    body: CAPTURE,
  });
  const pendingPair = value.bridge.beginPairing();
  value.lock();
  assert.deepEqual(value.bridge.list(), []);
  assert.equal(value.bridge.status().pairedClients, 0);
  assert.throws(() => value.bridge.beginPairing(), /解锁/u);
  assert.throws(() => value.bridge.take(response.body.id), /解锁/u);
  assert.equal(
    (await send(value.port, "/v1/captures", { token: pairing.token, body: CAPTURE })).status,
    423,
  );
  value.unlock();
  assert.equal((await send(value.port, "/v1/status", { token: pairing.token })).status, 401);
  assert.equal(
    (await send(value.port, "/v1/pair", { body: { code: pendingPair.code } })).status,
    401,
  );
  assert.throws(() => value.bridge.take(response.body.id), /已过期/u);
  await pair(value);
});

test("即使调用方遗漏撤销，服务也在观察到锁库时清理全部内存会话", async (t) => {
  const value = await fixture(t);
  const pairing = await pair(value);
  await send(value.port, "/v1/captures", { token: pairing.token, body: CAPTURE });
  value.setUnlocked(false);
  assert.equal(value.bridge.status().pendingCount, 0);
  assert.equal(value.bridge.status().pairedClients, 0);
  value.setUnlocked(true);
  assert.equal((await send(value.port, "/v1/status", { token: pairing.token })).status, 401);
});

test("配对码和凭据队列五分钟自动过期并通知，令牌不读取队列内容", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  const value = await fixture(t);
  const pairing = await pair(value);
  const response = await send(value.port, "/v1/captures", {
    token: pairing.token,
    body: CAPTURE,
  });
  const pendingPair = value.bridge.beginPairing();
  assert.equal(value.changes.at(-1).pendingCount, 1);
  t.mock.timers.tick(5 * 60 * 1000 + 1);
  assert.equal(value.changes.at(-1).pendingCount, 0);
  assert.throws(() => value.bridge.take(response.body.id), /已过期/u);
  assert.equal(
    (await send(value.port, "/v1/pair", { body: { code: pendingPair.code } })).status,
    401,
  );
  assert.equal((await send(value.port, "/v1/status", { token: pairing.token })).status, 200);
  assert.equal((await send(value.port, "/v1/captures", { token: pairing.token })).status, 405);
});

test("请求字段严格校验，拒绝多余字段、空凭据及异常类型", async (t) => {
  const value = await fixture(t);
  const pairing = await pair(value);
  const cases = [
    null,
    [],
    { ...CAPTURE, extra: "private" },
    { ...CAPTURE, title: "x".repeat(513) },
    { ...CAPTURE, title: null },
    { ...CAPTURE, url: "file:///private" },
    { ...CAPTURE, url: "javascript:alert(1)" },
    { ...CAPTURE, url: "https://example.test/" + "x".repeat(4096) },
    { ...CAPTURE, username: "" },
    { ...CAPTURE, username: " " },
    { ...CAPTURE, username: "x".repeat(321) },
    { ...CAPTURE, username: "bad\nname" },
    { ...CAPTURE, username: {} },
    { ...CAPTURE, password: "" },
    { ...CAPTURE, password: "x".repeat(4097) },
    { ...CAPTURE, password: 123 },
    { url: CAPTURE.url, title: CAPTURE.title, username: CAPTURE.username },
  ];
  for (const body of cases) {
    const response = await send(value.port, "/v1/captures", {
      token: pairing.token,
      body,
    });
    assert.equal(response.status, 400);
    assertNoSecrets(response);
  }
  assert.equal(value.bridge.status().pendingCount, 0);
  const pairResponse = await send(value.port, "/v1/pair", {
    body: { code: value.bridge.beginPairing().code, extra: "private" },
  });
  assert.equal(pairResponse.status, 401);
});

test("拒绝非 JSON、损坏 JSON、超过字节预算及带参数的路由", async (t) => {
  const value = await fixture(t);
  const pairing = await pair(value);
  for (const contentType of [
    "text/plain",
    "application/x-www-form-urlencoded",
    "application/json; charset=latin1",
  ]) {
    const response = await send(value.port, "/v1/captures", {
      token: pairing.token,
      body: CAPTURE,
      headers: { "Content-Type": contentType },
    });
    assert.equal(response.status, 415);
  }
  const malformed = await send(value.port, "/v1/captures", {
    method: "POST",
    token: pairing.token,
    rawBody: "{broken",
  });
  assert.equal(malformed.status, 400);
  const oversized = await send(value.port, "/v1/captures", {
    token: pairing.token,
    body: { ...CAPTURE, password: "大".repeat(6000) },
  });
  assert.equal(oversized.status, 413);
  const oversizedChunked = await send(value.port, "/v1/captures", {
    token: pairing.token,
    body: { ...CAPTURE, password: "x".repeat(17000) },
    headers: { "Content-Length": undefined, "Transfer-Encoding": "chunked" },
  });
  assert.equal(oversizedChunked.status, 413);
  assert.equal(
    (await send(value.port, "/v1/status?token=private", { token: pairing.token })).status,
    404,
  );
  assert.equal(value.bridge.status().pendingCount, 0);
});

test("队列最多十项，丢弃释放容量；八个客户端上限不阻止同一插件重配", async (t) => {
  const value = await fixture(t);
  let first;
  for (let index = 0; index < 8; index++) {
    const pairing = await pair(
      value,
      `chrome-extension://${String.fromCharCode(97 + index).repeat(32)}`,
    );
    first ??= pairing;
  }
  assert.equal(value.bridge.status().pairedClients, 8);
  const fullPairing = value.bridge.beginPairing();
  assert.equal(
    (
      await send(value.port, "/v1/pair", {
        origin: `chrome-extension://${"i".repeat(32)}`,
        body: { code: fullPairing.code },
      })
    ).status,
    409,
  );
  const replacement = await pair(value);
  assert.equal(value.bridge.status().pairedClients, 8);
  assert.equal((await send(value.port, "/v1/status", { token: first.token })).status, 401);
  for (let index = 0; index < 10; index++) {
    assert.equal(
      (
        await send(value.port, "/v1/captures", {
          token: replacement.token,
          body: { ...CAPTURE, username: `account-${index}` },
        })
      ).status,
      201,
    );
  }
  assert.equal(
    (await send(value.port, "/v1/captures", { token: replacement.token, body: CAPTURE })).status,
    409,
  );
  value.bridge.discard(value.bridge.list()[0].id);
  value.bridge.discard("unknown");
  assert.equal(
    (await send(value.port, "/v1/captures", { token: replacement.token, body: CAPTURE })).status,
    201,
  );
});

test("重复猜测配对码受到速率限制，并在一分钟后恢复", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  const value = await fixture(t);
  const pairing = value.bridge.beginPairing();
  for (let index = 0; index < 10; index++) {
    assert.equal(
      (await send(value.port, "/v1/pair", { body: { code: "0".repeat(64) } })).status,
      401,
    );
  }
  const limited = await send(value.port, "/v1/pair", { body: { code: pairing.code } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "60");
  t.mock.timers.tick(60 * 1000 + 1);
  assert.equal((await send(value.port, "/v1/pair", { body: { code: pairing.code } })).status, 200);
});

test("端口占用可重试，重复启停和同时启停不会遗留监听器或会话", async (t) => {
  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => occupied.close(() => resolve())));
  const value = await fixture(t, { port: occupied.address().port });
  assert.equal(value.bridge.status().running, false);
  assert.match(value.bridge.status().error, /端口被占用/u);
  assert.throws(() => value.bridge.beginPairing(), /尚未启动/u);
  await new Promise((resolve) => occupied.close(resolve));
  await Promise.all([value.bridge.start(), value.bridge.start()]);
  assert.equal(value.bridge.status().running, true);
  assert.equal(value.bridge.status().error, undefined);
  const pairing = await pair(value);
  const pending = await send(value.port, "/v1/captures", { token: pairing.token, body: CAPTURE });
  assert.equal(pending.status, 201);
  await Promise.all([value.bridge.stop(), value.bridge.stop()]);
  assert.equal(value.bridge.status().running, false);
  assert.equal(value.bridge.status().pendingCount, 0);
  await Promise.all([value.bridge.start(), value.bridge.stop()]);
  assert.equal(value.bridge.status().running, false);
  await Promise.all([value.bridge.stop(), value.bridge.start()]);
  assert.equal(value.bridge.status().running, true);
  assert.equal((await send(value.port, "/v1/status", { token: pairing.token })).status, 401);
});

test("读取请求体期间锁库并解锁，旧请求也不能重新获得写入权", async (t) => {
  const value = await fixture(t);
  const pairing = await pair(value);
  const body = JSON.stringify(CAPTURE);
  const checks = value.checks;
  let connection;
  const result = new Promise((resolve, reject) => {
    connection = request(
      {
        hostname: "127.0.0.1",
        port: value.port,
        method: "POST",
        path: "/v1/captures",
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${pairing.token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        agent: false,
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
        response.once("error", reject);
      },
    );
    connection.once("error", reject);
    connection.write(body.slice(0, 10));
  });
  for (let attempt = 0; value.checks < checks + 2 && attempt < 100; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(value.checks >= checks + 2);
  value.lock();
  value.unlock();
  connection.end(body.slice(10));
  assert.equal(await result, 401);
  assert.equal(value.bridge.status().pendingCount, 0);
  assert.equal(value.captures.length, 0);
});

test("通知异常与状态检查异常不会让服务或主进程崩溃", async (t) => {
  const value = await fixture(t, {
    onChange: () => {
      throw new Error("private-notification-detail");
    },
    onCapture: async () => {
      throw new Error("private-capture-detail");
    },
  });
  const pairing = await pair(value);
  assert.equal(
    (await send(value.port, "/v1/captures", { token: pairing.token, body: CAPTURE })).status,
    201,
  );
  const locked = await fixture(t, {
    isUnlocked: () => {
      throw new Error("private-vault-detail");
    },
  });
  assert.throws(() => locked.bridge.beginPairing(), /解锁/u);
  const response = await send(locked.port, "/v1/status");
  assert.equal(response.status, 423);
  assertNoSecrets(response, ["private-vault-detail"]);
});

test("读取请求体期间同一插件重新配对，旧令牌在途请求被拒绝", async (t) => {
  const value = await fixture(t);
  const original = await pair(value);
  const body = JSON.stringify(CAPTURE);
  const checks = value.checks;
  let connection;
  const result = new Promise((resolve, reject) => {
    connection = request(
      {
        hostname: "127.0.0.1",
        port: value.port,
        method: "POST",
        path: "/v1/captures",
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${original.token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        agent: false,
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
        response.once("error", reject);
      },
    );
    connection.once("error", reject);
    connection.write(body.slice(0, 10));
  });
  for (let attempt = 0; value.checks < checks + 2 && attempt < 100; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(value.checks >= checks + 2);
  await pair(value);
  connection.end(body.slice(10));
  assert.equal(await result, 401);
  assert.equal(value.bridge.status().pendingCount, 0);
});

test("未完成的请求体在五秒内结束，超时后不留下待保存凭据", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  const value = await fixture(t);
  const pairing = await pair(value);
  const checks = value.checks;
  const result = new Promise((resolve, reject) => {
    const connection = request(
      {
        hostname: "127.0.0.1",
        port: value.port,
        method: "POST",
        path: "/v1/captures",
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${pairing.token}`,
          "Content-Type": "application/json",
          "Content-Length": 100,
        },
        agent: false,
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
        response.once("error", reject);
      },
    );
    connection.once("error", reject);
    connection.write("{");
  });
  for (let attempt = 0; value.checks < checks + 2 && attempt < 100; attempt++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.ok(value.checks >= checks + 2);
  t.mock.timers.tick(5001);
  assert.equal(await result, 408);
  assert.equal(value.bridge.status().pendingCount, 0);
});

test("已认证插件每分钟最多三十次保存请求，状态请求也有全局上限", async (t) => {
  const value = await fixture(t);
  const pairing = await pair(value);
  for (let index = 0; index < 30; index++) {
    const response = await send(value.port, "/v1/captures", {
      token: pairing.token,
      body: CAPTURE,
    });
    assert.equal(response.status, 201);
    value.bridge.discard(response.body.id);
  }
  assert.equal(
    (await send(value.port, "/v1/captures", { token: pairing.token, body: CAPTURE })).status,
    429,
  );
  for (let index = 0; index < 88; index++) {
    assert.equal((await send(value.port, "/v1/status", { token: pairing.token })).status, 200);
  }
  assert.equal((await send(value.port, "/v1/status", { token: pairing.token })).status, 429);
});
