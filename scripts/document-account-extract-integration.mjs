import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const origin = new URL(process.env.NANPAD_QA_URL ?? "http://127.0.0.1:8080").origin;
const browser = await chromium.launch({ headless: true });
const errors = [];
const checks = [];
await mkdir("release/screenshots", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 850 },
    locale: "zh-CN",
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.fulfill({ status: 204, body: "" }),
  );
  await context.route(`${origin}/__ui-regression/document-account-extract`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN"><head><link rel="stylesheet" href="/src/styles.css"></head><body><main id="root"></main></body></html>',
    }),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/__ui-regression/document-account-extract`);
  await page.evaluate(async () => {
    window.__commits = [];
    window.__cancelled = [];
    window.__locked = false;
    window.sinan = {
      store: { load: async () => null, save: async () => {} },
      onVaultChanged: () => () => {},
      vault: { status: async () => ({ exists: true, unlocked: !window.__locked }) },
      documentAccounts: {
        preview: async () => {
          if (window.__delay)
            await new Promise((resolve) => {
              window.__release = resolve;
            });
          return {
            ticket: "preview-ticket",
            documentTitle: "合成账号样本",
            warnings: [],
            candidates: [
              {
                id: "one",
                name: "演示账号",
                url: "https://example.test/login",
                username: "demo@example.test",
                password: "synthetic-password",
                note: "仅用于测试",
              },
              {
                id: "two",
                name: "第二账号",
                url: "https://example.test/login",
                username: "second@example.test",
                password: "second-synthetic",
                note: "",
              },
            ],
          };
        },
        cancel: async (ticket) => {
          window.__cancelled.push(ticket);
        },
        commit: async (value) => {
          window.__commits.push(value);
          return {
            assets: value.candidates.map((item) => ({
              id: "s-" + item.id,
              name: item.name,
              kind: "account",
              status: "online",
              hint: item.username,
              tags: [],
            })),
            added: value.candidates.length,
            existing: 0,
            documentId: "doc-extract-test",
          };
        },
      },
    };
    const RefreshRuntime = (await import("/@react-refresh")).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const ReactDOM = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { DocumentAccountExtract } = await import("/src/components/document-account-extract.tsx");
    const entry = performance
      .getEntriesByType("resource")
      .find((item) => item.name.includes("/src/lib/vault-state.ts"));
    const { useVault } = await import(entry.name);
    window.__vault = useVault;
    useVault.setState({ checked: true, unlocked: true, exists: true });
    window.__mountExtract = () => {
      window.__testRoot = ReactDOM.createRoot(document.getElementById("root"));
      window.__testRoot.render(
        React.createElement(DocumentAccountExtract, {
          documentId: "doc-extract-test",
          close: () => window.__testRoot.unmount(),
        }),
      );
    };
    window.__mountExtract();
  });
  const password = page.getByRole("textbox", { name: "账号 1 密码", exact: true });
  await page.getByLabel("账号 1 密码", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("账号 1 密码", { exact: true }).getAttribute("type"),
    "password",
  );
  assert.equal(await page.evaluate(() => window.__commits.length), 0);
  await page.getByLabel("账号 1 名称", { exact: true }).fill("修改后的样本名称");
  await page.getByLabel("选择待导入账号 2", { exact: true }).uncheck();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "release/screenshots/document-account-extract-mobile.png",
    fullPage: true,
  });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole("button", { name: "保存并关联 1 项账号", exact: true }).click();
  await page.getByText("新增 1 项账号，复用 0 项已有账号。", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__commits[0].candidates.length), 1);
  assert.equal(
    await page.evaluate(() => window.__commits[0].candidates[0].name),
    "修改后的样本名称",
  );
  assert.equal(await password.count(), 0);
  checks.push("密码默认遮罩，支持编辑与勾选；确认前零写入，成功后清空密码预览，390px无溢出");
  await page.getByRole("button", { name: "关闭", exact: true }).last().click();
  await page.evaluate(() => {
    window.__delay = true;
    window.__mountExtract();
  });
  await page.getByText("正在本机解析文档…", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.__locked = true;
    window.__vault.setState({ unlocked: false });
    window.__release();
  });
  await page.getByText("解锁密钥库后可解析并保存文档中的账号。", { exact: true }).waitFor();
  await page.waitForFunction(() => window.__cancelled.includes("preview-ticket"));
  assert.equal(await page.getByLabel("账号 1 密码", { exact: true }).count(), 0);
  checks.push("锁库立即清空预览；延迟返回的会话被取消，密码不会重新出现");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks, errors }, null, 2));
} finally {
  await browser.close();
}
