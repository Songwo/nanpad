import assert from "node:assert/strict";
import test from "node:test";
import { createProxiedFetch } from "../services/identity-login/outbound.mjs";

test("未配置代理时保持直连且不加载服务端代理依赖", async () => {
  const calls = [];
  const transport = await createProxiedFetch(undefined, {
    fetchImpl: async (...args) => {
      calls.push(args);
      return new Response("{}");
    },
    loadUndici: () => {
      throw new Error("不应加载");
    },
  });
  await transport.fetch("https://connect.linux.do/api/user", { method: "GET" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].dispatcher, undefined);
  assert.equal(calls[0][1].redirect, "error");
  await transport.close();
});

test("仅官方请求使用本服务 dispatcher，保留中止信号和令牌交换参数", async () => {
  const calls = [];
  let agentOptions;
  const agents = [];
  let closed = 0;
  const transport = await createProxiedFetch("http://127.0.0.1:17892", {
    loadUndici: async () => ({
      ProxyAgent: class {
        constructor(options) {
          agentOptions = options;
          agents.push(this);
        }
        async close() {
          closed++;
        }
      },
      fetch: async (...args) => {
        calls.push(args);
        return new Response("{}");
      },
    }),
  });
  const signal = new AbortController().signal;
  const headers = {
    Authorization: "Basic fixture-only",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  await transport.fetch("https://connect.linux.do/oauth2/token", {
    method: "POST",
    body: "grant_type=authorization_code&code=fixture-code",
    signal,
    headers,
    redirect: "follow",
    dispatcher: { malicious: true },
  });
  assert.deepEqual(agentOptions, {
    uri: "http://127.0.0.1:17892",
    requestTls: { rejectUnauthorized: true },
  });
  assert.equal(calls[0][0], "https://connect.linux.do/oauth2/token");
  assert.equal(calls[0][1].dispatcher, agents[0]);
  assert.equal(calls[0][1].signal, signal);
  assert.equal(calls[0][1].headers, headers);
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].body, "grant_type=authorization_code&code=fixture-code");
  assert.equal(calls[0][1].redirect, "error");
  assert.equal(calls[0][1].credentials, "omit");
  await Promise.all([transport.close(), transport.close()]);
  assert.equal(closed, 1);
});

test("拒绝非本机或包含凭据的代理配置且错误不反射配置", async () => {
  for (const proxy of [
    "http://remote.test:17892",
    "https://127.0.0.1:17892",
    "http://localhost:17892",
    "http://127.0.0.1:80",
    "http://127.0.0.1:65536",
    "http://fixture-secret@127.0.0.1:17892",
    "http://127.0.0.1:17892/path",
    "http://127.0.0.1:17892?fixture-secret",
    "http://127.0.0.1:17892#fixture-secret",
    "http://2130706433:17892",
    " http://127.0.0.1:17892",
    123,
  ]) {
    await assert.rejects(createProxiedFetch(proxy), (error) => {
      assert.equal(error.message, "OUTBOUND_PROXY_URL 必须是无凭据的本机 HTTP 代理地址。");
      assert.equal(error.message.includes("fixture-secret"), false);
      return true;
    });
  }
});

test("代理请求不能改变官方目标或携带 URL 参数", async () => {
  let calls = 0;
  const transport = await createProxiedFetch("", {
    fetchImpl: async () => {
      calls++;
    },
  });
  for (const target of [
    "https://evil.test/api/user",
    "http://connect.linux.do/api/user",
    "https://connect.linux.do/api/user?secret",
    "https://connect.linux.do/api/user#secret",
    "https://secret@connect.linux.do/api/user",
    "https://connect.linux.do/oauth2/authorize",
    "https://connect.linux.do:8443/api/user",
    "https://connect.linux.do/api/../api/user",
  ]) {
    await assert.rejects(transport.fetch(target), { message: "登录上游请求目标无效。" });
  }
  assert.equal(calls, 0);
  await transport.close();
});
