import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { chooseOption } from "./select-helper.mjs";
import { checkedUrl } from "./browser-guard.mjs";

const origin = new URL(checkedUrl(process.env.NANPAD_QA_URL || "http://127.0.0.1:8080/")).origin;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 960 },
  locale: "zh-CN",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await mkdir("release/screenshots/activity", { recursive: true });
await context.route(`${origin}/__activity-qa__`, (route) =>
  route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>每日活动隔离测试</title><body><div id="root"></div><script type="module">
import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
import("/scripts/activity-fixture.mjs").then(({mount}) => mount());
</script></body></html>`,
  }),
);
try {
  await page.goto(`${origin}/__activity-qa__`, { waitUntil: "networkidle" });
  const journal = page.getByRole("region", { name: "每日活动", exact: true });
  await journal.waitFor();
  const list = journal.getByRole("list", { name: "活动明细", exact: true });
  assert.equal(await list.getByRole("listitem").count(), 20);
  assert.equal(await journal.locator(".activity-day").count(), 14);
  assert.match(await journal.innerText(), /共 44 条 · 第 1 \/ 3 页/);
  await journal.getByRole("button", { name: "下一页活动", exact: true }).click();
  assert.match(await list.innerText(), /测试活动 20/);
  const kind = journal.getByRole("combobox", { name: "活动类别", exact: true });
  await chooseOption(page, kind, "服务器");
  assert.match(await journal.innerText(), /共 25 条 · 第 1 \/ 2 页/);
  const today = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const todayBar = journal.getByRole("button", { name: `${today}，25 条活动`, exact: true });
  await todayBar.click();
  assert.equal(await todayBar.getAttribute("aria-pressed"), "true");
  await journal.getByRole("button", { name: "重置筛选", exact: true }).click();
  await chooseOption(page, kind, "域名");
  const yesterday = await page.evaluate(() => {
    const now = new Date();
    now.setDate(now.getDate() - 1);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  await chooseOption(
    page,
    journal.getByRole("combobox", { name: "活动日期", exact: true }),
    yesterday,
  );
  assert.equal(await list.getByRole("listitem").count(), 1);
  assert.match(await list.innerText(), /昨日测试活动/);
  await journal.getByRole("button", { name: "重置筛选", exact: true }).click();

  await page.evaluate(() => window.activityFixture.background());
  assert.equal(
    await page.evaluate(() => window.activityFixture.store.getState().activity.length),
    44,
    "后台采集不得增加用户活动",
  );
  await page.getByRole("button", { name: "重新采集", exact: true }).click();
  await page.waitForFunction(() => window.activityFixture.store.getState().activity.length === 45);
  const checked = await page.evaluate(() => window.activityFixture.store.getState().activity[0]);
  assert.equal(checked.kind, "domain");
  assert.equal(checked.text, "手动检查了域名状态");
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.waitForFunction(() => window.activityFixture.store.getState().activity.length === 46);
  await page.evaluate(() => {
    window.activityFixture.view();
    window.activityFixture.view();
  });
  assert.equal(
    await page.evaluate(() => window.activityFixture.store.getState().activity.length),
    47,
    "同一打开状态不得重复记录",
  );
  const viewed = await page.evaluate(() => window.activityFixture.store.getState().activity[0]);
  assert.equal(viewed.text, "查看了域名详情");
  assert.doesNotMatch(viewed.text, /private|example|notes|https/);
  await page.evaluate(() => {
    window.activityFixture.close();
    window.activityFixture.view();
  });
  assert.equal(
    await page.evaluate(() => window.activityFixture.store.getState().activity.length),
    48,
  );
  await chooseOption(page, kind, "域名");
  assert.match(
    await journal.innerText(),
    /共 23 条 · 第 1 \/ 2 页/,
    "新发生的活动应立即显示，不能等下一次定时刷新",
  );
  await page.screenshot({ path: "release/screenshots/activity/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".ui-button,.ui-select-trigger")].every((element) =>
      element.getAnimations().every((animation) => animation.playState !== "running"),
    ),
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "release/screenshots/activity/mobile-dark.png", fullPage: true });
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("sinan-assets-v1"));
    saved.state.servers = [
      {
        id: "activity-host",
        name: "活动测试服务器",
        host: "example.test",
        port: 22,
        username: "",
        label: "",
        os: "",
        region: "",
        status: "warning",
        cpu: 0,
        memory: 0,
        disk: 0,
        uptime: "",
        lastSeen: "",
        tags: [],
        notes: "",
        sshConfigured: false,
      },
    ];
    localStorage.setItem("sinan-assets-v1", JSON.stringify(saved));
    localStorage.setItem(
      "sinan-settings-v1",
      JSON.stringify({ version: 0, state: { language: "zh", theme: "light", zoomPercent: 100 } }),
    );
  });
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.locator('[data-app-ready="true"]').waitFor();
  await page.getByRole("region", { name: "每日活动", exact: true }).waitFor();
  await page.locator(".asset-summary-row").first().click();
  const actualLog = await page.evaluate(
    () => JSON.parse(localStorage.getItem("sinan-assets-v1")).state.activity[0],
  );
  assert.equal(actualLog.text, "查看了服务器详情");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("region", { name: "每日活动", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "release/screenshots/activity/overview-desktop.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      chart: true,
      filters: true,
      pagination: true,
      manualChecks: true,
      backgroundQuiet: true,
      privateViews: true,
      mobile: true,
    }),
  );
} finally {
  await browser.close();
}
