import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// 隔离浏览器存储：验证原始源码保存、重开、GFM阅读及转换确认。
const origin = new URL(process.env.NANPAD_QA_URL ?? "http://127.0.0.1:8080").origin;
const browser = await chromium.launch({ headless: true });
const errors = [];
const checks = [];
const source =
  "# Markdown 原文\r\n\r\n| 项目 | 状态 |\r\n| --- | --- |\r\n| 知屿 | 正常 |\r\n\r\n- [x] 已完成\r\n\r\n#### 四级标题\r\n\r\n正文[^1]\r\n\r\n[^1]: 脚注原文\r\n";
await mkdir("release/screenshots", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.fulfill({ status: 204, body: "" }),
  );
  await context.route(`${origin}/__ui-regression/markdown-source`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN"><head><link rel="stylesheet" href="/src/styles.css"></head><body><main id="root" style="height:100dvh"></main></body></html>',
    }),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  async function mount(seed) {
    await page.goto(`${origin}/__ui-regression/markdown-source`);
    await page.evaluate(
      async ({ seed, source }) => {
        const RefreshRuntime = (await import("/@react-refresh")).default;
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        const React = (await import("/node_modules/.vite/deps/react.js")).default;
        const ReactDOM = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
        const { DocumentsWorkspace } = await import("/src/components/documents-workspace.tsx");
        const { setLocale } = await import("/src/lib/i18n.ts");
        setLocale("zh");
        const entries = performance.getEntriesByType("resource");
        const entry = entries.find((item) => item.name.includes("/src/lib/documents.ts"));
        const { useDocuments } = await import(entry.name);
        if (seed) {
          for (const [id, title, markdown] of [
            ["doc-source-one", "源码回归", source],
            ["doc-source-two", "另一篇", "# 第二篇\n\n本地样本"],
          ]) {
            localStorage.setItem(
              "nanpad-doc:" + id,
              JSON.stringify({
                id,
                title,
                markdown,
                content: { type: "doc", content: [{ type: "paragraph" }] },
                bindings: [],
                createdAt: "2026-10-08T00:00:00.000Z",
                updatedAt: "2026-10-08T00:00:00.000Z",
              }),
            );
          }
        }
        await useDocuments.getState().load(true);
        await useDocuments.getState().open("doc-source-one");
        window.__docs = useDocuments;
        ReactDOM.createRoot(document.getElementById("root")).render(
          React.createElement(DocumentsWorkspace),
        );
      },
      { seed, source },
    );
  }
  await mount(true);
  await page.getByRole("region", { name: "文档正文", exact: true }).locator("table").waitFor();
  assert.equal(await page.locator(".document-markdown h4").innerText(), "四级标题");
  await page.getByRole("button", { name: "目录", exact: false }).click();
  await page.getByRole("button", { name: /四级标题/ }).click();
  checks.push("GFM 表格与四级标题可读，目录定位实际 Markdown 标题");
  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  // HTML textarea 的展示换行由浏览器规范化，未编辑时持久化原文不受影响。
  assert.equal(await input.inputValue(), source.replaceAll("\r\n", "\n"));
  const edited = source.replaceAll("\r\n", "\n").replace("| 知屿 | 正常 |", "| 知屿 | 已更新 |");
  await input.fill(edited);
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page.getByRole("cell", { name: "已更新", exact: true }).waitFor();
  await page.getByRole("textbox", { name: "文档标题", exact: true }).fill("源码改名");
  await page.locator(".document-list-item").filter({ hasText: "另一篇" }).click();
  await page.locator(".document-list-item").filter({ hasText: "源码改名" }).click();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("nanpad-doc:doc-source-one")).markdown,
    ),
    edited,
  );
  checks.push("源码编辑与预览同步；改标题和切文档触发保存并保留 Markdown");
  await mount(false);
  await page.getByRole("cell", { name: "已更新", exact: true }).waitFor();
  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  assert.equal(
    await page.getByRole("textbox", { name: "Markdown 源码", exact: true }).inputValue(),
    edited,
  );
  await page.getByRole("button", { name: "富文本", exact: true }).click();
  await page.getByRole("alertdialog").waitFor();
  await page.getByRole("button", { name: "保留 Markdown", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__docs.getState().drafts["doc-source-one"].markdown),
    edited,
  );
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page.screenshot({
    path: "release/screenshots/document-markdown-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "release/screenshots/document-markdown-mobile.png",
    fullPage: true,
  });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  checks.push("重新打开后保留源码；有损转换明确确认；390px 无横向溢出");
  await page.getByRole("button", { name: "富文本", exact: true }).click();
  await page.getByRole("button", { name: "确认转换", exact: true }).click();
  await page.getByRole("textbox", { name: "文档正文", exact: true }).waitFor();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => "markdown" in JSON.parse(localStorage.getItem("nanpad-doc:doc-source-one")),
    ),
    false,
  );
  checks.push("明确确认后转为富文本并正确保存");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks, errors }, null, 2));
} finally {
  await browser.close();
}
