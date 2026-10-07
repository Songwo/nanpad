import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { chooseOption } from "./select-helper.mjs";
import { checkedUrl } from "./browser-guard.mjs";

// 仅挂载真实组件和合成用量记录；不会读取真实账号、密钥或本机日志。
const origin = new URL(checkedUrl(process.env.NANPAD_QA_URL ?? "http://127.0.0.1:8080/")).origin;
const output = "release/screenshots/usage-charts";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"],
});
const errors = [];
const checks = [];
let failure;
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(new Date("2026-10-07T04:00:00Z"));
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.fulfill({ status: 204, body: "" }),
  );
  await page.route(`${origin}/__ui-regression/usage-charts`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><main id="usage-test-root" style="max-width:1200px;margin:auto;padding:24px 16px"></main></body></html>',
    }),
  );
  await page.goto(`${origin}/__ui-regression/usage-charts`);
  await page.evaluate(async () => {
    const RefreshRuntime = (await import("/@react-refresh")).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const ReactDOM = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { UsageInsights } = await import("/src/components/usage-insights.tsx");
    const base = {
      sourceId: "api-a",
      sourceName: "来源甲",
      kind: "tokens",
      label: "组织记录",
      checkedAt: "2026-10-07T04:00:00Z",
      model: "模型 A",
    };
    const quota = {
      sourceId: "quota",
      sourceName: "示例账号",
      kind: "quota",
      key: "5h",
      label: "5 小时窗口",
    };
    const traffic = {
      sourceId: "traffic",
      sourceName: "示例流量",
      kind: "traffic",
      upload: 99999999,
      download: 99999999,
      label: "流量样本",
    };
    const data = {
      sources: [],
      records: [
        ...Array.from({ length: 7 }, (_, i) => ({
          ...base,
          key: `api-${i}`,
          bucketStart: `2026-10-0${i + 1}`,
          model: i < 4 ? "模型 A" : "模型 B",
          input: (i + 1) * 1000,
          output: (i + 1) * 250,
          cached: 100,
          cacheWrite: 50,
        })),
        {
          ...base,
          sourceId: "api-b",
          sourceName: "来源乙",
          key: "api-b",
          bucketStart: "2026-10-07",
          input: 5000,
          output: 1000,
        },
        {
          ...base,
          sourceId: "local",
          sourceName: "本机示例",
          key: "local",
          origin: "local",
          bucketStart: "2026-10-07T00:00:00+08:00",
          input: 100000,
          output: 50000,
        },
        {
          ...traffic,
          key: "first",
          checkedAt: "2026-10-01T04:00:00Z",
          deltaUpload: null,
          deltaDownload: null,
        },
        {
          ...traffic,
          key: "known-1",
          checkedAt: "2026-10-04T04:00:00Z",
          deltaUpload: 102400,
          deltaDownload: 204800,
        },
        {
          ...traffic,
          key: "known-2",
          checkedAt: "2026-10-07T04:00:00Z",
          deltaUpload: 512000,
          deltaDownload: 614400,
        },
        { ...quota, checkedAt: "2026-10-04T04:00:00Z", usedPercent: 45 },
        { ...quota, checkedAt: "2026-10-06T04:00:00Z", usedPercent: 85 },
        { ...quota, checkedAt: "2026-10-07T04:00:00Z", usedPercent: 15 },
        {
          ...quota,
          key: "week",
          label: "周窗口",
          checkedAt: "2026-10-07T04:00:00Z",
          usedPercent: 30,
        },
        {
          ...quota,
          key: "unknown",
          label: "未知窗口",
          checkedAt: "2026-10-06T04:00:00Z",
          usedPercent: 60,
        },
        {
          ...quota,
          key: "unknown",
          label: "未知窗口",
          checkedAt: "2026-10-07T04:00:00Z",
          usedPercent: null,
        },
      ],
    };
    const root = ReactDOM.createRoot(document.getElementById("usage-test-root"));
    window.__chartData = data;
    window.__renderCharts = (next = data, localHistoryRequest = 0) =>
      root.render(React.createElement(UsageInsights, { data: next, localHistoryRequest }));
    window.__renderCharts();
  });
  const charts = page.getByRole("region", { name: "用量图表", exact: true });
  await charts.waitFor();
  const total = charts.locator(".usage-chart-total strong");
  await page.waitForFunction(
    () => document.querySelector(".usage-chart-total strong")?.textContent === "41,000 Token",
  );
  assert.equal(await charts.locator(".recharts-wrapper").count(), 2);
  assert.equal(
    await charts
      .locator(".usage-chart-card")
      .first()
      .locator(".recharts-bar-rectangle path")
      .count(),
    14,
    "日趋势必须实际渲染两组柱形，不能只有空坐标轴",
  );
  assert.equal(await charts.getAttribute("data-metric"), "api");
  assert.ok(
    await page
      .locator(".usage-filter-panel")
      .evaluate((node) =>
        Boolean(
          node.compareDocumentPosition(document.querySelector(".usage-charts")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
  );
  checks.push("统一筛选在图表之前；全部类型默认单独展示 API 指标");

  await charts.getByText("查看图表数据表", { exact: true }).click();
  const tables = charts.locator("table");
  assert.equal(await tables.nth(0).locator("tbody tr").count(), 7);
  assert.equal(await tables.nth(1).locator("tbody tr").count(), 2);
  await chooseOption(
    page,
    charts.getByRole("combobox", { name: "构成维度", exact: true }),
    "按模型",
  );
  assert.match(await tables.nth(1).innerText(), /模型 A/);
  assert.match(await tables.nth(1).innerText(), /模型 B/);
  checks.push("日趋势、来源与模型构成具备完整无障碍数据表");

  await chooseOption(page, page.getByRole("combobox", { name: "来源筛选", exact: true }), "来源乙");
  assert.equal(await total.innerText(), "6,000 Token");
  assert.equal(await page.locator(".usage-record").count(), 1);
  await chooseOption(
    page,
    page.getByRole("combobox", { name: "来源筛选", exact: true }),
    "全部来源",
  );
  await chooseOption(page, page.getByRole("combobox", { name: "模型筛选", exact: true }), "模型 B");
  assert.equal(await total.innerText(), "22,500 Token");
  await chooseOption(page, page.getByRole("combobox", { name: "时间范围", exact: true }), "今天");
  assert.equal(await total.innerText(), "8,750 Token");
  assert.equal(await page.locator(".usage-record").count(), 1);
  await chooseOption(
    page,
    page.getByRole("combobox", { name: "模型筛选", exact: true }),
    "全部模型",
  );
  await chooseOption(
    page,
    page.getByRole("combobox", { name: "时间范围", exact: true }),
    "最近 30 天",
  );
  checks.push("来源、模型、日期筛选同步改变图表与明细");

  await chooseOption(
    page,
    charts.getByRole("combobox", { name: "图表指标", exact: true }),
    "本机 Token",
  );
  assert.equal(await total.innerText(), "150,000 Token");
  assert.equal(await charts.getAttribute("data-metric"), "local");
  await chooseOption(
    page,
    page.getByRole("combobox", { name: "用量类型", exact: true }),
    "流量增量",
  );
  assert.equal(await charts.getByRole("combobox", { name: "图表指标", exact: true }).count(), 0);
  assert.equal(await total.innerText(), "1.37 MiB");
  assert.match(await tables.nth(0).innerText(), /2026-10-01\s+未知\s+未知\s+1/);
  assert.match(await charts.innerText(), /归入本次采集日/);
  checks.push("本机和 API 不相加；流量仅累计有效增量并保留未知日期");

  await chooseOption(
    page,
    page.getByRole("combobox", { name: "用量类型", exact: true }),
    "订阅额度",
  );
  await chooseOption(
    page,
    charts.getByRole("combobox", { name: "额度窗口", exact: true }),
    "示例账号 · 5 小时窗口",
  );
  assert.equal(await total.innerText(), "15%");
  assert.match(await tables.nth(0).innerText(), /45%/);
  assert.match(await tables.nth(0).innerText(), /85%/);
  assert.equal(
    await charts
      .locator(".usage-chart-card")
      .first()
      .locator(".recharts-bar-rectangle path")
      .count(),
    3,
  );
  await charts.screenshot({ path: `${output}/quota-light.png` });
  await chooseOption(
    page,
    charts.getByRole("combobox", { name: "额度窗口", exact: true }),
    "示例账号 · 未知窗口",
  );
  assert.equal(await total.innerText(), "—");
  assert.match(await tables.nth(0).innerText(), /2026-10-07\s+未知/);
  checks.push("额度窗口独立，最新未知不会替换为旧值，百分比不累加");

  await chooseOption(
    page,
    page.getByRole("combobox", { name: "用量类型", exact: true }),
    "API Token",
  );
  const record = page.locator(".usage-record").first();
  await record.locator("summary").click();
  await page.evaluate(() =>
    window.__renderCharts({ ...window.__chartData, records: [...window.__chartData.records] }),
  );
  assert.equal(await record.getAttribute("open"), "");
  checks.push("数据刷新保持明细记录展开状态");
  await charts.getByText("查看图表数据表", { exact: true }).click();
  const bar = charts.locator(".recharts-bar-rectangle path").first();
  await bar.hover();
  await charts.locator(".usage-chart-tooltip").first().waitFor();
  assert.match(await charts.locator(".usage-chart-tooltip").first().innerText(), /Token/);
  await page.mouse.move(0, 0);
  checks.push("图表 tooltip 展示真实数值和单位");

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.screenshot({ path: `${output}/desktop-${theme}.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(
      await charts
        .locator(".usage-chart-grid")
        .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length),
      1,
    );
    await page.screenshot({ path: `${output}/mobile-${theme}.png`, fullPage: true });
  }
  checks.push("1280px 双列、390px 单列，浅深主题无横向溢出，减弱动效模式正常");

  await page.evaluate(() => window.__renderCharts(window.__chartData, 1));
  await page.waitForFunction(
    () => document.querySelector(".usage-charts")?.dataset.metric === "local",
  );
  assert.match(
    await page.getByRole("combobox", { name: "时间范围", exact: true }).innerText(),
    /全部历史/,
  );
  assert.equal(await total.innerText(), "150,000 Token");
  checks.push("监控面板历史请求切换为本机全部历史并同步图表");

  await page.evaluate(() => window.__renderCharts({ sources: [], records: [] }));
  await charts.getByText("当前范围暂无图表数据", { exact: true }).first().waitFor();
  assert.equal(await charts.locator(".recharts-wrapper").count(), 0);
  assert.equal(await total.innerText(), "—");
  checks.push("空数据展示说明，不生成虚构图形");
  await page.evaluate(() =>
    window.__renderCharts({
      sources: [],
      records: window.__chartData.records.filter((row) => row.key === "first"),
    }),
  );
  await chooseOption(
    page,
    page.getByRole("combobox", { name: "用量类型", exact: true }),
    "流量增量",
  );
  assert.equal(await total.innerText(), "—");
  assert.equal(await charts.locator(".recharts-wrapper").count(), 0);
  assert.equal(
    await charts
      .locator(".usage-chart-legend")
      .innerText()
      .then((text) => /0 B/.test(text)),
    false,
  );
  checks.push("仅有首次流量采集时图表和图例均保持未知，不显示准确零值");
  await page.evaluate(() => window.__renderCharts());
  await chooseOption(
    page,
    page.getByRole("combobox", { name: "用量类型", exact: true }),
    "API Token",
  );
  await page.evaluate(async () => {
    // 与组件使用同一份带 HMR 版本参数的模块，避免隔离夹具创建第二份语言状态。
    const componentSource = await fetch("/src/components/usage-charts.tsx").then((response) =>
      response.text(),
    );
    const localePath = componentSource.match(
      /from\s+["']([^"']*\/src\/lib\/i18n\.ts[^"']*)["']/,
    )?.[1];
    if (!localePath) throw new Error("Locale module import was not found");
    const { setLocale } = await import(localePath);
    setLocale("en");
    window.__renderCharts();
  });
  const englishCharts = page.getByRole("region", { name: "Usage charts", exact: true });
  await englishCharts.waitFor();
  assert.match(await englishCharts.innerText(), /Daily trend/);
  assert.match(await englishCharts.innerText(), /Input tokens/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await englishCharts.screenshot({ path: `${output}/mobile-english.png` });
  checks.push("英文图表标签和单位正确，390px 长文案无横向溢出");
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
} finally {
  await browser.close();
}
const result = { ok: !failure, checks, errors, failure: failure?.stack ?? null };
await writeFile(`${output}/verdict.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failure) process.exitCode = 1;
