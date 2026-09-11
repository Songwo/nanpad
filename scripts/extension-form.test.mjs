import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { collectLoginForms } from "../browser-extension/form-capture.mjs";

const submitCaptureSource = readFileSync(
  new URL("../browser-extension/submit-capture.mjs", import.meta.url),
  "utf8",
);

let browser;
before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.NANPAD_EXTENSION_BROWSER_PATH
      ? { executablePath: process.env.NANPAD_EXTENSION_BROWSER_PATH }
      : {}),
  });
});
after(async () => {
  await browser?.close();
});
async function collect(html, prepare) {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    if (prepare) await page.evaluate(prepare);
    return await page.evaluate(collectLoginForms);
  } finally {
    await page.close();
  }
}

test("读取可见表单，保留密码空格，不读取隐藏、禁用及验证码字段", async () => {
  const result = await collect(
    `<form><input autocomplete="username" value=" alice@example.test "><input type="password" value=" actual password "><input autocomplete="one-time-code" type="password" value="654321"><input name="otp" type="password" value="123456"></form><form hidden><input value="hidden"><input type="password" value="secret"></form><div style="opacity:0"><input type="password" value="invisible"></div><input type="password" disabled value="disabled">`,
  );
  assert.deepEqual(result, [
    { username: "alice@example.test", password: " actual password ", kind: "login" },
  ]);
});
test("同页多个登录表单保留账号对应关系，注册确认密码去重", async () => {
  const result = await collect(
    `<form><input type="email" value="work@example.test"><input type="password" value="work-password"></form><form><input autocomplete="username" value="personal"><input type="password" autocomplete="new-password" value="new-password"><input name="confirm-password" type="password" autocomplete="new-password" value="new-password"></form>`,
  );
  assert.deepEqual(result, [
    { username: "work@example.test", password: "work-password", kind: "login" },
    { username: "personal", password: "new-password", kind: "new" },
  ]);
});
test("没有form的连续登录区仍匹配邻近账号", async () => {
  const result = await collect(
    `<input name="username" value="first"><input type="password" value="one"><input name="username" value="second"><input type="password" value="two">`,
  );
  assert.deepEqual(
    result.map(({ username, password }) => [username, password]),
    [
      ["first", "one"],
      ["second", "two"],
    ],
  );
});
test("读取开放 Shadow DOM，但不读取任何 iframe 或隐藏 shadow 宿主", async () => {
  const result = await collect(
    `<div id="open"></div><div id="hidden" hidden></div><iframe srcdoc="<input type='password' value='frame-secret'>"></iframe>`,
    () => {
      document.querySelector("#open").attachShadow({ mode: "open" }).innerHTML =
        '<input autocomplete="username" value="shadow-user"><input type="password" value="shadow-password">';
      document.querySelector("#hidden").attachShadow({ mode: "open" }).innerHTML =
        '<input type="password" value="hidden-shadow">';
    },
  );
  assert.deepEqual(result, [
    { username: "shadow-user", password: "shadow-password", kind: "login" },
  ]);
});
test("分步登录可读取明确账号，搜索和验证码不能当账号", async () => {
  assert.deepEqual(
    await collect(
      '<input name="search" value="query"><input autocomplete="one-time-code" value="123456"><input autocomplete="username" value="step-user">',
    ),
    [{ username: "step-user", password: "", kind: "account" }],
  );
});
test("超过长度限制的密码留空并标记，不能截断保存错误密码", async () => {
  const result = await collect(
    '<form><input autocomplete="username" value="long-user"><input type="password"></form>',
    () => {
      document.querySelector('input[type="password"]').value = "a".repeat(4097);
    },
  );
  assert.deepEqual(result, [
    { username: "long-user", password: "", kind: "login", oversized: true },
  ]);
});

// —— 自动采集（submit-capture.mjs 内容脚本）——
// 真实 HTTP 页面上执行脚本源码，用桩替换 chrome.*，验证提交瞬间的采集行为。
// `stored` 模拟 chrome.storage.local 中的开关值：undefined = 从未设置（默认开启）。
async function withAutoCapture(t, html, stored) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(url);
  await page.evaluate((saved) => {
    window.__messages = [];
    window.__changedListeners = [];
    globalThis.chrome = {
      storage: {
        local: {
          get: async () =>
            saved === undefined ? {} : { nanpadAutoCapture: saved },
        },
        onChanged: { addListener: (fn) => window.__changedListeners.push(fn) },
      },
      runtime: {
        sendMessage: async (message) => {
          window.__messages.push(message);
          return { ok: true };
        },
      },
    };
  }, stored);
  await page.evaluate(submitCaptureSource);
  // 内容脚本的开关读取是异步的，等它完成再触发提交。
  await page.waitForTimeout(60);
  return { page, url };
}
async function submitForm(page, selector) {
  await page.evaluate(
    (formSelector) => {
      document.querySelector(formSelector).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    },
    selector,
  );
  await page.waitForTimeout(150);
  return page.evaluate(() => window.__messages);
}
async function clickButton(page, selector) {
  await page.evaluate(
    (buttonSelector) => {
      document.querySelector(buttonSelector).click();
    },
    selector,
  );
  await page.waitForTimeout(150);
  return page.evaluate(() => window.__messages);
}

test("自动采集默认开启：提交含密码表单时读取账号密码并发送到后台", async (t) => {
  const { page, url } = await withAutoCapture(
    t,
    `<title>示例站</title><form><input name="user" value="alice@example.test"><input type="password" value="pw1"></form>`,
    undefined,
  );
  assert.deepEqual(await submitForm(page, "form"), [
    {
      type: "nanpad-auto-capture",
      capture: {
        url: `${new URL(url).origin}/`,
        title: "示例站",
        username: "alice@example.test",
        password: "pw1",
      },
    },
  ]);
});
test("显式关闭开关后不监听任何提交", async (t) => {
  const { page } = await withAutoCapture(
    t,
    `<form><input value="u"><input type="password" value="p"></form>`,
    false,
  );
  assert.deepEqual(await submitForm(page, "form"), []);
});
test("无密码与验证码表单不采集，关闭开关即时生效", async (t) => {
  const { page, url } = await withAutoCapture(
    t,
    `<form id="no-pw"><input value="u"></form><form id="otp"><input value="u"><input name="otp" type="password" value="123"></form><form id="login"><input autocomplete="username" value="real"><input type="password" value="pw"></form>`,
    undefined,
  );
  assert.deepEqual(await submitForm(page, "#login"), [
    {
      type: "nanpad-auto-capture",
      capture: { url: `${new URL(url).origin}/`, title: "", username: "real", password: "pw" },
    },
  ]);
  // 模拟在弹窗中关闭开关：storage 变化通知内容脚本。
  await page.evaluate(() =>
    window.__changedListeners.forEach((fn) =>
      fn({ nanpadAutoCapture: { newValue: false } }, "local"),
    ),
  );
  await page.evaluate(() => {
    window.__messages.length = 0;
  });
  assert.deepEqual(await submitForm(page, "#login"), []);
  await submitForm(page, "#no-pw");
  await submitForm(page, "#otp");
  assert.equal(await page.evaluate(() => window.__messages.length), 0);
});
test("无表单的脚本登录：点击登录按钮捕获就近的账号密码", async (t) => {
  const { page, url } = await withAutoCapture(
    t,
    `<title>脚本站</title><div id="box"><input name="account" value="spa-user"><input type="password" value="spa-pass"><button type="button" id="go">登录</button></div>`,
    undefined,
  );
  assert.deepEqual(await clickButton(page, "#go"), [
    {
      type: "nanpad-auto-capture",
      capture: {
        url: `${new URL(url).origin}/`,
        title: "脚本站",
        username: "spa-user",
        password: "spa-pass",
      },
    },
  ]);
  // 连点去重：同一账号密码只发送一次。
  await clickButton(page, "#go");
  assert.equal(await page.evaluate(() => window.__messages.length), 1);
});
test("自动采集在页面角落给出结果提示", async (t) => {
  const { page } = await withAutoCapture(
    t,
    `<form><input value="u"><input type="password" value="p"></form>`,
    undefined,
  );
  await submitForm(page, "form");
  assert.ok(
    await page.evaluate(() =>
      [...document.documentElement.children].some(
        (el) => el.tagName === "DIV" && el.style.position === "fixed",
      ),
    ),
  );
});
