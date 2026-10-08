import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// 只使用全新浏览器上下文与合成内容，不读取桌面文档或凭据。
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
  reducedMotion: "reduce",
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
      JSON.stringify({
        version: 0,
        state: { language: "zh", theme: "light", sidebarCollapsed: true },
      }),
    );
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.setDefaultTimeout(15000);
const checks = [];
const outline = () => page.locator(".document-outline-popover");
async function menu() {
  await page.getByRole("button", { name: "添加文档", exact: true }).click();
}
async function importFile(name, text) {
  await menu();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "导入 Markdown", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: "text/markdown", buffer: Buffer.from(text) });
  await page.locator(".document-import-report").waitFor();
  await page.getByRole("button", { name: "关闭导入结果", exact: true }).click();
}
try {
  await mkdir("screenshots", { recursive: true });
  await page.goto(process.env.NANPAD_QA_URL ?? "http://127.0.0.1:8080", { timeout: 60000 });
  await page.locator('[data-app-ready="true"]').waitFor();
  await page.getByRole("button", { name: "文档资产", exact: true }).click();
  assert.equal(await page.locator(".document-import-zone").count(), 0);
  await menu();
  await page.getByRole("menuitem", { name: "新建文档", exact: true }).press("Enter");
  await page.getByRole("textbox", { name: "文档标题", exact: true }).fill("空白导航验证");
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.locator(".document-outline-trigger").click();
  assert.match(await outline().innerText(), /暂无章节标题/);
  await page.keyboard.press("Escape");
  await outline().waitFor({ state: "detached" });
  checks.push("＋菜单键盘新建、无标题空态、Escape关闭目录");

  const paragraph = "这是一段合成长文，用于检查文档滚动与章节定位。\n\n".repeat(25);
  await importFile(
    "导航长文.md",
    `# 总览\n\n${paragraph}## 同名章节\n\n${paragraph}## 同名章节\n\n${paragraph}### 末尾章节\n\n${paragraph}`,
  );
  await page.locator(".document-outline-trigger").click();
  assert.equal(await outline().locator("li").count(), 4);
  await outline().getByRole("button", { name: "3 同名章节", exact: true }).click();
  await page.waitForFunction(() => {
    const scroll = document.querySelector(".document-reader-scroll");
    const heading = document.querySelectorAll(".document-prose h2")[1];
    return (
      scroll &&
      heading &&
      Math.abs(heading.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 24) < 3
    );
  });
  await page.locator(".document-outline-trigger").click();
  assert.equal(
    await outline()
      .getByRole("button", { name: "3 同名章节", exact: true })
      .getAttribute("aria-current"),
    "location",
  );
  await outline().getByRole("button", { name: "3 同名章节", exact: true }).press("Home");
  assert.equal(
    await outline()
      .getByRole("button", { name: "1 总览", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("End");
  assert.equal(
    await outline()
      .getByRole("button", { name: "4 末尾章节", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "收起文档列表", exact: true }).click();
  await page.getByRole("button", { name: "前往底部", exact: true }).click();
  await page.waitForFunction(() => {
    const el = document.querySelector(".document-reader-scroll");
    return el.scrollTop >= el.scrollHeight - el.clientHeight - 2;
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".document-reading-progress")?.getAttribute("aria-valuenow") === "100",
  );
  await page.getByRole("button", { name: "回到顶部", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".document-reader-scroll").scrollTop === 0,
  );
  checks.push("重复标题精确定位、当前章节、高亮目录键盘导航、列表收起后顶部/底部跳转");

  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  const editor = page.locator('.tiptap[contenteditable="true"]');
  await editor.press("Control+Home");
  await page.keyboard.press("Home");
  await page.keyboard.insertText("修订：");
  await page.locator(".document-outline-trigger").click();
  await outline().getByRole("button", { name: "1 修订：总览", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  const before = await editor.innerHTML();
  const imageDrag = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["synthetic"], "image.png", { type: "image/png" }));
    return data;
  });
  await editor.dispatchEvent("dragenter", { dataTransfer: imageDrag });
  assert.equal(await page.locator(".global-markdown-drop").count(), 0);
  await editor.dispatchEvent("dragleave", { dataTransfer: imageDrag });
  await imageDrag.dispose();
  assert.equal(await editor.innerHTML(), before);
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  checks.push("编辑时目录实时更新，纯图片拖入不弹Markdown覆盖层");

  await page.getByRole("button", { name: "关联与设置", exact: true }).click();
  const mdDrag = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["# 临时"], "cancel.md", { type: "text/markdown" }));
    return data;
  });
  await page
    .getByRole("dialog", { name: "文档信息", exact: true })
    .dispatchEvent("dragenter", { dataTransfer: mdDrag });
  await page.locator(".global-markdown-drop").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".global-markdown-drop").waitFor({ state: "detached" });
  await mdDrag.dispose();
  if (await page.getByRole("dialog", { name: "文档信息", exact: true }).count())
    await page.keyboard.press("Escape");
  assert.equal(await page.locator(".document-import-report").count(), 0);
  checks.push("打开弹窗时仍感知拖入，Escape取消不导入文件");

  await page.locator(".document-outline-trigger").click();
  await page.screenshot({ path: "screenshots/document-navigation-desktop.png" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "前往底部", exact: true }).click();
  await page.locator(".document-outline-trigger").click();
  await outline().getByRole("button", { name: "3 同名章节", exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  for (const name of ["回到顶部", "前往底部"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44 && box.y + box.height <= 844 - 56);
  }
  await page.locator(".document-outline-trigger").click();
  assert.equal(await outline().evaluate((el) => getComputedStyle(el).animationName), "none");
  await page.screenshot({ path: "screenshots/document-navigation-mobile.png" });
  checks.push("390px下目录、章节与首尾导航可操作且无溢出，减少动态效果生效");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, isolated: true, checks, pageErrors: errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: "screenshots/document-navigation-failure.png" }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
