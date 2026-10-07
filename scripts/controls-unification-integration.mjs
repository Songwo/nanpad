import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { chooseOption } from "./select-helper.mjs";
import { checkedUrl } from "./browser-guard.mjs";

const origin = new URL(checkedUrl(process.env.NANPAD_QA_URL || "http://127.0.0.1:8080/")).origin;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  locale: "zh-CN",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await mkdir("release/screenshots/controls", { recursive: true });
await context.route(`${origin}/__controls-qa__*`, (route) => {
  const mode = new URL(route.request().url()).searchParams.get("mode") || "controls";
  return route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>控件隔离测试</title><body><div id="root"></div><script type="module">
      import RefreshRuntime from "/@react-refresh";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      import("/scripts/controls-fixture.mjs").then(({ mount }) => mount(${JSON.stringify(mode)}));
    </script></body></html>`,
  });
});
const color = (locator, property) =>
  locator.evaluate((element, property) => getComputedStyle(element)[property], property);
try {
  await page.goto(`${origin}/__controls-qa__`, { waitUntil: "networkidle" });
  const trigger = page.getByRole("combobox", { name: "测试选项", exact: true });
  await trigger.waitFor();
  const ordinary = page.getByRole("button", { name: "普通操作", exact: true });
  await ordinary.click();
  assert.equal(await page.getByTestId("click-count").innerText(), "1");
  assert.equal(await trigger.getAttribute("aria-invalid"), null, "普通操作不得隐式提交表单");
  assert.equal(await ordinary.getAttribute("type"), "button");
  assert.equal(await page.getByRole("link", { name: "按钮链接" }).getAttribute("type"), null);
  await page.getByRole("button", { name: "提交表单", exact: true }).click();
  assert.equal(await trigger.getAttribute("aria-invalid"), "true");
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await chooseOption(page, trigger, "Alpha");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("listbox").waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option");
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(() => document.activeElement?.textContent === "Beta");
  await page.keyboard.press("Enter");
  assert.match(await trigger.innerText(), /Beta/);
  await page.getByRole("button", { name: "提交表单", exact: true }).click();
  assert.equal(await page.getByTestId("form-result").innerText(), "beta");
  await trigger.click();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("listbox").count(), 0);
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await trigger.click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option");
  await page.keyboard.press("End");
  await page.waitForFunction(() => document.activeElement?.textContent === "滚动选项 29");
  await page.keyboard.press("Enter");
  assert.match(await trigger.innerText(), /滚动选项 29/);
  await chooseOption(page, trigger, "请选择测试选项");
  assert.match(await trigger.innerText(), /请选择测试选项/);
  await trigger.click();
  await page.evaluate(() => (document.querySelector("fieldset").disabled = true));
  await page.getByRole("listbox").waitFor({ state: "hidden" });
  assert.equal(await trigger.isDisabled(), true);
  await page.evaluate(() => (document.querySelector("fieldset").disabled = false));
  await page.getByRole("button", { name: "切换忙碌", exact: true }).click();
  assert.equal(await trigger.isDisabled(), true);
  await page.getByRole("button", { name: "切换忙碌", exact: true }).click();

  const menuColors = new Set();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    const secondary = page.locator('[data-variant="secondary"]');
    const danger = page.locator('[data-variant="danger-ghost"]');
    assert.notEqual(await color(secondary, "backgroundColor"), "rgba(0, 0, 0, 0)");
    await danger.hover();
    await page.waitForFunction(
      () =>
        !document
          .querySelector('[data-variant="danger-ghost"]')
          .getAnimations()
          .some((a) => a.playState === "running"),
    );
    assert.notEqual(await color(danger, "backgroundColor"), "rgba(0, 0, 0, 0)");
    await trigger.click();
    const menu = page.getByRole("listbox");
    const menuColor = await color(menu, "backgroundColor");
    assert.notEqual(menuColor, "rgba(0, 0, 0, 0)");
    menuColors.add(menuColor);
    assert.equal(await color(menu, "borderTopWidth"), "1px");
    assert.notEqual(await color(menu, "boxShadow"), "none");
    await page.screenshot({ path: `release/screenshots/controls/${theme}-desktop.png` });
    await page.keyboard.press("Escape");
  }
  assert.equal(menuColors.size, 2, "浮层背景必须随深浅主题变化");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await color(ordinary, "transitionDuration"), "0s");
  assert.equal(await color(trigger, "transitionDuration"), "0s");
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseOption(page, trigger, "https://example.test/" + "long-segment-".repeat(16));
  await trigger.click();
  const box = await page.getByRole("listbox").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 391, "长选项不能让浮层超出屏幕");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "release/screenshots/controls/dark-mobile.png" });
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${origin}/__controls-qa__?mode=panels`, { waitUntil: "networkidle" });
  const host = page.getByRole("combobox", { name: "所属服务器", exact: true });
  await chooseOption(page, host, "测试服务器 B（0 个节点）");
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await chooseOption(page, page.getByRole("combobox", { name: "协议", exact: true }), "trojan");
  await chooseOption(page, page.getByRole("combobox", { name: "传输", exact: true }), "ws");
  await chooseOption(page, page.getByRole("combobox", { name: "安全", exact: true }), "tls");
  await page.getByLabel("节点名称", { exact: true }).fill("统一控件测试节点");
  await page.getByLabel("节点密码", { exact: true }).fill("isolated-test-password");
  await page.getByRole("button", { name: "保存节点", exact: true }).click();
  await page.getByText("节点已保存", { exact: true }).waitFor();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem("sinan-assets-v1")).state,
  );
  assert.equal(saved.servers[0].nodes.length, 0);
  assert.equal(saved.servers[1].nodes[0].protocol, "trojan");
  assert.equal(saved.servers[1].nodes[0].network, "ws");
  assert.equal(saved.servers[1].nodes[0].security, "tls");
  const vault = page.getByRole("combobox", { name: "关联已有密钥库", exact: true });
  await chooseOption(page, vault, "隔离测试凭据 (TOKEN)");
  await page.getByRole("button", { name: "确认关联", exact: true }).click();
  assert.match(await vault.innerText(), /选择全局密钥库中的凭据/);
  const bound = await page.evaluate(
    () => JSON.parse(localStorage.getItem("sinan-assets-v1")).state.servers[0].customSecrets,
  );
  assert.equal(bound[0].vaultSecretId, "controls-secret");
  assert.equal(await page.locator("select:visible").count(), 0, "页面不得出现可见原生下拉");
  await page.screenshot({ path: "release/screenshots/controls/panels-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await host.click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "release/screenshots/controls/panels-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      keyboard: true,
      forms: true,
      disabled: true,
      themes: true,
      longOptions: true,
      reducedMotion: true,
      nodes: true,
      vault: true,
      mobile: true,
    }),
  );
} finally {
  await browser.close();
}
