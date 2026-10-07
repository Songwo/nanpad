import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// 仅挂载真实文档组件；所有文档、存储失败和延迟上传都使用隔离样本。
const origin = new URL(process.env.NANPAD_QA_URL ?? "http://127.0.0.1:8080").origin;
const browser = await chromium.launch({ headless: true });
const checks = [];
const errors = [];
await mkdir("release/screenshots", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || url.protocol === "data:"
      ? route.continue()
      : route.fulfill({ status: 204, body: "" });
  });
  await page.route(`${origin}/__ui-regression/document-reading`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN"><head><link rel="stylesheet" href="/src/styles.css"></head><body><main id="document-test-root" style="height:100dvh"></main></body></html>',
    }),
  );
  await page.goto(`${origin}/__ui-regression/document-reading`);
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 16;
    canvas.getContext("2d").fillRect(0, 0, 32, 16);
    window.__raster = canvas.toDataURL("image/png");
    window.__savedDocuments = {};
    window.__openedLinks = [];
    window.__saveCount = 0;
    window.sinan = {
      documents: {
        list: async () => Object.values(window.__savedDocuments).map(window.__summary),
        get: async (id) => structuredClone(window.__savedDocuments[id]),
        save: async (doc) => {
          window.__saveCount++;
          if (window.__saveFails) throw new Error("隔离回归：文档保存失败");
          if (window.__holdSave) {
            window.__holdSave = false;
            await new Promise((resolve) => {
              window.__releaseSave = resolve;
            });
          }
          const saved = { ...structuredClone(doc), updatedAt: new Date().toISOString() };
          window.__savedDocuments[doc.id] = saved;
          return structuredClone(saved);
        },
      },
      images: {
        status: async () => ({ configured: true, enabled: true, origin: "https://example.test" }),
        upload: async () => {
          await new Promise((resolve) => {
            window.__releaseUpload = resolve;
          });
          return { url: window.__raster, key: "isolated", filename: "isolated.png", size: 100 };
        },
      },
      openExternal: async (url) => {
        window.__openedLinks.push(url);
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
    const text = (value) => ({ type: "text", text: value });
    const now = "2026-10-06T00:00:00.000Z";
    for (const [id, title] of [
      ["doc-reading-one", "项目部署手册"],
      ["doc-reading-two", "交接与维护记录"],
    ]) {
      window.__savedDocuments[id] = {
        id,
        title,
        bindings: [],
        createdAt: now,
        updatedAt: now,
        content: {
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 2 }, content: [text("部署前的准备")] },
            {
              type: "paragraph",
              content: [
                text("这是一份阅读模式的测试文档。"),
                {
                  ...text("访问参考资料"),
                  marks: [{ type: "link", attrs: { href: "https://example.test/guide" } }],
                },
              ],
            },
            {
              type: "bulletList",
              content: [
                { type: "listItem", content: [{ type: "paragraph", content: [text("检查配置")] }] },
              ],
            },
            {
              type: "blockquote",
              content: [{ type: "paragraph", content: [text("先检查，再发布。")] }],
            },
            { type: "codeBlock", content: [text("npm run build")] },
            { type: "image", attrs: { src: window.__raster, alt: "测试图片" } },
          ],
        },
      };
    }
    await useDocuments.getState().open("doc-reading-one");
    ReactDOM.createRoot(document.getElementById("document-test-root")).render(
      React.createElement(DocumentsWorkspace),
    );
  });
  const reader = page.getByRole("region", { name: "文档正文", exact: true });
  const title = page.getByRole("textbox", { name: "文档标题", exact: true });
  const edit = page.getByRole("button", { name: "编辑文档", exact: true });
  const finish = page.getByRole("button", { name: "完成编辑", exact: true });
  await reader.waitFor();
  assert.equal(await reader.getAttribute("contenteditable"), "false");
  assert.equal(await title.count(), 0);
  assert.equal(await page.getByRole("group", { name: "文档格式", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "插入图片", exact: true }).count(), 0);
  assert.equal(await page.locator('input[type="file"]').count(), 0);
  for (const selector of ["h2", "ul li", "blockquote", "pre code", "img", "a"]) {
    assert.equal(await reader.locator(selector).count(), 1, `${selector} 应真实渲染`);
  }
  const initial = await page.evaluate(() =>
    JSON.stringify(window.__documentStore.getState().drafts["doc-reading-one"]),
  );
  await reader.click();
  await page.keyboard.type("accidental edit");
  await reader
    .locator("img")
    .dispatchEvent("dragstart", {
      dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
    });
  await reader.dispatchEvent("drop", {
    dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
  });
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(window.__documentStore.getState().drafts["doc-reading-one"]),
    ),
    initial,
  );
  await reader.locator("a").click();
  assert.deepEqual(await page.evaluate(() => window.__openedLinks), ["https://example.test/guide"]);
  await reader.locator("a").evaluate((el) => {
    el.href = "javascript:window.__unsafeLink = true";
  });
  await reader.locator("a").click();
  assert.equal(await page.evaluate(() => Boolean(window.__unsafeLink)), false);
  assert.equal(await page.evaluate(() => window.__openedLinks.length), 1);
  checks.push("默认只读、标题语义、正文格式、安全链接与防误拖动");
  await page.screenshot({ path: "release/screenshots/document-reading-desktop.png" });

  await edit.click();
  await page.getByRole("textbox", { name: "文档正文", exact: true }).waitFor();
  await page.getByRole("button", { name: "粗体", exact: true }).waitFor();
  await title.fill("保存成功的标题");
  await finish.click();
  await reader.waitFor();
  assert.equal(
    await page.evaluate(() => window.__savedDocuments["doc-reading-one"].title),
    "保存成功的标题",
  );
  assert.equal(await page.getByRole("heading", { name: "保存成功的标题", exact: true }).count(), 1);
  checks.push("完成编辑先保存成功再进入阅读");

  await edit.click();
  await page.evaluate(() => {
    window.__saveFails = true;
  });
  await title.fill("保存失败后保留的标题");
  await finish.click();
  await page.getByRole("alert").filter({ hasText: "隔离回归：文档保存失败" }).waitFor();
  assert.equal(await title.inputValue(), "保存失败后保留的标题");
  assert.equal(await page.locator(".document-detail").getAttribute("data-mode"), "edit");
  await page.evaluate(() => {
    window.__saveFails = false;
  });
  await finish.click();
  await reader.waitFor();
  assert.equal(
    await page.evaluate(() => window.__savedDocuments["doc-reading-one"].title),
    "保存失败后保留的标题",
  );
  checks.push("保存失败保留编辑模式和草稿，重试成功");

  await edit.click();
  await page.evaluate(() => {
    window.__holdSave = true;
  });
  await title.fill("正在保存的标题");
  await page.waitForFunction(() => typeof window.__releaseSave === "function");
  await title.fill("保存期间继续输入的标题");
  await finish.click();
  await page.getByRole("button", { name: "正在完成…", exact: true }).waitFor();
  assert.equal(await title.getAttribute("readonly"), "");
  assert.equal(await page.locator(".document-detail").getAttribute("data-mode"), "edit");
  await page.evaluate(() => window.__releaseSave());
  await reader.waitFor();
  assert.equal(
    await page.evaluate(() => window.__savedDocuments["doc-reading-one"].title),
    "保存期间继续输入的标题",
  );
  checks.push("等待正在进行的保存并持久化其间产生的新改动");

  await edit.click();
  await title.fill("切换前的草稿");
  await page.locator(".document-list-item").filter({ hasText: "交接与维护记录" }).click();
  await reader.waitFor();
  assert.equal(
    await page.evaluate(() => window.__savedDocuments["doc-reading-one"].title),
    "切换前的草稿",
  );
  await page.locator(".document-list-item").filter({ hasText: "切换前的草稿" }).click();
  await reader.waitFor();
  assert.equal(await title.count(), 0);
  await page.getByRole("button", { name: "新建文档", exact: true }).click();
  await title.waitFor();
  assert.equal(await title.inputValue(), "未命名文档");
  await title.fill("新建即编辑");
  await finish.click();
  await reader.waitFor();
  await page.locator(".document-list-item").filter({ hasText: "切换前的草稿" }).click();
  await page.locator(".document-list-item").filter({ hasText: "新建即编辑" }).click();
  await reader.waitFor();
  checks.push("切换自动保存且默认阅读，新建自动编辑、再次打开阅读");

  await page.locator(".document-list-item").filter({ hasText: "切换前的草稿" }).click();
  await edit.click();
  const raster = await page.evaluate(() => window.__raster.split(",")[1]);
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "isolated.png",
      mimeType: "image/png",
      buffer: Buffer.from(raster, "base64"),
    });
  await page.waitForFunction(() => typeof window.__releaseUpload === "function");
  assert.equal(await finish.isDisabled(), true, "图片上传期间不能提前完成编辑");
  await page.locator(".document-list-item").filter({ hasText: "交接与维护记录" }).click();
  await page.locator(".document-list-item").filter({ hasText: "切换前的草稿" }).click();
  await page.evaluate(() => window.__releaseUpload());
  await page.waitForFunction(() => document.querySelectorAll(".document-prose img").length === 2);
  await page.waitForFunction(
    () =>
      window.__savedDocuments["doc-reading-one"].content.content.filter(
        (node) => node.type === "image",
      ).length === 2,
  );
  assert.equal(await reader.count(), 1);
  checks.push("上传禁用完成，切换后图片仍保存并更新阅读正文");

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await edit.isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "release/screenshots/document-reading-mobile.png" });
  await page.getByRole("button", { name: "文档列表", exact: true }).click();
  await page.locator(".document-list-item").filter({ hasText: "交接与维护记录" }).click();
  await reader.waitFor();
  await edit.click();
  assert.equal(await finish.isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "release/screenshots/document-editing-mobile.png" });
  await finish.click();
  await reader.waitFor();
  checks.push("手机列表、阅读与编辑切换，无横向溢出");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks, isolated: true, pageErrors: errors }, null, 2));
} finally {
  await browser.close();
}
