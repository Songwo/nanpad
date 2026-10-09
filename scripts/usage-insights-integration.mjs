import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { chooseOption } from "./select-helper.mjs";
import { checkedUrl } from "./browser-guard.mjs";

// 真实组件搭配合成记录和隔离桥接，不读取本机日志或真实账号数据。
const origin = new URL(checkedUrl(process.env.NANPAD_QA_URL ?? "http://127.0.0.1:8080/")).origin;
const output = "release/screenshots/usage-insights";
const browser = await chromium.launch({ headless: true });
const checks = [];
const errors = [];
let failure;
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-06T04:00:00.000Z"));
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.fulfill({ status: 204, body: "" }),
  );
  await page.route(`${origin}/__ui-regression/usage-insights`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><main id="usage-test-root" style="max-width:1200px;margin:auto;padding:24px 16px"></main></body></html>',
    }),
  );
  await page.goto(`${origin}/__ui-regression/usage-insights`);
  await page.evaluate(async () => {
    const RefreshRuntime = (await import("/@react-refresh")).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const ReactDOM = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { UsageInsights } = await import("/src/components/usage-insights.tsx");
    const { LocalUsagePanel } = await import("/src/components/local-usage-panel.tsx");
    const now = "2026-10-06T04:00:00.000Z";
    const sensitiveFields = {
      apiKey: "qa-api-key-must-not-export",
      path: "C:/isolated/private-log-do-not-export.jsonl",
      prompt: "qa-private-prompt-must-not-export",
    };
    const common = { checkedAt: now, ...sensitiveFields };
    const tokenRow = (index, bucketStart) => ({
      ...common,
      sourceId: "sample-api",
      sourceName: "示例 API 组织",
      key: `api-${index}`,
      kind: "tokens",
      label: `组织记录 ${index + 1}`,
      model: index < 20 ? "gpt-example" : "other-example",
      bucketStart,
      input: 100,
      output: 10,
      cached: 50,
      cacheWrite: 20,
    });
    const data = {
      sources: [
        { id: "sample-api", name: "示例 API 组织", type: "openai" },
        { id: "sample-local", name: "示例 Codex 本机", type: "local" },
        { id: "sample-traffic", name: "示例机场订阅", type: "traffic" },
        { id: "sample-quota", name: "示例订阅账号", type: "quota" },
      ],
      records: [
        ...Array.from({ length: 25 }, (_, index) =>
          tokenRow(index, `2026-10-0${6 - (index % 5)}T00:00:00.000Z`),
        ),
        tokenRow(25, "2026-07-01T00:00:00.000Z"),
        {
          ...common,
          sourceId: "sample-local",
          sourceName: "示例 Codex 本机",
          key: "local-one",
          kind: "tokens",
          origin: "local",
          label: "本机测试会话",
          model: "gpt-example",
          bucketStart: "2026-10-06T01:00:00.000Z",
          input: 200,
          output: 50,
          cached: 180,
          cacheWrite: 20,
        },
        {
          ...common,
          sourceId: "sample-traffic",
          sourceName: "示例机场订阅",
          key: "traffic-first",
          kind: "traffic",
          label: "首次采集样本",
          upload: 1048576,
          download: 2097152,
          total: 0,
          deltaUpload: null,
          deltaDownload: null,
        },
        {
          ...common,
          sourceId: "sample-traffic",
          sourceName: "示例机场订阅",
          key: "traffic-reset",
          kind: "traffic",
          label: "计数重置样本",
          upload: 1024,
          download: 2048,
          total: 1073741824,
          counterReset: true,
          deltaUpload: null,
          deltaDownload: null,
        },
        {
          ...common,
          sourceId: "sample-traffic",
          sourceName: "示例机场订阅",
          key: "traffic-known",
          kind: "traffic",
          label: "已知增量样本",
          upload: 1048576,
          download: 2097152,
          total: 1073741824,
          deltaUpload: 131072,
          deltaDownload: 262144,
        },
        {
          ...common,
          sourceId: "sample-quota",
          sourceName: "示例订阅账号",
          key: "quota-one",
          kind: "quota",
          label: "滚动窗口",
          scope: "5 小时",
          usedPercent: 35,
          used: 35,
          limit: 100,
          unit: "%",
          resetsAt: "2026-10-06T08:00:00.000Z",
        },
        {
          ...common,
          sourceId: "sample-quota",
          sourceName: "示例订阅账号",
          key: "quota-two",
          kind: "quota",
          label: "周额度",
          scope: "本周",
          usedPercent: 52,
          used: 52,
          limit: 100,
          unit: "%",
        },
      ],
    };
    window.__usageStatus = {
      enabled: true,
      paused: false,
      intervalMs: 10000,
      lastScannedAt: null,
      sources: [
        { id: "codex", name: "Codex", available: true, files: 3, records: 18 },
        { id: "claude", name: "Claude Code", available: false, files: 0, records: 0 },
      ],
    };
    window.__usageCalls = [];
    window.__vaultUnlocked = true;
    window.sinan = {
      vault: { status: async () => ({ exists: true, unlocked: window.__vaultUnlocked }) },
      usage: {
        configureLocal: async ({ enabled }) => {
          window.__usageCalls.push({ type: "configure", enabled });
          if (window.__configureFails) throw new Error("隔离回归：监控设置保存失败");
          window.__usageStatus = { ...window.__usageStatus, enabled };
          return window.__usageStatus;
        },
        refreshLocal: async () => {
          window.__usageCalls.push({ type: "refresh" });
          if (window.__refreshFails) throw new Error("隔离回归：日志采集失败");
          window.__usageStatus = { ...window.__usageStatus, lastScannedAt: now };
          return window.__usageStatus;
        },
      },
    };
    const root = ReactDOM.createRoot(document.getElementById("usage-test-root"));
    function render() {
      window.__tickUsageRecords = () => {
        data.records = data.records.map((row) => ({
          ...row,
          checkedAt: "2026-10-06T04:00:10.000Z",
        }));
        render();
      };
      window.__updateUsageStatus = (patch) => {
        window.__usageStatus = { ...window.__usageStatus, ...patch };
        render();
      };
      root.render(
        React.createElement(
          "div",
          { style: { display: "grid", gap: 20 } },
          React.createElement(
            "h1",
            { className: "text-2xl font-semibold" },
            "用量与本机监控 · 示例数据",
          ),
          React.createElement(LocalUsagePanel, {
            status: { ...window.__usageStatus },
            onChange: async () => render(),
          }),
          React.createElement(UsageInsights, { data }),
        ),
      );
    }
    render();
  });
  const insights = page.getByRole("region", { name: "用量分析", exact: true });
  const panel = page.getByRole("region", { name: "本机 AI 监控", exact: true });
  const rows = page.locator(".usage-record");
  const select = (name, label) =>
    chooseOption(page, page.getByRole("combobox", { name, exact: true }), label);
  const metric = (label) =>
    page.locator(".usage-metric").filter({ has: page.getByText(label, { exact: true }) });
  await insights.waitFor();

  assert.equal(await metric("API Token").locator(":scope > strong").innerText(), "2,750");
  assert.equal(await metric("本机 Token").locator(":scope > strong").innerText(), "250");
  assert.equal(await metric("流量增量").locator(":scope > strong").innerText(), "384.00 KiB");
  assert.equal(await metric("订阅额度").locator(":scope > strong").innerText(), "1 个账号");
  assert.equal(await rows.count(), 20);
  assert.match(await page.locator(".usage-history-heading").innerText(), /31 条/);
  assert.equal(
    await page.getByRole("button", { name: "上一页用量", exact: true }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "下一页用量", exact: true }).click();
  assert.equal(await rows.count(), 11);
  assert.match(await page.locator(".usage-history-footer").innerText(), /2 \/ 2/);
  assert.equal(
    await page.getByRole("button", { name: "下一页用量", exact: true }).isDisabled(),
    true,
  );
  checks.push("四类汇总独立统计、缓存不重复累计、每页 20 条及页数边界");

  await metric("流量增量").click();
  assert.equal(await rows.count(), 3);
  assert.match(await page.locator(".usage-history-footer").innerText(), /1 \/ 1/);
  const firstTraffic = rows.filter({ hasText: "首次采集样本" });
  await firstTraffic.locator("summary").click();
  await firstTraffic.getByText("首次采集，尚无增量", { exact: true }).waitFor();
  assert.equal(await firstTraffic.getByText("不限额", { exact: true }).isVisible(), true);
  const resetTraffic = rows.filter({ hasText: "计数重置样本" });
  await resetTraffic.locator("summary").click();
  assert.equal(
    await resetTraffic.getByText("计数重置，无法计算", { exact: true }).isVisible(),
    true,
  );
  assert.match(
    await page.locator(".usage-history-note").innerText(),
    /2 条流量记录为首次采集或计数重置，未计入增量/,
  );
  await metric("订阅额度").click();
  assert.equal(await rows.count(), 2);
  await rows.first().locator("summary").click();
  assert.match(await rows.first().innerText(), /额度百分比不换算为 Token/);
  await metric("本机 Token").click();
  assert.equal(await rows.count(), 1);
  await rows.first().locator("summary").click();
  assert.equal(
    await rows.first().getByText("缓存读取（已计入输入）", { exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await rows.first().getByText("缓存写入（已计入输入）", { exact: true }).isVisible(),
    true,
  );
  assert.match(await rows.first().innerText(), /250 Token/);
  assert.match(await rows.first().innerText(), /可能与组织账单重叠/);
  const openedRecord = await rows.first().elementHandle();
  await page.evaluate(() => window.__tickUsageRecords());
  await page.waitForFunction(() =>
    document
      .querySelector(".usage-record-detail")
      .textContent.includes(new Date("2026-10-06T04:00:10.000Z").toLocaleString()),
  );
  assert.equal(
    await openedRecord.evaluate((element) => element.isConnected && element.open),
    true,
    "自动刷新统计数字时保留正在阅读的展开明细",
  );
  checks.push("定时刷新不重建或自动收起已展开的 Token 明细");
  await metric("API Token").click();
  assert.equal(await rows.count(), 20);
  assert.match(await page.locator(".usage-history-heading").innerText(), /25 条/);
  assert.equal(await metric("本机 Token").locator(":scope > strong").innerText(), "250");
  checks.push("四种分类切换、展开明细、流量首次与重置提示、Token 与额度口径");

  await select("用量类型", "全部类型");
  await select("来源筛选", "示例 API 组织");
  await select("时间范围", "今天");
  assert.equal(await rows.count(), 5);
  assert.equal(await metric("API Token").locator(":scope > strong").innerText(), "550");
  assert.equal(await metric("本机 Token").locator(":scope > strong").innerText(), "0");
  await select("时间范围", "最近 7 天");
  assert.match(await page.locator(".usage-history-heading").innerText(), /25 条/);
  await select("模型筛选", "other-example");
  assert.equal(await rows.count(), 5);
  await select("时间范围", "全部历史");
  assert.equal(await rows.count(), 6);
  await select("来源筛选", "示例 Codex 本机");
  await page.getByText("当前筛选没有记录", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "导出当前筛选", exact: true }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  assert.match(await page.locator(".usage-history-heading").innerText(), /32 条/);
  await select("来源筛选", "示例 Codex 本机");
  await select("模型筛选", "gpt-example");
  assert.equal(await rows.count(), 1);
  checks.push("来源、统计日和模型组合筛选，空状态与重置");

  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前筛选", exact: true }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "用量明细.json");
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.length, 1);
  assert.equal(exported[0].sourceName, "示例 Codex 本机");
  assert.equal(exported[0].input, 200);
  assert.equal(exported[0].cached, 180);
  for (const key of ["apiKey", "path", "prompt", "sourceId", "key"]) {
    assert.equal(Object.hasOwn(exported[0], key), false, `导出不得包含 ${key}`);
  }
  assert.doesNotMatch(JSON.stringify(exported), /must-not-export|do-not-export/);
  checks.push("下载真实 JSON，只导出当前筛选与允许字段，排除注入的密钥、路径和对话");

  const enable = panel.getByRole("button", { name: "开启本机监控", exact: true });
  const disable = panel.getByRole("button", { name: "关闭本机监控", exact: true });
  const refresh = panel.getByRole("button", { name: "立即采集", exact: true });
  assert.equal(await disable.getAttribute("aria-pressed"), "true");
  assert.equal(await refresh.isDisabled(), false);
  assert.deepEqual(await page.evaluate(() => window.__usageCalls), []);
  await disable.click();
  await enable.waitFor();
  assert.equal(await enable.getAttribute("aria-pressed"), "false");
  assert.equal(await refresh.isDisabled(), true);
  await page.evaluate(() => {
    window.__configureFails = true;
  });
  await enable.click();
  await panel.getByRole("alert").filter({ hasText: "监控设置保存失败" }).waitFor();
  assert.equal(await enable.getAttribute("aria-pressed"), "false");
  await page.evaluate(() => {
    window.__configureFails = false;
  });
  await enable.click();
  await disable.waitFor();
  assert.equal(await disable.getAttribute("aria-pressed"), "true");
  assert.equal(await refresh.isDisabled(), false);
  assert.equal(await panel.getByText("采集正常", { exact: true }).count(), 1);
  assert.equal(await panel.getByText("未发现日志目录", { exact: true }).count(), 1);
  // 自 1.4.0 起本机采集与密钥库独立，锁库仍可读取非敏感统计。
  await page.evaluate(() => {
    window.__vaultUnlocked = false;
    window.__updateUsageStatus({});
  });
  assert.equal(await refresh.isDisabled(), false);
  assert.equal(await panel.getByText("采集正常", { exact: true }).count(), 1);
  await refresh.click();
  assert.equal(await page.evaluate(() => window.__usageCalls.at(-1).type), "refresh");
  await page.evaluate(() => {
    window.__refreshFails = true;
  });
  await refresh.click();
  await panel.getByRole("alert").filter({ hasText: "日志采集失败" }).waitFor();
  await page.evaluate(() => {
    window.__refreshFails = false;
  });
  await refresh.click();
  await panel.getByText("最近检查：", { exact: false }).waitFor();
  assert.equal(await panel.getByRole("alert").count(), 0);
  await disable.click();
  await enable.waitFor();
  assert.equal(await refresh.isDisabled(), true);
  checks.push("默认开启、主动关闭与重新开启、锁库仍可采集、设置和采集失败可重试");

  await enable.click();
  await select("来源筛选", "全部来源");
  await select("模型筛选", "全部模型");
  await select("时间范围", "最近 30 天");
  await select("用量类型", "API Token");
  await rows.first().locator("summary").click();
  const themeColors = [];
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".usage-metric")
          .getAnimations()
          .some((animation) => animation.playState === "running"),
    );
    themeColors.push(
      await insights.evaluate(
        (element) => getComputedStyle(element.querySelector(".usage-metric")).backgroundColor,
      ),
    );
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${theme} ${viewport.width}px 不应横向溢出`,
      );
      await page.screenshot({
        path: `${output}/${theme}-${viewport.width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      const detail = await rows.first().locator(".usage-record-detail").boundingBox();
      assert.ok(
        detail.x >= 0 && detail.x + detail.width <= viewport.width,
        "展开明细应适合屏幕宽度",
      );
    }
  }
  assert.notEqual(themeColors[0], themeColors[1], "深浅主题应切换卡片底色");
  checks.push("浅色、深色及 390px 手机布局，展开记录无横向溢出");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks, isolated: true, pageErrors: errors }, null, 2));
} catch (error) {
  failure = String(error.stack ?? error);
  throw error;
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ ok: !failure, checks, errors, failure, isolated: true }, null, 2),
  );
  await browser.close();
}
