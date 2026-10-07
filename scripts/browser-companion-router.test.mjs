import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompanionRouter } from "../browser-extension/companion-router.mjs";

function setup() {
  const id = "a".repeat(32);
  let url = "https://accounts.example.test/login",
    clock = 1000,
    token = "fixture-token";
  const requests = [],
    deliveries = [],
    timers = new Set();
  let responseHook = () => {};
  const chrome = {
    runtime: { id, getURL: (path) => `chrome-extension://${id}/${path}` },
    storage: {
      session: {
        get: async () => ({ nanpadConnectionToken: token }),
        remove: async () => {
          token = "";
        },
      },
      local: { get: async () => ({}) },
    },
    tabs: {
      get: async () => ({ id: 3, url }),
      sendMessage: async (_id, message, options) => {
        deliveries.push({ message: structuredClone(message), options });
        if (message.type === "zhiyu-page-ready") return { ready: true, documentKey: "doc-key" };
        if (message.type === "zhiyu-page-document")
          return { ok: true, title: "示例文档", text: "正文", partial: true };
        return { ok: true };
      },
    },
  };
  const router = createCompanionRouter({
    chrome,
    bridge: "http://127.0.0.1:1",
    now: () => clock,
    schedule: (fn) => {
      timers.add(fn);
      return fn;
    },
    cancel: (fn) => timers.delete(fn),
    fetchImpl: async (target, options) => {
      const path = new URL(target).pathname;
      requests.push({ path, body: JSON.parse(options.body) });
      await responseHook(path);
      const data = path.endsWith("/list")
        ? {
            accounts: [
              { id: "work", title: "工作", username: "alice" },
              { id: "personal", title: "个人", username: "bob" },
            ],
            selectionToken: "fixture-selection",
          }
        : path.endsWith("/fill")
          ? { username: "alice", password: "fixture-secret" }
          : { id: "new-record", status: "new" };
      return { ok: true, status: 200, json: async () => data };
    },
  });
  const sender = { id, frameId: 0, documentId: "document-one", tab: { id: 3 }, url };
  return {
    router,
    sender,
    requests,
    deliveries,
    expireTimers: () => {
      for (const fn of [...timers]) fn();
    },
    clearToken: () => {
      token = "";
    },
    setUrl: (next) => {
      url = next;
    },
    advance: () => {
      clock += 121000;
    },
    hook: (fn) => {
      responseHook = fn;
    },
  };
}
test("候选保留同站多账号且不返回密码，选择后一次性填入指定文档", async () => {
  const f = setup();
  const listed = await f.router.handle({ type: "zhiyu-list", url: "https://evil.test" }, f.sender);
  assert.equal(listed.accounts.length, 2);
  assert.ok(!JSON.stringify(listed).includes("fixture-secret"));
  assert.deepEqual(f.requests[0].body, { url: "https://accounts.example.test/" });
  assert.deepEqual(await f.router.handle({ type: "zhiyu-fill", id: "work" }, f.sender), {
    ok: true,
  });
  assert.equal(f.deliveries[1].message.credential.password, "fixture-secret");
  assert.deepEqual(f.deliveries[1].options, { documentId: "document-one" });
  assert.equal(
    (await f.router.handle({ type: "zhiyu-fill", id: "work" }, f.sender)).reason,
    "expired",
  );
});
test("带自身 documentId 的扩展弹窗把填写与文档请求发往目标顶层 frame", async () => {
  const f = setup();
  const popup = {
    id: f.sender.id,
    documentId: "popup-document",
    frameId: 0,
    tab: { id: 8 },
    url: `chrome-extension://${f.sender.id}/popup.html`,
  };
  assert.equal((await f.router.handle({ type: "zhiyu-list", tabId: 3 }, popup)).ok, true);
  assert.equal(
    (await f.router.handle({ type: "zhiyu-fill", tabId: 3, id: "work" }, popup)).ok,
    true,
  );
  assert.equal((await f.router.handle({ type: "zhiyu-document", tabId: 3 }, popup)).ok, true);
  assert.ok(f.deliveries.every((item) => item.options.frameId === 0 && !item.options.documentId));
});
test("即使无后续访问，定时器仍主动清除账号；未配对不暂存", async () => {
  const f = setup(),
    capture = { username: "u", password: "p" };
  await f.router.handle({ type: "zhiyu-stage", capture }, f.sender);
  f.expireTimers();
  assert.equal((await f.router.handle({ type: "zhiyu-pending" }, f.sender)).pending, null);
  f.clearToken();
  assert.equal(
    (await f.router.handle({ type: "zhiyu-stage", capture }, f.sender)).reason,
    "unpaired",
  );
});
test("跨扩展、iframe、伪造网址和旧文档均不能读取账号", async () => {
  for (const override of [
    { id: "b".repeat(32) },
    { frameId: 1 },
    { url: "https://evil.test/" },
    { documentId: undefined },
  ]) {
    const f = setup();
    assert.equal(
      (await f.router.handle({ type: "zhiyu-list" }, { ...f.sender, ...override })).ok,
      false,
    );
    assert.equal(f.requests.length, 0);
  }
});
test("列表后切换导航、请求途中导航、票据过期都不会把密码交给页面", async () => {
  for (const scenario of ["before", "during", "expired", "document"]) {
    const f = setup();
    await f.router.handle({ type: "zhiyu-list" }, f.sender);
    if (scenario === "before") f.router.invalidate(3);
    if (scenario === "expired") f.advance();
    if (scenario === "during")
      f.hook((path) => {
        if (path.endsWith("/fill")) f.router.invalidate(3);
      });
    const reply = await f.router.handle(
      { type: "zhiyu-fill", id: "work" },
      scenario === "document" ? { ...f.sender, documentId: "new-document" } : f.sender,
    );
    assert.equal(reply.ok, false, scenario);
    assert.equal(
      f.deliveries.filter((item) => item.message.type === "zhiyu-page-fill").length,
      0,
      scenario,
    );
  }
});
test("不在候选中的 ID 和非 HTTPS 网站被拒绝", async () => {
  const f = setup();
  await f.router.handle({ type: "zhiyu-list" }, f.sender);
  assert.equal(
    (await f.router.handle({ type: "zhiyu-fill", id: "stolen-id" }, f.sender)).ok,
    false,
  );
  f.setUrl("http://example.test/");
  assert.equal(
    (await f.router.handle({ type: "zhiyu-list" }, { ...f.sender, url: "http://example.test/" }))
      .reason,
    "insecure",
  );
  assert.equal(f.requests.length, 1);
});
test("提交仅内存暂存，跨站不展示，确认才写入且密码不出待确认摘要", async () => {
  const f = setup();
  const capture = {
    username: "alice",
    password: "private",
    title: "登录",
    url: "https://evil.test/",
  };
  assert.equal((await f.router.handle({ type: "zhiyu-stage", capture }, f.sender)).ok, true);
  assert.equal(f.requests.length, 0);
  const pending = await f.router.handle({ type: "zhiyu-pending" }, f.sender);
  assert.equal(pending.pending.username, "alice");
  assert.ok(!JSON.stringify(pending).includes("private"));
  f.setUrl("https://other.test/");
  assert.equal(
    (await f.router.handle({ type: "zhiyu-pending" }, { ...f.sender, url: "https://other.test/" }))
      .pending,
    null,
  );
  f.setUrl(f.sender.url);
  assert.equal((await f.router.handle({ type: "zhiyu-save-pending" }, f.sender)).ok, true);
  assert.deepEqual(f.requests[0].body, {
    username: "alice",
    password: "private",
    title: "登录",
    url: "https://accounts.example.test/",
  });
  assert.equal((await f.router.handle({ type: "zhiyu-pending" }, f.sender)).pending, null);
});
test("超长秘密不截断；过期与断开连接清除临时账号", async () => {
  const f = setup();
  assert.equal(
    (
      await f.router.handle(
        { type: "zhiyu-stage", capture: { username: "u", password: "a".repeat(4097) } },
        f.sender,
      )
    ).reason,
    "invalid",
  );
  await f.router.handle(
    { type: "zhiyu-stage", capture: { username: "u", password: "p" } },
    f.sender,
  );
  f.advance();
  assert.equal((await f.router.handle({ type: "zhiyu-save-pending" }, f.sender)).reason, "expired");
  await f.router.handle(
    { type: "zhiyu-stage", capture: { username: "u", password: "p" } },
    f.sender,
  );
  f.router.clear();
  assert.equal((await f.router.handle({ type: "zhiyu-pending" }, f.sender)).pending, null);
});
test("文档从实际目标页面读取，锚点去除而微信文章定位参数交给桌面端清理", async () => {
  const f = setup();
  const url = "https://docs.example.test/doc/123?token=private#secret";
  f.setUrl(url);
  const reply = await f.router.handle(
    { type: "zhiyu-document", text: "fake", url: "https://evil.test/" },
    { ...f.sender, url },
  );
  assert.equal(reply.ok, true);
  assert.deepEqual(f.requests[0].body, {
    url: "https://docs.example.test/doc/123?token=private",
    title: "示例文档",
    text: "正文",
  });
  for (const mid of ["123", "456"]) {
    const article = `https://mp.weixin.qq.com/s?__biz=example&mid=${mid}&idx=1&sn=signature`;
    f.setUrl(article);
    assert.equal(
      (await f.router.handle({ type: "zhiyu-document" }, { ...f.sender, url: article })).ok,
      true,
    );
  }
  assert.notEqual(f.requests[1].body.url, f.requests[2].body.url);
});
