import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { chromium } from "playwright";
import { collectLoginForms } from "../browser-extension/form-capture.mjs";

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
