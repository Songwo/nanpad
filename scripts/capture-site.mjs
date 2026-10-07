import assert from "node:assert/strict";
import { chromium } from "playwright";
import { demoSnapshot } from "../electron/services/demo.mjs";
import { checkedUrl } from "./browser-guard.mjs";

// 独立浏览器上下文只加载示例资料，不连接桌面桥接、私人账号或本机日志。
const origin = new URL(checkedUrl(process.env.NANPAD_QA_URL ?? "http://127.0.0.1:8080/")).origin;
const browser = await chromium.launch();
const errors = [];
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 1480, height: 940 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.fulfill({ status: 204, body: "" }),
  );
  await context.addInitScript((snapshot) => {
    localStorage.setItem("sinan-assets-v1", JSON.stringify({ state: snapshot, version: 0 }));
    localStorage.setItem(
      "sinan-settings-v1",
      JSON.stringify({ state: { theme: "light", locale: "zh", assetLayout: "cards" }, version: 0 }),
    );
  }, demoSnapshot());
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.locator('[data-app-ready="true"]').waitFor();
  await page.evaluate(async () => {
    const { useProfile } = await import("/src/lib/profile.ts");
    useProfile.setState({ profile: { name: "知屿演示空间", ready: true, vaultExists: false } });
  });
  await page.getByText("知屿演示空间", { exact: true }).waitFor();
  await page.screenshot({ path: "site/overview.png", animations: "disabled" });
  await page.evaluate(async () => {
    const { useDocuments } = await import("/src/lib/documents.ts");
    const { useAppStore } = await import("/src/lib/store.ts");
    const paragraph = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const heading = (text) => ({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text }],
    });
    for (const title of ["账号与订阅整理", "域名续费记录", "项目资料索引"]) {
      await useDocuments.getState().create([], {
        title,
        content: { type: "doc", content: [paragraph("示例资料，用于展示文档整理与阅读界面。")] },
      });
    }
    await useDocuments.getState().create([{ kind: "server", id: "demo-server-0" }], {
      title: "星桥项目 · 部署与维护手册",
      content: {
        type: "doc",
        content: [
          paragraph(
            "一份连起主机、域名与日常维护的项目笔记。本文使用演示资产，不包含真实连接信息。",
          ),
          heading("工作空间概览"),
          paragraph(
            "香港节点承载应用服务，新加坡节点负责数据库与缓存。相关资产与说明保存在同一工作空间，需要时可直接回到资产记录。",
          ),
          heading("每周维护清单"),
          {
            type: "bulletList",
            content: [
              "核对域名与证书的到期提醒。",
              "检查备份是否完成，并记录恢复演练结果。",
              "查看资源与用量趋势，更新本周的维护记录。",
            ].map((text) => ({ type: "listItem", content: [paragraph(text)] })),
          },
          heading("账号与使用说明"),
          paragraph(
            "密码保存在独立的加密凭据中，文档记录用途与操作步骤。将账号关联到说明，下次使用时就能一起找到。",
          ),
          { type: "blockquote", content: [paragraph("让记录留在资产旁，让下一次查找更轻松。")] },
        ],
      },
    });
    useAppStore.getState().setView("docs");
  });
  await page.getByRole("button", { name: "编辑文档", exact: true }).waitFor();
  await page.screenshot({ path: "site/documents.png", animations: "disabled" });
  await page.evaluate(async () => {
    const records = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() - 6 + index);
      return ["文档整理 · 示例", "编程助手 · 示例"].map((name, sourceIndex) => ({
        kind: "tokens",
        sourceId: `demo-api-${sourceIndex}`,
        sourceName: name,
        key: `demo-${index}-${sourceIndex}`,
        label: "示例 API 用量",
        model: "示例模型",
        bucketStart: date.toISOString(),
        checkedAt: date.toISOString(),
        input: [12000, 18000, 9000, 27000, 21000, 33000, 24000][index] * (sourceIndex + 1),
        output: [2300, 3100, 1800, 4800, 3400, 5200, 4100][index],
        cached: 1200 * (index + 1),
      }));
    }).flat();
    window.sinan = {
      win: {
        state: async () => ({ platform: "win32", maximized: false }),
        onMaximized: () => () => {},
      },
      usage: { list: async () => ({ sources: [], records }), localStatus: async () => null },
    };
    const { useAppStore } = await import("/src/lib/store.ts");
    useAppStore.getState().setView("usage");
  });
  await page.getByRole("region", { name: "用量图表", exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll(".recharts-bar-rectangle path").length > 0,
  );
  await page.getByRole("region", { name: "用量图表", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "site/usage.png", animations: "disabled" });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      screenshots: ["overview", "documents", "usage"],
      synthetic: true,
      privateData: false,
      pageErrors: errors,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({ pageErrors: errors, visibleText: await page?.locator("body").innerText() }),
  );
  await page?.screenshot({ path: "screenshots/site-capture-failure.png" });
  throw error;
} finally {
  await browser.close();
}
