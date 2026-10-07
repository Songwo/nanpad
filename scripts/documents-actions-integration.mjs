import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// 仅挂载真实组件，所有文档与保存、删除故障都使用隔离样本。
const origin = new URL(process.env.NANPAD_QA_URL ?? "http://127.0.0.1:8080").origin;
const browser = await chromium.launch({ headless: true });
const checks = [];
const pageErrors = [];
await mkdir("release/screenshots", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || url.protocol === "data:"
      ? route.continue()
      : route.fulfill({ status: 204, body: "" });
  });
  await page.route(`${origin}/__ui-regression/document-actions`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN"><head><link rel="stylesheet" href="/src/styles.css"></head><body><main id="document-test-root" style="height:100dvh"></main></body></html>',
    }),
  );
  await page.goto(`${origin}/__ui-regression/document-actions`);
  await page.evaluate(async () => {
    window.__savedDocuments = {};
    window.__removeCalls = [];
    window.__saveCalls = [];
    window.sinan = {
      documents: {
        list: async () => Object.values(window.__savedDocuments).map(window.__summary),
        get: async (id) => structuredClone(window.__savedDocuments[id]),
        save: async (doc) => {
          window.__saveCalls.push(doc.id);
          if (window.__saveFails === doc.id) throw new Error("隔离回归：保存失败");
          const saved = { ...structuredClone(doc), updatedAt: new Date().toISOString() };
          window.__savedDocuments[doc.id] = saved;
          return structuredClone(saved);
        },
        remove: async (id) => {
          window.__removeCalls.push(id);
          if (window.__holdRemove) {
            window.__holdRemove = false;
            await new Promise((resolve) => {
              window.__releaseRemove = resolve;
            });
          }
          if (window.__removeFails === id) throw new Error("隔离回归：删除失败");
          delete window.__savedDocuments[id];
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
    const { DocumentsWorkspace } = await import("/src/components/documents-workspace.tsx");
    const entry = performance
      .getEntriesByType("resource")
      .find((item) => item.name.includes("/src/lib/documents.ts"));
    const { useDocuments, summary } = await import(entry.name);
    window.__documentStore = useDocuments;
    window.__summary = summary;
    const now = "2026-10-06T00:00:00.000Z";
    for (const [id, title] of [
      ["doc-actions-one", "当前编辑文档"],
      ["doc-actions-two", "右键目标文档"],
      ["doc-actions-three", "键盘打开文档"],
      ["doc-actions-four", "触屏删除文档"],
    ]) {
      window.__savedDocuments[id] = {
        id,
        title,
        bindings: [],
        createdAt: now,
        updatedAt: now,
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: `${title}的隔离正文` }] }],
        },
      };
    }
    await useDocuments.getState().open("doc-actions-one");
    const { Toaster } = await import("/node_modules/.vite/deps/sonner.js");
    ReactDOM.createRoot(document.getElementById("document-test-root")).render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(DocumentsWorkspace),
        React.createElement(Toaster),
      ),
    );
  });
  const row = (name) => page.locator(".document-list-item").filter({ hasText: name });
  const menu = page.getByRole("menu");
  const dialog = page.getByRole("alertdialog");
  const selected = () => page.evaluate(() => window.__documentStore.getState().selected);
  const reader = page.getByRole("region", { name: "文档正文", exact: true });
  // 确认框会隔离背景的可访问性树，这里仍要检查其后的草稿是否被保留。
  const title = page.getByRole("textbox", { name: "文档标题", exact: true, includeHidden: true });
  await reader.waitFor();
  await row("右键目标文档").click({ button: "right" });
  await menu.waitFor();
  assert.equal(await selected(), "doc-actions-one");
  assert.equal(await menu.getAttribute("aria-label"), "文档操作：右键目标文档");
  await page.screenshot({ path: "release/screenshots/document-actions-desktop.png" });
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.equal(await row("右键目标文档").evaluate((el) => document.activeElement === el), true);
  checks.push("右键菜单绑定点击目标且不切换当前文档，Escape 恢复列表焦点");

  await row("右键目标文档").press("Shift+F10");
  await menu.getByRole("menuitem", { name: "删除文档", exact: true }).click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /删除「右键目标文档」？/);
  assert.equal(
    await dialog
      .getByRole("button", { name: "取消", exact: true })
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => window.__removeCalls), []);
  assert.equal(await row("右键目标文档").evaluate((el) => document.activeElement === el), true);
  checks.push("Shift+F10 打开菜单、确认文件名、默认焦点为取消且取消不删除");

  await row("右键目标文档").click({ button: "right" });
  await page.getByRole("textbox", { name: "搜索文档", exact: true }).click();
  await menu.waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("textbox", { name: "搜索文档", exact: true })
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await page.getByRole("button", { name: "文档操作：键盘打开文档", exact: true }).focus();
  await page.keyboard.press("Enter");
  await menu.waitFor();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "键盘打开文档", exact: true }).waitFor();
  assert.equal(await selected(), "doc-actions-three");
  assert.equal(await title.count(), 0);
  checks.push("外点关闭保留所点控件焦点，更多按钮支持键盘打开指定文档");

  await row("当前编辑文档").click();
  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  await page.evaluate(() => {
    window.__saveFails = "doc-actions-one";
  });
  await title.fill("保存失败仍保留的当前草稿");
  await row("键盘打开文档").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "打开文档", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "隔离回归：保存失败" }).first().waitFor();
  assert.equal(await selected(), "doc-actions-one");
  assert.equal(await title.inputValue(), "保存失败仍保留的当前草稿");
  checks.push("从菜单打开另一篇时保存失败，保留当前编辑模式和草稿");

  await page.evaluate(() => {
    window.__removeFails = "doc-actions-two";
    window.__holdRemove = true;
  });
  await row("右键目标文档").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "删除文档", exact: true }).click();
  await dialog.getByRole("button", { name: "删除文档", exact: true }).click();
  await page.waitForFunction(() => typeof window.__releaseRemove === "function");
  assert.equal(
    await dialog.getByRole("button", { name: "正在删除…", exact: true }).isDisabled(),
    true,
  );
  assert.equal(await dialog.getByRole("button", { name: "取消", exact: true }).isDisabled(), true);
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true);
  await page.evaluate(() => window.__releaseRemove());
  await dialog.getByRole("alert").filter({ hasText: "隔离回归：删除失败" }).waitFor();
  assert.equal(await row("右键目标文档").count(), 1);
  assert.equal(await selected(), "doc-actions-one");
  assert.equal(await title.inputValue(), "保存失败仍保留的当前草稿");
  assert.equal(
    await page.evaluate(() => Boolean(window.__savedDocuments["doc-actions-two"])),
    true,
  );
  checks.push("删除中禁止重复提交或关闭，删除失败保留目标与另一篇草稿");

  await page.evaluate(() => {
    window.__removeFails = null;
  });
  await dialog.getByRole("button", { name: "删除文档", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await row("右键目标文档").count(), 0);
  assert.equal(await selected(), "doc-actions-one");
  assert.equal(await title.inputValue(), "保存失败仍保留的当前草稿");
  assert.deepEqual(await page.evaluate(() => window.__removeCalls), [
    "doc-actions-two",
    "doc-actions-two",
  ]);
  assert.equal(
    await page.evaluate(() => Boolean(window.__savedDocuments["doc-actions-two"])),
    false,
  );
  checks.push("重试只删除已确认目标，另一篇未保存草稿与编辑选择保持不变");

  await row("保存失败仍保留的当前草稿").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "删除文档", exact: true }).click();
  await dialog.getByRole("button", { name: "删除文档", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "隔离回归：保存失败" }).waitFor();
  assert.equal(await page.evaluate(() => window.__removeCalls.includes("doc-actions-one")), false);
  assert.equal(await title.inputValue(), "保存失败仍保留的当前草稿");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.evaluate(() => {
    window.__saveFails = null;
  });
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await reader.waitFor();
  assert.equal(
    await page.evaluate(() => window.__savedDocuments["doc-actions-one"].title),
    "保存失败仍保留的当前草稿",
  );
  checks.push("目标保存失败阻止调用删除接口，退出确认后可继续保存草稿");

  await page.getByRole("button", { name: "关联与设置", exact: true }).click();
  const info = page.getByRole("dialog", { name: "文档信息", exact: true });
  await info.getByRole("button", { name: "删除文档", exact: true }).click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /删除「保存失败仍保留的当前草稿」？/);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await info
      .getByRole("button", { name: "删除文档", exact: true })
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await page.keyboard.press("Escape");
  await info.waitFor({ state: "hidden" });
  checks.push("设置中的删除共用具名确认并恢复原按钮焦点");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "文档列表", exact: true }).click();
  const touchMore = page.getByRole("button", { name: "文档操作：触屏删除文档", exact: true });
  assert.equal(await touchMore.isVisible(), true);
  const size = await touchMore.boundingBox();
  assert.ok(size.width >= 44 && size.height >= 44);
  await touchMore.click();
  await menu.getByRole("menuitem", { name: "删除文档", exact: true }).click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /删除「触屏删除文档」？/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "release/screenshots/document-actions-mobile.png" });
  await dialog.getByRole("button", { name: "删除文档", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await row("触屏删除文档").count(), 0);
  assert.equal(await selected(), "doc-actions-one");
  checks.push("手机可见更多入口具有 44px 点击区域，删除确认无横向溢出");

  await row("保存失败仍保留的当前草稿").press("Shift+F10");
  await menu.getByRole("menuitem", { name: "删除文档", exact: true }).click();
  await dialog.getByRole("button", { name: "删除文档", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await selected(), null);
  assert.equal(await row("保存失败仍保留的当前草稿").count(), 0);
  assert.equal(await row("键盘打开文档").evaluate((el) => document.activeElement === el), true);
  assert.deepEqual(await page.evaluate(() => Object.keys(window.__savedDocuments)), [
    "doc-actions-three",
  ]);
  checks.push("删除当前文档后清理选择并将焦点移到剩余文档");
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ ok: true, checks, isolated: true, pageErrors }, null, 2));
} finally {
  await browser.close();
}
