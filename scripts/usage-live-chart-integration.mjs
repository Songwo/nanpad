import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { chooseOption } from "./select-helper.mjs";

// 独立合成来源，验证真实组件在采集事件后的更新，不读取用户统计或凭据。
const origin = new URL(process.env.NANPAD_QA_URL ?? "http://127.0.0.1:8080").origin;
const browser = await chromium.launch({ headless: true });
const errors = [];
await mkdir("screenshots", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
    permissions: ["local-network-access"],
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-10-08T15:59:30Z") });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route(`${origin}/__usage-live-test`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN"><head><link rel="stylesheet" href="/src/styles.css"></head><body><main id="root" style="min-height:100dvh;background:var(--color-canvas)"></main></body></html>',
    }),
  );
  await page.goto(`${origin}/__usage-live-test`);
  await page.evaluate(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const prior = new Date(today);
    prior.setDate(prior.getDate() - 1);
    const zero = new Date(today);
    zero.setDate(zero.getDate() - 2);
    const row = (date, input, output) => ({
      sourceId: "local:codex",
      sourceName: "合成客户端",
      kind: "tokens",
      origin: "local",
      key: date.toISOString(),
      label: "合成模型",
      model: "synthetic",
      bucketStart: date.toISOString(),
      checkedAt: new Date().toISOString(),
      input,
      output,
    });
    window.__usage = {
      sources: [{ id: "local:codex", name: "合成客户端", type: "local-codex" }],
      records: [row(prior, 600_000_000, 0), row(today, 3_000_000, 25_000), row(zero, 0, 0)],
    };
    window.__status = {
      enabled: true,
      intervalMs: 10000,
      lastScannedAt: new Date().toISOString(),
      sources: [],
    };
    window.__calls = { list: 0, status: 0, collect: 0 };
    window.sinan = {
      usage: {
        list: async () => {
          window.__calls.list++;
          return structuredClone(window.__usage);
        },
        localStatus: async () => {
          window.__calls.status++;
          return structuredClone(window.__status);
        },
        onChanged: (callback) => {
          window.__changed = callback;
          return () => {
            window.__changed = undefined;
          };
        },
        refreshLocal: async () => {
          window.__calls.collect++;
          return window.__status;
        },
        refreshAll: async () => {
          window.__calls.collect++;
          return { failures: [] };
        },
      },
    };
    const refresh = (await import("/@react-refresh")).default;
    refresh.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const ReactDOM = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { UsageWorkspace } = await import("/src/components/usage-workspace.tsx");
    window.__root = ReactDOM.createRoot(document.getElementById("root"));
    window.__show = (visible) =>
      window.__root.render(visible ? React.createElement(UsageWorkspace) : null);
    window.__show(true);
  });
  const today = page.getByLabel("今日用量", { exact: true });
  await today.getByText("3,000,000 Token", { exact: true }).waitFor();
  await page.locator(".usage-chart-small-value").waitFor();
  assert.equal(
    await page.locator(".usage-chart-small-value").count(),
    1,
    "非零小额存在标记，零值不得生成标记",
  );
  const dot = await page.locator(".usage-chart-small-value").boundingBox();
  assert.ok(dot.width >= 5 && dot.height >= 5, "小额标记可见");
  assert.equal(await page.evaluate(() => window.__calls.list), 1);
  await page.evaluate(() => {
    window.__status.lastScannedAt = new Date().toISOString();
    window.__changed({ recordsChanged: false, localStatus: structuredClone(window.__status) });
  });
  assert.equal(await page.evaluate(() => window.__calls.list), 1, "仅扫描状态变化不重读历史");
  const started = Date.now();
  await page.evaluate(() => {
    window.__usage.records[1].input = 4_000_000;
    window.__usage.records[1].output = 30_000;
    window.__changed({ recordsChanged: true, localStatus: structuredClone(window.__status) });
  });
  await today.getByText("4,000,000 Token", { exact: true }).waitFor({ timeout: 1500 });
  await today.getByText("30,000 Token", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__calls.list), 2);
  assert.equal(await page.evaluate(() => window.__calls.collect), 0, "刷新视图不得触发采集");
  const latency = Date.now() - started;
  await page
    .locator(".usage-charts")
    .screenshot({ path: "screenshots/usage-live-chart-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await today.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "screenshots/usage-live-chart-mobile.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => window.__show(false));
  await page.locator(".usage-charts").waitFor({ state: "detached" });
  await page.evaluate(() => {
    window.__usage.records[1].input = 5_000_000;
    window.__changed({ recordsChanged: true });
    window.__show(true);
  });
  await today.getByText("5,000,000 Token", { exact: true }).waitFor({ timeout: 1500 });
  // 相同数据对象、无采集通知时跨过本地午夜，不能把昨天继续当作今天。
  await chooseOption(page, page.getByLabel("时间范围", { exact: true }), "今天");
  const beforeMidnightReads = await page.evaluate(() => window.__calls.list);
  await page.clock.runFor(31000);
  await page.getByText("当前筛选没有记录", { exact: true }).waitFor({ timeout: 1500 });
  assert.equal(await today.count(), 0, "跨午夜后昨日摘要不得仍标作今日");
  assert.equal(
    await page.evaluate(() => window.__calls.list),
    beforeMidnightReads,
    "跨天只重算已有数据",
  );
  // 主进程新增今日用量后，仅凭事件让日期、图表和明细一起更新。
  await page.evaluate(() => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    window.__usage.records.push({
      ...window.__usage.records[1],
      key: day.toISOString(),
      bucketStart: day.toISOString(),
      input: 12345,
      output: 67,
    });
    window.__changed({ recordsChanged: true });
  });
  await today.getByText("12,345 Token", { exact: true }).waitFor({ timeout: 1500 });
  assert.equal(await today.locator("time").getAttribute("datetime"), "2026-10-09");
  // 休眠/隐藏时若丢失一次通知，唤醒必须检查本机快照，即使缓存尚未到期。
  await page.evaluate(() => {
    window.__usage.records.at(-1).input = 23456;
    window.dispatchEvent(new Event("focus"));
  });
  await today.getByText("23,456 Token", { exact: true }).waitFor({ timeout: 1500 });
  await page.evaluate(() => {
    window.__usage.records.at(-1).input = 34567;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await today.getByText("34,567 Token", { exact: true }).waitFor({ timeout: 1500 });
  assert.equal(
    await page.evaluate(() => window.__calls.collect),
    0,
    "唤醒仅补读缓存，不触发远程采集",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      liveUpdateMs: latency,
      noExtraCollection: true,
      noReadForStatusOnly: true,
      smallNonzeroVisible: true,
      zeroNotMarked: true,
      mobileOverflow: false,
      reentryInvalidation: true,
      midnightRollover: true,
      nextDayEvent: true,
      wakeWithoutEvent: true,
      errors,
    }),
  );
} finally {
  await browser.close();
}
