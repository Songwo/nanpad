import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

// 全部使用隔离浏览器及合成桌面桥接，不连接真实模型，也不读取用户资料。
const origin = new URL(checkedUrl(process.env.NANPAD_QA_URL || "http://127.0.0.1:8080/")).origin;
const browser = await chromium.launch({ headless: true });
const results = [];
await mkdir("screenshots", { recursive: true });
const closeTo = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) <= 0.8, `${label}: ${actual}, expected ${expected}`);

async function geometry(page) {
  return page.evaluate(() => {
    const field = document.querySelector(".agent-composer-field").getBoundingClientRect();
    const input = document.querySelector(".agent-input").getBoundingClientRect();
    const action = document.querySelector(".agent-composer-action").getBoundingClientRect();
    const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
    return {
      x: action.x / zoom,
      y: action.y / zoom,
      width: action.width / zoom,
      height: action.height / zoom,
      centerOffset: (action.y + action.height / 2 - field.y - field.height / 2) / zoom,
      bottomGap: (field.bottom - action.bottom) / zoom,
      rightGap: (field.right - action.right) / zoom,
      textGap: (action.left - input.right) / zoom,
      fieldHeight: field.height / zoom,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

async function scenario(name, options, action) {
  const context = await browser.newContext({ locale: "zh-CN", ...options });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await context.route(origin + "/__agent-composer-qa__", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>输入区隔离验证</title><body><div id="root"></div><script type="module">
          import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {};
          window.$RefreshSig$ = () => (type) => type;
          window.__vite_plugin_react_preamble_installed__ = true;
          import('/scripts/agent-workspace-fixture.mjs').then(({mount}) => mount());
        </script></body></html>`,
      }),
    );
    await page.goto(origin + "/__agent-composer-qa__");
    await page.getByText("synthetic-test-model", { exact: true }).waitFor();
    await action(page);
    assert.deepEqual(errors, [], "页面不应有运行时异常");
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.stack, pageErrors: errors });
    await page.screenshot({ path: "screenshots/agent-composer-failure.png" }).catch(() => {});
  } finally {
    await context.close();
  }
  console.log(JSON.stringify(results.at(-1)));
}

try {
  for (const zoom of [1, 1.25, 1.5]) {
    await scenario(
      `桌面 ${zoom * 100}% 输入与运行切换`,
      {
        viewport: { width: Math.round(1440 * zoom), height: Math.round(900 * zoom) },
      },
      async (page) => {
        await page.evaluate((value) => {
          document.documentElement.style.zoom = String(value);
          // 隔离夹具用固定视口壳；缩放时同步折算高度，避免夹具自身产生页面滚动。
          document.querySelector("#root > div").style.height = `${100 / value}dvh`;
        }, zoom);
        const input = page.getByRole("textbox", { name: "向模型提问", exact: true });
        await input.fill("合成输入区域测试");
        const single = await geometry(page);
        closeTo(single.centerOffset, 0, "单行按钮垂直居中");
        closeTo(single.width, 44, "按钮宽度");
        closeTo(single.height, 44, "按钮高度");
        closeTo(single.bottomGap, 6, "按钮底部留白");
        closeTo(single.rightGap, 6, "按钮右侧留白");
        assert.ok(single.textGap >= 7.5, "按钮必须与输入文字占用区域分离");
        await input.fill("合成第一行\n合成第二行\n合成第三行");
        const multi = await geometry(page);
        assert.ok(multi.fieldHeight > single.fieldHeight + 20, "多行输入必须自动增高");
        closeTo(multi.bottomGap, 6, "多行按钮底部留白");
        await input.fill("合成输入区域测试");
        await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
        assert.equal(
          await page.evaluate(() => window.__qa.requests.length),
          0,
          "中文组合输入 Enter 不提交",
        );
        await input.press("Shift+Enter");
        assert.equal(
          await page.evaluate(() => window.__qa.requests.length),
          0,
          "Shift+Enter 不提交",
        );
        assert.ok((await input.inputValue()).includes("\n"), "Shift+Enter 插入换行");
        await input.fill("合成输入区域测试");
        const before = await geometry(page);
        await input.press("Enter");
        await page.getByRole("button", { name: "停止生成", exact: true }).waitFor();
        assert.equal(
          await page.evaluate(() => window.__qa.requests.length),
          1,
          "普通 Enter 提交一次",
        );
        const running = await geometry(page);
        for (const key of ["x", "y", "width", "height"])
          closeTo(running[key], before[key], `停止按钮 ${key} 稳定`);
        await page.screenshot({
          path: `screenshots/agent-composer-running-${zoom * 100}.png`,
          animations: "disabled",
        });
        await page.getByRole("button", { name: "停止生成", exact: true }).click();
        await page.getByRole("button", { name: "发送", exact: true }).waitFor();
        // 等待按压反馈结束后比较布局，而不是把暂态缩放当成位置变化。
        await page.waitForFunction(
          () =>
            getComputedStyle(document.querySelector(".agent-composer-action")).transform === "none",
        );
        const stopped = await geometry(page);
        for (const key of ["x", "y", "width", "height"])
          closeTo(stopped[key], before[key], `恢复发送按钮 ${key} 稳定`);
        await input.fill("合成第一行\n合成第二行\n合成第三行");
        await page.screenshot({
          path: `screenshots/agent-composer-multiline-${zoom * 100}.png`,
          animations: "disabled",
        });
      },
    );
  }

  await scenario(
    "窄屏文字空间与明暗主题",
    { viewport: { width: 390, height: 844 } },
    async (page) => {
      const input = page.getByRole("textbox", { name: "向模型提问", exact: true });
      await input.fill("合成窄屏测试文字".repeat(25));
      const bounds = await geometry(page);
      assert.equal(bounds.overflow, false, "窄屏不横向溢出");
      assert.ok(bounds.textGap >= 7.5, "窄屏按钮不覆盖文字");
      closeTo(bounds.bottomGap, 6, "窄屏底部留白");
      closeTo(bounds.width, 44, "窄屏触摸区域");
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        await page.screenshot({
          path: `screenshots/agent-composer-mobile-${theme}.png`,
          animations: "disabled",
        });
      }
    },
  );

  for (const reducedMotion of ["no-preference", "reduce"]) {
    await scenario(
      `能力面板过渡与可访问性 ${reducedMotion}`,
      {
        viewport: { width: 1440, height: 900 },
        reducedMotion,
      },
      async (page) => {
        const toggle = page.getByRole("button", { name: "内置能力", exact: true });
        await toggle.click();
        await page.locator('.agent-capabilities-transition[data-shown="true"]').waitFor();
        const panel = page.locator(".agent-capabilities-transition");
        assert.equal(await panel.getAttribute("aria-hidden"), "false");
        await page.getByRole("button", { name: /文档改名/ }).waitFor();
        const duration = await panel.evaluate((node) => getComputedStyle(node).transitionDuration);
        if (reducedMotion === "reduce") {
          assert.equal(duration, "0s", "减少动态效果时面板不播放过渡");
          for (const selector of [
            ".agent-composer-field",
            ".agent-composer-action",
            ".agent-action-send",
          ]) {
            assert.equal(
              await page
                .locator(selector)
                .evaluate((node) => getComputedStyle(node).transitionDuration),
              "0s",
            );
          }
        } else assert.ok(duration.includes("0.2s"), "能力面板具有 200ms 过渡");
        await page.screenshot({
          path: `screenshots/agent-composer-capabilities-${reducedMotion}.png`,
          animations: "disabled",
        });
        await toggle.click();
        const closing = await page.evaluate(() => {
          const node = document.querySelector(".agent-capabilities-transition");
          if (!node) return { removed: true };
          node.querySelector("button").focus();
          return {
            removed: false,
            inert: node.inert,
            hidden: node.getAttribute("aria-hidden"),
            focused: node.contains(document.activeElement),
          };
        });
        if (!closing.removed) {
          assert.equal(closing.inert, true, "退场面板立即禁止交互");
          assert.equal(closing.hidden, "true", "退场面板立即从辅助技术隐藏");
          assert.equal(closing.focused, false, "退场按钮不能获得焦点");
        }
        await panel.waitFor({ state: "detached", timeout: 1000 });
        // 快速反向切换不得被旧的卸载定时器移除。
        await toggle.click();
        await toggle.click();
        await toggle.click();
        await page.waitForTimeout(260);
        await page.locator('.agent-capabilities-transition[data-shown="true"]').waitFor();
        assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      },
    );
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
if (results.some((result) => !result.ok)) process.exitCode = 1;
