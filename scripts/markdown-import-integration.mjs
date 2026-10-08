import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { _electron as electron, chromium } from "playwright";
import { completeOnboarding } from "./onboarding-helper.mjs";

// 浏览器使用全新上下文，桌面使用独立 userData；只导入合成文档。
const web = process.argv.includes("--web");
const packaged = process.argv.slice(2).find((arg) => arg.endsWith(".exe"));
const directory = await mkdtemp(join(tmpdir(), "zhiyu-markdown-qa-"));
const env = { ...process.env, NANPAD_TEST_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SINAN_DEV_URL;
if (packaged) delete env.NANPAD_TEST_DATA_DIR;
const errors = [];
const imageRequests = [];
const checks = [];
const prefix = `screenshots/markdown-import-${web ? "web" : "desktop"}`;
let instance;
let browser;
let page;

async function launchDesktop() {
  instance = await electron.launch({
    ...(packaged ? { executablePath: resolve(packaged) } : {}),
    args: packaged ? [`--user-data-dir=${directory}`] : [resolve("electron/main.mjs")],
    env,
    locale: "zh-CN",
    timeout: 45000,
  });
  assert.equal(await instance.evaluate(({ app }) => app.getPath("userData")), directory);
  const current = await instance.firstWindow();
  await instance.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  return current;
}
function observe(current) {
  current.setDefaultTimeout(20000);
  current.on("pageerror", (error) => errors.push(error.message));
  current.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  current.on("request", (request) => {
    if (request.url().includes("example.test/tracker")) imageRequests.push(request.url());
  });
}
const file = (name, text) => ({ name, mimeType: "text/markdown", buffer: Buffer.from(text) });
const row = (name) => page.locator(".document-list-item").filter({ hasText: name });
const input = () => page.getByLabel("选择 Markdown 文件", { exact: true });
const reader = () => page.getByRole("region", { name: "文档正文", exact: true });
const report = () => page.locator(".document-import-report");
async function results(success, failed) {
  await page.waitForFunction(
    (text) => document.querySelector(".document-import-report")?.textContent.includes(text),
    `导入完成：${success} 篇成功，${failed} 篇未导入。`,
  );
}
try {
  await mkdir("screenshots", { recursive: true });
  if (packaged)
    await writeFile(
      join(directory, "local-usage.json"),
      JSON.stringify({ version: 1, enabled: false, checkpoints: [], events: [], records: [] }),
    );
  if (web) {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    if (process.env.NANPAD_QA_DISABLE_HMR)
      await context.routeWebSocket("**/*", (socket) => {
        const server = socket.connectToServer();
        server.onMessage((message) => {
          const type = JSON.parse(String(message)).type;
          if (!["update", "full-reload"].includes(type)) socket.send(message);
        });
      });
    await context.addInitScript(() => {
      if (!localStorage.getItem("sinan-settings-v1"))
        localStorage.setItem(
          "sinan-settings-v1",
          JSON.stringify({ version: 0, state: { language: "zh", theme: "light" } }),
        );
    });
    page = await context.newPage();
    observe(page);
    await page.goto(process.env.NANPAD_QA_URL ?? "http://127.0.0.1:8080", { timeout: 60000 });
  } else {
    page = await launchDesktop();
    observe(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await completeOnboarding(page);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('[data-app-ready="true"]').waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "文档资产", exact: true }).click();
  await page.getByRole("button", { name: "添加文档", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "导入 Markdown", exact: true }).click();
  const picker = await chooser;
  assert.equal(picker.isMultiple(), true);
  await picker.setFiles([
    file(
      "部署手册.md",
      "# 部署手册\n\n**先备份**再操作。\n\n- 检查环境\n- 记录结果\n\n> 保留回退方案\n\n```sh\nprintf 'hello'\n```",
    ),
    file("空文档.md", "  \n"),
    file(
      "安全示例.markdown",
      "# 安全示例\n\n<script>window.__markdownExecuted=true</script>\n\n![图片](https://example.test/tracker.png)\n\n| 名称 | 值 |\n| --- | --- |\n| 环境 | 测试 |",
    ),
  ]);
  await results(2, 1);
  await reader().waitFor();
  assert.equal(await page.getByRole("group", { name: "文档格式", exact: true }).count(), 0);
  assert.equal(await reader().locator("img").count(), 0);
  assert.equal(await page.evaluate(() => Boolean(window.__markdownExecuted)), false);
  assert.deepEqual(imageRequests, []);
  await report().locator("summary").click();
  assert.match(await report().innerText(), /Markdown 文件为空/);
  assert.match(await report().innerText(), /未自动加载/);
  checks.push("真实多选入口、部分失败继续、默认阅读、HTML 不执行且图片不请求");

  await row("部署手册").click();
  assert.equal(await reader().locator("strong").innerText(), "先备份");
  assert.equal(await reader().locator("li").count(), 2);
  assert.match(await reader().locator("blockquote").innerText(), /回退方案/);
  assert.equal(await reader().locator("code").getAttribute("class"), "language-sh");
  await page.screenshot({ path: `${prefix}.png` });
  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  await page.getByRole("textbox", { name: "文档标题", exact: true }).fill("部署手册（已修改）");
  await page.locator('.tiptap[contenteditable="true"]').press("Control+End");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.insertText("追加的验证记录");
  // 导入下一篇前必须保存当前未完成的编辑。
  await input().setInputFiles([
    file("同名.md", "# 第一份独立内容"),
    file("同名.md", "# 第二份独立内容"),
  ]);
  await results(2, 0);
  assert.equal(await row("同名").count(), 2);
  await row("部署手册（已修改）").click();
  assert.match(await reader().innerText(), /追加的验证记录/);
  checks.push("富文本结构正确、导入前保存当前草稿、同名文档独立创建");

  await page.getByRole("button", { name: "资产总览", exact: true }).click();
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(["# 拖入内容\n\n拖入后可阅读。"], "拖入文档.md", { type: "text/markdown" }),
    );
    return data;
  });
  const zone = page.locator("body");
  await zone.dispatchEvent("dragenter", { dataTransfer: transfer });
  await page.locator(".global-markdown-drop").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".global-markdown-drop").waitFor({ state: "detached" });
  await zone.dispatchEvent("dragenter", { dataTransfer: transfer });
  await page.locator(".global-markdown-drop").waitFor();
  await zone.dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
  await results(1, 0);
  assert.match(await reader().innerText(), /拖入后可阅读/);
  assert.equal(await page.locator(".global-markdown-drop").count(), 0);
  checks.push("从资产总览全局拖入并自动打开文档、Escape关闭覆盖层");

  await input().setInputFiles([file("超大.md", "x".repeat(1024 * 1024 + 1))]);
  await results(0, 1);
  await report().locator("summary").click();
  assert.match(await report().innerText(), /不能超过 1 MiB/);
  assert.equal(await row("超大").count(), 0);
  await input().setInputFiles(Array.from({ length: 51 }, (_, i) => file(`超量-${i}.md`, "示例")));
  await page.locator(".document-import-error").filter({ hasText: "一次最多导入 50 篇" }).waitFor();
  assert.equal(await row("超量-").count(), 0);
  checks.push("超大与批量超限提示明确且未写入");

  if (!web) {
    const names = (await readdir(join(directory, "documents"))).filter((name) =>
      name.endsWith(".json"),
    );
    assert.equal(names.length, 5);
    const saved = await Promise.all(
      names.map(async (name) =>
        JSON.parse(await readFile(join(directory, "documents", name), "utf8")),
      ),
    );
    assert.equal(saved.filter((doc) => doc.title === "同名").length, 2);
    assert.ok(
      saved.some(
        (doc) =>
          doc.title === "部署手册（已修改）" &&
          JSON.stringify(doc.content).includes("追加的验证记录"),
      ),
    );
    await instance.close();
    instance = null;
    page = await launchDesktop();
    observe(page);
  } else await page.reload();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-app-ready="true"]').waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "文档资产", exact: true }).click();
  await row("部署手册（已修改）").click();
  assert.match(await reader().innerText(), /追加的验证记录/);
  assert.equal(await row("同名").count(), 2);
  checks.push(
    web ? "页面重载后文档和编辑内容保留" : "真实文件落盘、退出进程再启动后文档和编辑内容保留",
  );

  if (web) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "文档列表", exact: true }).click();
    const button = await page.getByRole("button", { name: "添加文档", exact: true }).boundingBox();
    assert.ok(button.width >= 44 && button.height >= 44);
    await input().setInputFiles(file("手机导入.md", "# 窄屏阅读\n\n手机导入正文"));
    await reader().waitFor();
    assert.match(await reader().innerText(), /手机导入正文/);
    await page.getByRole("button", { name: "文档列表", exact: true }).click();
    await report().waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: `${prefix}-mobile.png` });
    checks.push("390px 窄屏导入、返回列表查看结果、44px 按钮、无横向溢出");
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(imageRequests, []);
  console.log(
    JSON.stringify(
      { ok: true, mode: web ? "web" : "desktop", isolated: true, checks, pageErrors: errors },
      null,
      2,
    ),
  );
} catch (error) {
  await page?.screenshot({ path: `${prefix}-failure.png`, timeout: 3000 }).catch(() => {});
  throw error;
} finally {
  await instance?.close();
  await browser?.close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("zhiyu-markdown-qa-"));
  await rm(directory, { recursive: true, force: true });
}
