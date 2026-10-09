import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createProxiedFetch } from "./outbound.mjs";

async function proxyFixture(t, handler) {
  const sockets = new Set();
  const proxy = createServer();
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  proxy.on("connect", handler);
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const transport = await createProxiedFetch(`http://127.0.0.1:${proxy.address().port}`);
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await transport.close();
    await new Promise((resolve) => proxy.close(resolve));
  });
  return transport;
}

test("真实 ProxyAgent 使用 CONNECT 到固定官方域名，不将 OAuth 凭据发给 HTTP 代理", async (t) => {
  const calls = [];
  const transport = await proxyFixture(t, (request, socket, head) => {
    calls.push({ url: request.url, headers: request.headers, head: head.toString() });
    socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  await assert.rejects(
    transport.fetch("https://connect.linux.do/oauth2/token", {
      method: "POST",
      headers: { Authorization: "Basic private-fixture" },
      body: "code=private-fixture",
      signal: AbortSignal.timeout(3000),
    }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "connect.linux.do:443");
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(JSON.stringify(calls).includes("private-fixture"), false);
});

test("真实 ProxyAgent 接收中止信号，未响应的代理不会无限等待", async (t) => {
  let connected;
  const accepted = new Promise((resolve) => {
    connected = resolve;
  });
  const transport = await proxyFixture(t, () => connected());
  const controller = new AbortController();
  const request = transport.fetch("https://connect.linux.do/api/user", {
    signal: controller.signal,
  });
  const rejected = assert.rejects(request, { name: "AbortError" });
  await accepted;
  controller.abort();
  await rejected;
});
