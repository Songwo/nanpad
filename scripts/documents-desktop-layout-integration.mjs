import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { _electron as electron } from "playwright";
import { completeOnboarding } from "./onboarding-helper.mjs";

const directory = await mkdtemp(join(tmpdir(), "nanpad-document-layout-"));
const env = { ...process.env, NANPAD_TEST_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SINAN_DEV_URL;
let instance;
try {
  instance = await electron.launch({ args: [resolve("electron/main.mjs")], env, timeout: 45000 });
  assert.equal(await instance.evaluate(({ app }) => app.getPath("userData")), directory);
  const page = await instance.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await completeOnboarding(page);
  await page.locator('[data-app-ready="true"]').waitFor();
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 600;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e8edf0";
    ctx.fillRect(0, 0, 1200, 600);
    ctx.fillStyle = "#273a48";
    ctx.font = "32px sans-serif";
    ctx.fillText("Deployment notes — test image", 60, 100);
    const now = new Date().toISOString();
    for (const id of ["long", "short"]) {
      await window.sinan.documents.save({
        id: `doc-layout-${id}`,
        title: id === "long" ? "部署与维护手册" : "项目交接清单",
        content: {
          type: "doc",
          content: [
            { type: "image", attrs: { src: canvas.toDataURL("image/png"), alt: "测试示意图" } },
            ...Array.from({ length: id === "long" ? 80 : 2 }, (_, i) => ({
              type: "paragraph",
              content: [
                { type: "text", text: `第 ${i + 1} 项：部署步骤与日常维护记录，仅用于界面测试。` },
              ],
            })),
          ],
        },
        bindings: [],
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  await page.getByRole("button", { name: "文档资产", exact: true }).click();
  await page.locator(".document-list-item").filter({ hasText: "部署与维护手册" }).click();
  await mkdir("release/screenshots", { recursive: true });
  await page.getByRole("button", { name: "收起主导航", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#primary-navigation").getBoundingClientRect().width <= 73,
  );
  assert.ok((await page.locator("#primary-navigation").boundingBox()).width <= 80);
  await page.getByRole("button", { name: "收起文档列表", exact: true }).click();
  await page.locator("#document-library").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#document-library").isVisible(), false);
  await page.getByRole("region", { name: "文档正文", exact: true }).waitFor();
  await page.screenshot({ path: "release/screenshots/document-desktop-focus.png" });
  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  await page.getByRole("button", { name: "展开文档列表", exact: true }).click();
  await page.locator("#document-library").waitFor();
  for (const zoom of [100, 125, 150]) {
    await page.keyboard.press("Control+,");
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await settings
      .getByRole("group", { name: "界面大小", exact: true })
      .getByRole("button", { name: `${zoom}%`, exact: true })
      .click();
    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "hidden" });
    const metrics = await page.locator(".documents-workspace").evaluate((el) => ({
      bottom: el.getBoundingClientRect().bottom,
      height: innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth,
      reader: document.querySelector(".document-reader-scroll").getBoundingClientRect().height,
    }));
    assert.ok(metrics.bottom <= metrics.height + 1 && !metrics.overflow);
    assert.ok(metrics.reader > 150, "高缩放时仍应有足够的正文阅读区域");
    await page.locator(".document-reader-scroll").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const bar = await page.locator(".document-toolbar").boundingBox();
    assert.ok(bar.y >= 0 && bar.y < metrics.height);
    await page.screenshot({ path: `release/screenshots/document-desktop-${zoom}.png` });
  }
  await page.getByRole("button", { name: "文档列表", exact: true }).click();
  await page.locator(".document-list-item").filter({ hasText: "项目交接清单" }).click();
  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  await page.getByRole("textbox", { name: "文档标题", exact: true }).fill("交接清单已更新");
  await page.getByRole("button", { name: "文档列表", exact: true }).click();
  await page.locator(".document-list-item").filter({ hasText: "部署与维护手册" }).click();
  const saved = await page.evaluate(() => window.sinan.documents.get("doc-layout-short"));
  assert.equal(saved.title, "交接清单已更新");
  await page.reload();
  await page.locator('[data-app-ready="true"]').waitFor();
  assert.equal(await page.locator("#primary-navigation").getAttribute("data-collapsed"), "true");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      isolated: true,
      zooms: [100, 125, 150],
      longTextAndImages: true,
      switchSavesDraft: true,
      sidebarCollapsePersists: true,
      documentListToggle: true,
      pageErrors: errors,
    }),
  );
} finally {
  await instance?.close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("nanpad-document-layout-"));
  await rm(directory, { recursive: true, force: true });
}
