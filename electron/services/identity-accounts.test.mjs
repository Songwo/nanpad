import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, request } from "node:http";
import { mkdtemp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { IdentityAccounts } from "./identity-accounts.mjs";
import { Vault } from "./vault.mjs";

const MASTER = "identity-test-master";
const PROFILE = {
  id: 101,
  username: "sample_member",
  name: "测试用户",
  email: "member@example.test",
  trust_level: 3,
  active: true,
  silenced: false,
  avatar_template: "/user_avatar/linux.do/sample_member/{size}/1.png",
};
const TOKEN = {
  access_token: "private-access-token",
  refresh_token: "private-refresh-token",
  token_type: "Bearer",
  expires_in: 3600,
};
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const action = (id, extra = {}) => ({
  action_type: 4,
  username: PROFILE.username,
  topic_id: id,
  post_number: 1,
  title: `<b>主题 ${id}</b>`,
  excerpt:
    "<p>正文 &amp; 摘要 <script>alert(1)</script><a href='https://untrusted.test'>链接</a></p>",
  created_at: "2026-10-08T01:00:00Z",
  ...extra,
});

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "zhiyu-identity-test-"));
  const file = join(directory, "vault.enc");
  const vault = new Vault(file);
  await vault.create(MASTER);
  const port = await freePort();
  const redirectUri = `http://127.0.0.1:${port}/oauth/linuxdo/callback`;
  const ctx = {
    vault,
    file,
    directory,
    port,
    redirectUri,
    requests: [],
    opened: [],
    assets: { secrets: [] },
    profile: structuredClone(PROFILE),
    token: structuredClone(TOKEN),
    posts: [action(1)],
  };
  ctx.service = new IdentityAccounts({
    vault,
    getAssets: () => (options.getAssets ? options.getAssets(ctx) : ctx.assets),
    openExternal: async (url) => {
      ctx.opened.push(new URL(url));
      if (options.openExternal) await options.openExternal(url);
    },
    fetchImpl: async (url, init) => {
      ctx.requests.push({ url: new URL(url), init });
      if (ctx.respond) {
        const response = await ctx.respond(new URL(url), init);
        if (response) return response;
      }
      if (url.includes("/oauth2/token")) return json(ctx.token);
      if (url.includes("/api/user")) return json(ctx.profile);
      if (url.includes("/user_actions.json")) return json({ user_actions: ctx.posts });
      throw new Error("Unexpected test URL");
    },
  });
  t.after(async () => {
    ctx.service.stop();
    vault.lock();
    await rm(directory, { recursive: true, force: true });
  });
  ctx.configure = (extra = {}) =>
    ctx.service.configure({
      clientId: "test-client",
      clientSecret: "private-client-secret",
      redirectUri,
      ...extra,
    });
  ctx.callback = async (query = {}, init = {}) => {
    const auth = ctx.opened.at(-1);
    const callback = new URL(redirectUri);
    callback.search = new URLSearchParams({
      state: auth.searchParams.get("state"),
      code: "test-code",
      ...query,
    }).toString();
    const response = await fetch(callback, init);
    await response.text();
    return response.status;
  };
  ctx.login = async (options = {}) => {
    const session = await ctx.service.start();
    assert.equal(await ctx.callback(), 200);
    const preview = await ctx.service.status(session.id);
    assert.equal(preview.status, "ready");
    if (options.previewOnly) return { session, preview };
    const committed = await ctx.service.commit({
      sessionId: session.id,
      folderId: options.folderId,
    });
    const index = ctx.assets.secrets.findIndex((asset) => asset.id === committed.asset.id);
    if (index < 0) ctx.assets.secrets.push(committed.asset);
    else ctx.assets.secrets[index] = committed.asset;
    return { session, preview, ...committed };
  };
  return ctx;
}

test("Connect 配置仅加密保存，渲染层看不到应用密钥，非法回调被拒绝", async (t) => {
  const ctx = await fixture(t);
  assert.equal((await ctx.service.config()).configured, false);
  assert.deepEqual(await ctx.configure(), {
    clientId: "test-client",
    redirectUri: ctx.redirectUri,
    hasClientSecret: true,
    configured: true,
  });
  await ctx.configure({ clientSecret: "" });
  assert.equal(
    (await ctx.vault.get("identity-config:linuxdo")).clientSecret,
    "private-client-secret",
  );
  for (const redirectUri of [
    "https://127.0.0.1:49283/oauth/linuxdo/callback",
    "http://localhost:49283/oauth/linuxdo/callback",
    "http://127.0.0.1:80/oauth/linuxdo/callback",
    "http://127.0.0.1:49283/other",
    `${ctx.redirectUri}?other=1`,
    `${ctx.redirectUri}#fragment`,
    "http://evil.test:49283/oauth/linuxdo/callback",
  ])
    await assert.rejects(ctx.configure({ redirectUri }), /回调/);
  await assert.rejects(ctx.configure({ clientId: "bad\nheader" }), /Client ID/);
  assert.doesNotMatch(await readFile(ctx.file, "utf8"), /private-client-secret|test-client/);
  assert.equal(ctx.requests.length, 0);
});

test("系统浏览器授权带 PKCE 与 state；确认之前不写账号，确认后两份记录原子加密", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const { session, preview } = await ctx.login({ previewOnly: true });
  const auth = ctx.opened[0];
  assert.equal(auth.origin, "https://connect.linux.do");
  assert.equal(auth.pathname, "/oauth2/authorize");
  assert.equal(auth.searchParams.get("redirect_uri"), ctx.redirectUri);
  assert.equal(auth.searchParams.get("scope"), "openid profile email");
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  assert.ok(auth.searchParams.get("state").length >= 40);
  assert.doesNotMatch(auth.href, /private-/);
  const tokenRequest = ctx.requests.find((call) => call.url.pathname === "/oauth2/token");
  const fields = new URLSearchParams(tokenRequest.init.body);
  assert.equal(
    createHash("sha256").update(fields.get("code_verifier")).digest("base64url"),
    auth.searchParams.get("code_challenge"),
  );
  assert.equal(fields.get("redirect_uri"), ctx.redirectUri);
  assert.equal(fields.get("grant_type"), "authorization_code");
  assert.equal(
    tokenRequest.init.headers.Authorization,
    `Basic ${Buffer.from("test-client:private-client-secret").toString("base64")}`,
  );
  assert.equal(ctx.requests[1].init.headers.Authorization, `Bearer ${TOKEN.access_token}`);
  for (const call of ctx.requests) {
    assert.equal(call.init.redirect, "error");
    assert.equal(call.init.credentials, "omit");
  }
  assert.deepEqual(await ctx.vault.list(), ["identity-config:linuxdo"]);
  assert.equal(preview.preview.trustLevel, 3);
  assert.equal(preview.preview.profileUrl, "https://linux.do/u/sample_member");
  assert.doesNotMatch(JSON.stringify(preview), /private-access|private-refresh|private-client/);
  const result = await ctx.service.commit({ sessionId: session.id, folderId: "folder-one" });
  assert.equal(result.asset.folderId, "folder-one");
  assert.equal(result.asset.identityProvider, "linuxdo");
  assert.equal(result.account.connected, true);
  assert.equal((await ctx.vault.list()).length, 3);
  assert.doesNotMatch(JSON.stringify(result), /accessToken|refreshToken|clientSecret|private-/);
  const record = await ctx.vault.get(`account:${result.asset.id}`);
  assert.equal(record.username, PROFILE.username);
  assert.doesNotMatch(JSON.stringify(record), /token|secret/i);
  assert.doesNotMatch(await readFile(ctx.file, "utf8"), /private-|sample_member|member@example/);
  assert.deepEqual(await ctx.service.managedAssets(), [result.asset]);
  await assert.rejects(ctx.service.commit({ sessionId: session.id }), /失效/);
});

test("错误 state、Host、路径、方法或重复参数不能消费授权会话", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const session = await ctx.service.start();
  assert.equal(await ctx.callback({ state: "wrong" }), 400);
  assert.equal(await ctx.callback({}, { method: "POST" }), 400);
  const wrongPath = await fetch(`http://127.0.0.1:${ctx.port}/wrong`);
  assert.equal(wrongPath.status, 400);
  await wrongPath.text();
  const repeated = await fetch(
    `${ctx.redirectUri}?state=${ctx.opened[0].searchParams.get("state")}&code=a&code=b`,
  );
  assert.equal(repeated.status, 400);
  await repeated.text();
  const wrongHost = await new Promise((resolve, reject) => {
    const req = request(
      `${ctx.redirectUri}?code=test&state=${ctx.opened[0].searchParams.get("state")}`,
      { headers: { Host: "evil.test" } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(wrongHost, 400);
  assert.equal(ctx.requests.length, 0);
  assert.equal((await ctx.service.status(session.id)).status, "waiting");
  assert.equal(await ctx.callback(), 200);
  assert.equal((await ctx.service.status(session.id)).status, "ready");
});

test("并发重放回调被拒绝，不破坏第一次授权交换", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const entered = deferred(),
    released = deferred();
  ctx.respond = async (url) => {
    if (url.pathname === "/oauth2/token") {
      entered.resolve();
      await released.promise;
    }
  };
  const session = await ctx.service.start();
  const first = ctx.callback();
  await entered.promise;
  assert.equal(await ctx.callback(), 409);
  released.resolve();
  assert.equal(await first, 200);
  assert.equal((await ctx.service.status(session.id)).status, "ready");
  assert.equal(ctx.requests.filter((call) => call.url.pathname === "/oauth2/token").length, 1);
});

test("固定回调端口占用时不改用随机地址，也不会打开浏览器", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(ctx.port, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  await assert.rejects(ctx.service.start(), /占用/);
  assert.equal(ctx.opened.length, 0);
  assert.equal((await ctx.service.config()).redirectUri, ctx.redirectUri);
});

test("取消浏览器授权只返回安全错误，不把提供方原文送回界面", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const session = await ctx.service.start();
  const response = await fetch(
    `${ctx.redirectUri}?state=${ctx.opened[0].searchParams.get("state")}&error=access_denied&error_description=private-data`,
  );
  assert.equal(response.status, 400);
  assert.doesNotMatch(await response.text(), /private-data/);
  const status = await ctx.service.status(session.id);
  assert.equal(status.status, "error");
  assert.match(status.error, /拒绝/);
  assert.doesNotMatch(JSON.stringify(status), /private-data/);
  assert.equal(ctx.requests.length, 0);
});

test("锁库中断正在取资料的授权，解锁后不会出现旧预览或账号", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const entered = deferred(),
    released = deferred();
  ctx.respond = async (url) => {
    if (url.pathname === "/api/user") {
      entered.resolve();
      await released.promise;
    }
  };
  const session = await ctx.service.start();
  const callback = ctx.callback();
  await entered.promise;
  ctx.vault.lock();
  released.resolve();
  assert.equal(await callback, 400);
  await assert.rejects(ctx.service.config(), /解锁/);
  await ctx.vault.unlock(MASTER);
  assert.equal((await ctx.service.status(session.id)).status, "cancelled");
  await assert.rejects(ctx.service.commit({ sessionId: session.id }), /失效/);
  assert.deepEqual(await ctx.vault.list(), ["identity-config:linuxdo"]);
  assert.equal(ctx.requests[1].init.signal.aborted, true);
});

test("确认导入等待资产读取时取消，不会落盘或恢复被取消的凭据", async (t) => {
  const entered = deferred(),
    released = deferred();
  const ctx = await fixture(t, {
    getAssets: async (ctx) => {
      entered.resolve();
      await released.promise;
      return ctx.assets;
    },
  });
  await ctx.configure();
  const { session } = await ctx.login({ previewOnly: true });
  const committing = ctx.service.commit({ sessionId: session.id });
  await entered.promise;
  await ctx.service.cancel(session.id);
  released.resolve();
  await assert.rejects(committing, /失效/);
  assert.deepEqual(await ctx.vault.list(), ["identity-config:linuxdo"]);
});

test("同一官方标识重复导入去重，保留自定义资产名、分组和旧账号字段", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const first = await ctx.login({ folderId: "original-folder" });
  ctx.assets.secrets[0] = {
    ...first.asset,
    name: "我自定义的身份",
    folderId: "custom-folder",
    tags: ["重要"],
    notes: "自定义备注",
  };
  await ctx.vault.set(`account:${first.asset.id}`, {
    password: "existing-private-password",
    custom: "保留字段",
    username: "old-name",
  });
  ctx.profile = { ...PROFILE, username: "renamed_member", name: "新显示名" };
  const second = await ctx.login({ folderId: "new-folder" });
  assert.equal(second.asset.id, first.asset.id);
  assert.equal(second.asset.name, "我自定义的身份");
  assert.equal(second.asset.folderId, "custom-folder");
  assert.deepEqual(second.asset.tags, ["重要"]);
  const account = await ctx.vault.get(`account:${first.asset.id}`);
  assert.equal(account.username, "renamed_member");
  assert.equal(account.password, "existing-private-password");
  assert.equal(account.custom, "保留字段");
  assert.equal((await ctx.service.managedAssets()).length, 1);
  ctx.profile = { ...PROFILE, id: 202 };
  const third = await ctx.login();
  assert.notEqual(third.asset.id, first.asset.id);
  assert.equal((await ctx.service.managedAssets()).length, 2);
});

test("邮箱未开放时导入仍成功；不使用未验证 id_token 来补身份", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  ctx.profile = { sub: "issuer-subject", preferred_username: "test_member" };
  ctx.token.id_token = "forged.jwt.claims";
  const imported = await ctx.login();
  assert.equal(imported.account.profile.email, null);
  assert.equal(imported.account.profile.trustLevel, null);
  assert.equal(imported.account.profile.avatarUrl, null);
  assert.equal(imported.account.profile.subject, "issuer-subject");
  ctx.profile = { username: PROFILE.username };
  const session = await ctx.service.start();
  assert.equal(await ctx.callback(), 400);
  assert.match((await ctx.service.status(session.id)).error, /用户标识/);
  await assert.rejects(ctx.service.commit({ sessionId: session.id }), /失效/);
});

test("资料刷新拒绝替换为另一个用户，令牌过期时仅向 Connect 发刷新请求", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const imported = await ctx.login();
  const key = `identity-auth:${imported.asset.id}`;
  const original = await ctx.vault.get(key);
  await ctx.vault.set(key, {
    ...original,
    tokens: { ...original.tokens, expiresAt: Date.now() - 1000 },
  });
  ctx.token = { ...TOKEN, access_token: "renewed-access", refresh_token: "renewed-refresh" };
  ctx.profile = { ...PROFILE, trust_level: 4 };
  ctx.requests = [];
  const refreshed = await ctx.service.refresh(imported.asset.id);
  assert.equal(refreshed.profile.trustLevel, 4);
  assert.equal(ctx.requests.length, 2);
  const body = new URLSearchParams(ctx.requests[0].init.body);
  assert.equal(body.get("grant_type"), "refresh_token");
  assert.equal(body.get("refresh_token"), TOKEN.refresh_token);
  assert.equal(ctx.requests[1].init.headers.Authorization, "Bearer renewed-access");
  ctx.profile = { ...PROFILE, id: 999, email: "other@example.test" };
  await assert.rejects(ctx.service.refresh(imported.asset.id), /不同账号/);
  assert.equal((await ctx.service.get(imported.asset.id)).profile.subject, "101");
  assert.equal((await ctx.service.get(imported.asset.id)).profile.trustLevel, 4);
});

test("用户资料接口返回 401 时有 refresh token 才刷新一次，不无限重试", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const imported = await ctx.login();
  ctx.requests = [];
  let profiles = 0;
  ctx.respond = (url) =>
    url.pathname === "/api/user" && ++profiles === 1 ? json({ private: "raw-error" }, 401) : null;
  await ctx.service.refresh(imported.asset.id);
  assert.equal(profiles, 2);
  assert.equal(ctx.requests.filter((call) => call.url.pathname === "/oauth2/token").length, 1);
  ctx.respond = (url) => (url.pathname === "/api/user" ? json({}, 401) : null);
  ctx.requests = [];
  await assert.rejects(ctx.service.refresh(imported.asset.id), /授权/);
  assert.equal(ctx.requests.length, 3);
});

test("公开帖子纯文本摘要、固定站点链接、作者和类型过滤，不携带 Connect 令牌", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const imported = await ctx.login();
  ctx.posts = [
    action(1),
    action(2, { action_type: 5, post_number: 3 }),
    action(3, { username: "other_member" }),
    action(4, { action_type: 1 }),
    action(5, { action_type: 5 }),
    action(-1),
  ];
  ctx.requests = [];
  const loaded = await ctx.service.loadPosts(imported.asset.id);
  assert.equal(loaded.posts.status, "ready");
  assert.equal(loaded.posts.items.length, 2);
  assert.equal(loaded.posts.items[0].title, "主题 1");
  assert.equal(loaded.posts.items[0].url, "https://linux.do/t/topic/1/1");
  assert.equal(loaded.posts.items[1].kind, "reply");
  assert.doesNotMatch(loaded.posts.items[0].excerpt, /<|alert|untrusted/);
  assert.match(loaded.posts.items[0].excerpt, /正文 & 摘要/);
  assert.equal(loaded.posts.nextOffset, 6);
  assert.equal(loaded.posts.hasMore, false);
  assert.equal(ctx.requests[0].url.origin, "https://linux.do");
  assert.equal(ctx.requests[0].url.searchParams.get("filter"), "4,5");
  assert.equal(ctx.requests[0].init.headers.Authorization, undefined);
  assert.equal(ctx.requests[0].init.headers.Cookie, undefined);
});

test("帖子缓存不重复请求，更多按接口偏移追加去重，手动刷新替换首批", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const imported = await ctx.login();
  ctx.posts = Array.from({ length: 30 }, (_, i) => action(i + 1));
  ctx.requests = [];
  let loaded = await ctx.service.loadPosts(imported.asset.id);
  assert.equal(loaded.posts.hasMore, true);
  await ctx.service.loadPosts(imported.asset.id);
  assert.equal(ctx.requests.length, 1);
  ctx.posts = [action(30), action(31)];
  loaded = await ctx.service.loadPosts(imported.asset.id, { more: true });
  assert.equal(ctx.requests[1].url.searchParams.get("offset"), "30");
  assert.equal(loaded.posts.items.length, 31);
  assert.equal(loaded.posts.nextOffset, 32);
  assert.equal(loaded.posts.hasMore, false);
  await ctx.service.loadPosts(imported.asset.id, { more: true });
  assert.equal(ctx.requests.length, 2);
  ctx.posts = [action(100)];
  loaded = await ctx.service.loadPosts(imported.asset.id, { force: true });
  assert.equal(ctx.requests[2].url.searchParams.get("offset"), "0");
  assert.equal(loaded.posts.items.length, 1);
  assert.equal(loaded.posts.items[0].id, "100:1");
});

test("公开帖子最多 200 条，不再请求更多；错误保留缓存且不自动重试", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const imported = await ctx.login();
  ctx.respond = (url) => {
    if (url.pathname !== "/user_actions.json") return null;
    const offset = Number(url.searchParams.get("offset"));
    return json({ user_actions: Array.from({ length: 30 }, (_, i) => action(offset + i + 1)) });
  };
  let loaded;
  for (let i = 0; i < 7; i += 1)
    loaded = await ctx.service.loadPosts(imported.asset.id, { more: i > 0 });
  assert.equal(loaded.posts.items.length, 200);
  assert.equal(loaded.posts.hasMore, false);
  assert.equal(loaded.posts.nextOffset, 210);
  const requests = ctx.requests.length;
  await ctx.service.loadPosts(imported.asset.id, { more: true });
  assert.equal(ctx.requests.length, requests);
  for (const status of [403, 429]) {
    ctx.respond = (url) =>
      url.pathname === "/user_actions.json" ? json({ sensitive: "provider-error" }, status) : null;
    const failed = await ctx.service.loadPosts(imported.asset.id, { force: true });
    assert.equal(failed.posts.status, "unavailable");
    assert.match(failed.posts.message, new RegExp(String(status)));
    assert.doesNotMatch(failed.posts.message, /provider-error/);
    assert.equal(failed.posts.items.length, 200);
    const count = ctx.requests.length;
    await ctx.service.loadPosts(imported.asset.id);
    assert.equal(ctx.requests.length, count);
  }
  ctx.respond = () =>
    new Response("<html>challenge</html>", { headers: { "Content-Type": "text/html" } });
  const failed = await ctx.service.loadPosts(imported.asset.id, { force: true });
  assert.match(failed.posts.message, /验证页面/);
  assert.equal(failed.posts.items.length, 200);
});

test("HTTP 响应大小、无效 JSON 和非 Bearer 令牌均拒绝，不暴露敏感报错", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  for (const respond of [
    () =>
      new Response("x".repeat(1024 * 1024 + 1), {
        headers: { "Content-Type": "application/json" },
      }),
    () => new Response("private-invalid-json", { headers: { "Content-Type": "application/json" } }),
    () => json({ ...TOKEN, token_type: "malicious" }),
    () => {
      throw new Error("private-access-token provider full body");
    },
  ]) {
    ctx.respond = respond;
    const session = await ctx.service.start();
    assert.equal(await ctx.callback(), 400);
    const status = await ctx.service.status(session.id);
    assert.equal(status.status, "error");
    assert.doesNotMatch(status.error, /private-|malicious/);
  }
  assert.deepEqual(await ctx.vault.list(), ["identity-config:linuxdo"]);
});

test("断开只清本地令牌，资料和帖子可留存；删除后恢复扫描不复活身份", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const imported = await ctx.login();
  await ctx.service.loadPosts(imported.asset.id);
  const disconnected = await ctx.service.disconnect(imported.asset.id);
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.profile.username, PROFILE.username);
  assert.equal(disconnected.posts.items.length, 1);
  assert.equal((await ctx.vault.get(`identity-auth:${imported.asset.id}`)).tokens, null);
  assert.ok(await ctx.vault.get(`account:${imported.asset.id}`));
  await assert.rejects(ctx.service.refresh(imported.asset.id), /断开/);
  await ctx.service.loadPosts(imported.asset.id, { force: true });
  await ctx.service.remove(imported.asset.id);
  assert.equal(await ctx.service.get(imported.asset.id), null);
  assert.equal(await ctx.vault.get(`account:${imported.asset.id}`), null);
  assert.deepEqual(await ctx.service.managedAssets(), []);
});

test("锁库与帖子读取竞争不会把迟到响应写回；服务停止后释放 loopback", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const imported = await ctx.login();
  const entered = deferred(),
    released = deferred();
  ctx.respond = async (url) => {
    if (url.pathname === "/user_actions.json") {
      entered.resolve();
      await released.promise;
    }
  };
  const loading = ctx.service.loadPosts(imported.asset.id);
  await entered.promise;
  ctx.vault.lock();
  released.resolve();
  await assert.rejects(loading, /锁定/);
  await ctx.vault.unlock(MASTER);
  assert.equal((await ctx.service.get(imported.asset.id)).posts.status, "idle");
  await ctx.service.start();
  ctx.service.stop();
  await nextTurn();
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(ctx.port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => server.close(resolve));
});

test("等待授权与确认预览均在五分钟后过期，令牌不能继续提交", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const waiting = await ctx.service.start();
  t.mock.timers.tick(5 * 60_000 + 1);
  assert.equal((await ctx.service.status(waiting.id)).status, "error");
  await assert.rejects(ctx.service.commit({ sessionId: waiting.id }), /失效/);
  t.mock.timers.reset();
  await nextTurn();
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const { session } = await ctx.login({ previewOnly: true });
  t.mock.timers.tick(5 * 60_000 + 1);
  const expired = await ctx.service.status(session.id);
  assert.equal(expired.status, "error");
  assert.equal(expired.preview, undefined);
  await assert.rejects(ctx.service.commit({ sessionId: session.id }), /失效/);
  assert.deepEqual(await ctx.vault.list(), ["identity-config:linuxdo"]);
  t.mock.timers.reset();
});

test("并发确认仅导入一次；库在原子提交前锁定时两份账号均不写入", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const { session } = await ctx.login({ previewOnly: true });
  const results = await Promise.allSettled([
    ctx.service.commit({ sessionId: session.id }),
    ctx.service.commit({ sessionId: session.id }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await ctx.service.managedAssets()).length, 1);
  ctx.profile = { ...PROFILE, id: 202 };
  const second = await ctx.login({ previewOnly: true });
  const realBatch = ctx.vault.batch.bind(ctx.vault);
  ctx.vault.batch = (entries, options) => {
    if (entries.some((entry) => entry.id.startsWith("identity-auth:"))) ctx.vault.lock();
    return realBatch(entries, options);
  };
  await assert.rejects(ctx.service.commit({ sessionId: second.session.id }), /锁定/);
  await ctx.vault.unlock(MASTER);
  assert.equal((await ctx.vault.list()).length, 3);
  assert.equal((await ctx.service.managedAssets()).length, 1);
});

test("按需读取自己的帖子完整 raw 或 cooked 正文，绝不把摘要当正文", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const imported = await ctx.login();
  ctx.posts = [
    action(1, { post_id: 1001 }),
    action(2, { post_id: 1002, action_type: 5, post_number: 3 }),
  ];
  await ctx.service.loadPosts(imported.asset.id);
  ctx.respond = (url) => {
    if (url.pathname === "/posts/1001.json")
      return json({
        id: 1001,
        topic_id: 1,
        post_number: 1,
        user_id: 101,
        username: PROFILE.username,
        raw: "# 完整主题\n\n这里是远超摘要的完整正文。\n\n第二段正文。",
        excerpt: "无关摘要",
      });
    if (url.pathname === "/posts/1002.json")
      return json({
        id: 1002,
        topic_id: 2,
        post_number: 3,
        user_id: 101,
        username: PROFILE.username,
        cooked:
          "<h2>完整回复</h2><p>回复正文 <a href='https://example.test/reference'>参考</a></p><script>private-script</script>",
      });
    return null;
  };
  ctx.requests = [];
  const result = await ctx.service.readPosts(imported.asset.id, ["1:1", "2:3"]);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.errors, []);
  assert.match(result.items[0].content, /第二段正文/);
  assert.equal(result.items[0].format, "markdown");
  assert.equal(result.items[1].format, "text");
  assert.match(result.items[1].content, /回复正文/);
  assert.doesNotMatch(result.items[1].content, /<h2>|private-script/);
  assert.equal(ctx.requests.length, 2);
  assert.ok(
    ctx.requests.every(
      (entry) =>
        entry.url.origin === "https://linux.do" &&
        !entry.init.headers.Authorization &&
        !entry.init.headers.Cookie,
    ),
  );
  await ctx.service.readPosts(imported.asset.id, ["1:1", "2:3"]);
  assert.equal(ctx.requests.length, 2);
  assert.doesNotMatch(
    JSON.stringify(await ctx.service.get(imported.asset.id)),
    /第二段正文|postContents/,
  );
  assert.doesNotMatch(await readFile(ctx.file, "utf8"), /第二段正文/);
});

test("帖子正文按项报告限制或作者不符，成功项仍返回且失败不会自动重试", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const imported = await ctx.login();
  ctx.posts = Array.from({ length: 6 }, (_, i) => action(i + 1, { post_id: i + 1001 }));
  await ctx.service.loadPosts(imported.asset.id);
  ctx.respond = (url) => {
    const match = /^\/posts\/(\d+)\.json$/.exec(url.pathname);
    if (!match) return null;
    const id = Number(match[1]);
    const data = {
      id,
      topic_id: id - 1000,
      post_number: 1,
      user_id: 101,
      username: PROFILE.username,
      raw: "完整且合法的正文",
    };
    if (id === 1001) return json(data);
    if (id === 1002) return json({ error: "private-body" }, 403);
    if (id === 1003) return json({ ...data, username: "someone_else" });
    if (id === 1004) return json({ ...data, user_id: 999 });
    if (id === 1005) return json({ ...data, id: 999 });
    return json({ ...data, raw: undefined, excerpt: "只有摘要不能算作正文" });
  };
  ctx.requests = [];
  const result = await ctx.service.readPosts(
    imported.asset.id,
    ctx.posts.map((post) => `${post.topic_id}:1`),
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.errors.length, 5);
  assert.match(result.errors[0].message, /403/);
  assert.match(result.errors.at(-1).message, /完整正文/);
  assert.doesNotMatch(JSON.stringify(result), /private-body|只有摘要不能算作正文/);
  assert.equal(ctx.requests.length, 6);
  await ctx.service.readPosts(imported.asset.id, ["2:1"]);
  assert.equal(ctx.requests.length, 6);
  // 明确刷新公开列表后可重新尝试此前失败的正文，不丢弃成功的正文缓存。
  await ctx.service.loadPosts(imported.asset.id, { force: true });
  await ctx.service.readPosts(imported.asset.id, ["1:1", "2:1"]);
  assert.equal(ctx.requests.filter((entry) => entry.url.pathname.startsWith("/posts/")).length, 7);
});

test("正文读取不接受任意 URL、未加载 ID 或超过 20 篇；旧缓存缺编号给出明确失败", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const imported = await ctx.login();
  await ctx.service.loadPosts(imported.asset.id);
  ctx.requests = [];
  for (const ids of [[], ["https://evil.test"], ["999:1"], Array(21).fill("1:1"), [42]])
    await assert.rejects(ctx.service.readPosts(imported.asset.id, ids));
  const result = await ctx.service.readPosts(imported.asset.id, ["1:1"]);
  assert.deepEqual(result.items, []);
  assert.match(result.errors[0].message, /缺少帖子编号/);
  assert.equal(ctx.requests.length, 0);
});

test("正文读取最多并发两篇，锁库后迟到响应不能写入正文缓存", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const imported = await ctx.login();
  ctx.posts = [
    action(1, { post_id: 1001 }),
    action(2, { post_id: 1002 }),
    action(3, { post_id: 1003 }),
  ];
  await ctx.service.loadPosts(imported.asset.id);
  const entered = deferred(),
    release = deferred();
  let pending = 0;
  ctx.respond = async (url) => {
    if (!url.pathname.startsWith("/posts/")) return null;
    pending++;
    if (pending === 2) entered.resolve();
    await release.promise;
    const id = Number(url.pathname.match(/\d+/)[0]);
    return json({
      id,
      topic_id: id - 1000,
      post_number: 1,
      user_id: 101,
      username: PROFILE.username,
      raw: "迟到的完整正文",
    });
  };
  const reading = ctx.service.readPosts(imported.asset.id, ["1:1", "2:1", "3:1"]);
  await entered.promise;
  assert.equal(pending, 2);
  ctx.vault.lock();
  release.resolve();
  await assert.rejects(reading, /锁定/);
  await ctx.vault.unlock(MASTER);
  assert.equal((await ctx.vault.get(`identity-auth:${imported.asset.id}`)).postContents, undefined);
  assert.equal(pending, 2);
});

test("身份删除一次原子清理授权、账号及验证码，落盘失败时三者全保留", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const imported = await ctx.login();
  await ctx.vault.set(`totp:${imported.asset.id}`, { secret: "encrypted-totp-fixture" });
  const before = await ctx.vault.readAll();
  const backup = join(ctx.directory, "identity-before-delete.enc");
  await rename(ctx.file, backup);
  await mkdir(ctx.file);
  await assert.rejects(ctx.service.remove(imported.asset.id), /删除失败/);
  assert.deepEqual(await ctx.vault.readAll(), before);
  assert.equal((await ctx.service.managedAssets()).length, 1);
  await rm(ctx.file, { recursive: true });
  await rename(backup, ctx.file);
  const reopened = new Vault(ctx.file);
  await reopened.unlock(MASTER);
  assert.deepEqual(await reopened.readAll(), before);
  reopened.lock();
  await ctx.service.remove(imported.asset.id);
  assert.deepEqual(await ctx.vault.list(), ["identity-config:linuxdo"]);
});

test("资料刷新或重复确认等待提交时保存的新密码和备注均保留", async (t) => {
  const ctx = await fixture(t);
  await ctx.configure();
  const imported = await ctx.login();
  const key = `account:${imported.asset.id}`;
  const originalBatch = ctx.vault.batch.bind(ctx.vault);
  for (const mode of ["refresh", "commit"]) {
    await ctx.vault.set(key, { username: "old", password: "password-A", note: "note-A" });
    const preview = mode === "commit" ? await ctx.login({ previewOnly: true }) : null;
    const entered = deferred(),
      release = deferred();
    ctx.vault.batch = async (entries, options) => {
      if (entries.some((entry) => entry.id === key)) {
        entered.resolve();
        await release.promise;
      }
      return originalBatch(entries, options);
    };
    const syncing =
      mode === "refresh"
        ? ctx.service.refresh(imported.asset.id)
        : ctx.service.commit({ sessionId: preview.session.id });
    await entered.promise;
    await ctx.vault.set(key, {
      username: "new-local",
      password: "password-B",
      note: "note-B",
      custom: "new-custom",
      _browserAsset: { id: imported.asset.id, name: "用户编辑的恢复入口" },
    });
    release.resolve();
    await syncing;
    const saved = await ctx.vault.get(key);
    assert.equal(saved.password, "password-B", mode);
    assert.equal(saved.note, "note-B", mode);
    assert.equal(saved.custom, "new-custom", mode);
    assert.equal(saved._browserAsset.name, "用户编辑的恢复入口", mode);
    assert.equal(saved.username, PROFILE.username, mode);
    ctx.vault.batch = originalBatch;
  }
});
