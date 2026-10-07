import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

// 隔离页面只使用合成账号和模拟主进程接口，不连接用户资料或系统密码库。
const origin = new URL(checkedUrl(process.env.NANPAD_QA_URL ?? "http://127.0.0.1:8080/")).origin;
const browser = await chromium.launch({
  args: ["--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"],
});
const errors = [];
await mkdir("screenshots", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "zh-CN",
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.fulfill({ status: 204, body: "" });
    if (url.pathname === "/qa/password-transfer")
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>密码迁移回归</title></head><body><div id="fixture"></div><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true; import '/src/styles.css';</script></body></html>`,
      });
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${origin}/qa/password-transfer`);
  await page.waitForFunction(() => window.__vite_plugin_react_preamble_installed__);
  await page.evaluate(async () => {
    // 使用 Vite 返回的实际依赖地址，避免 HMR 时间戳产生第二份 Zustand store。
    const componentSource = await (
      await fetch("/src/components/browser-password-transfer.tsx")
    ).text();
    const storeUrl = componentSource.match(/import \{ useAppStore \} from "([^"]+)"/)[1];
    const vaultUrl = componentSource.match(/import \{ useVault \} from "([^"]+)"/)[1];
    const [
      {
        default: { createElement },
      },
      {
        default: { createRoot },
      },
      { BrowserPasswordTransfer },
      { useAppStore },
      { useVault },
    ] = await Promise.all([
      import("/node_modules/.vite/deps/react.js"),
      import("/node_modules/.vite/deps/react-dom_client.js"),
      import("/src/components/browser-password-transfer.tsx"),
      import(storeUrl),
      import(vaultUrl),
    ]);
    const existing = {
      id: "existing",
      name: "保留本地修改",
      kind: "account",
      hint: "",
      value: "",
      notes: "",
      tags: [],
      status: "online",
    };
    useAppStore.setState({ secrets: [existing] });
    useVault.setState({ checked: true, exists: true, unlocked: true });
    window.__migrationCalls = { cancel: [], commit: [], export: 0, closed: 0, preview: 0 };
    window.__migrationStore = useAppStore;
    window.__migrationVault = useVault;
    window.__migrationListeners = new Set();
    window.__migrationNext = {
      ticket: "preview-1",
      total: 5,
      added: 2,
      duplicates: 1,
      conflicts: 1,
      invalid: 1,
      rows: [
        {
          title: "个人账户",
          url: "https://accounts.example.test",
          username: "alice@example.test",
          status: "new",
          password: "must-never-render-private-password",
        },
        {
          title: "工作账户",
          url: "https://accounts.example.test",
          username: "bob@example.test",
          status: "new",
        },
        {
          title: "重复账户",
          url: "https://repeat.example.test",
          username: "same@example.test",
          status: "duplicate",
        },
        {
          title: "冲突账户",
          url: "https://conflict.example.test",
          username: "conflict@example.test",
          status: "conflict",
        },
        { title: "缺少网址", url: "", username: "", status: "invalid" },
      ],
    };
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async (value) => {
        window.__migrationCopied = value;
      },
    });
    window.sinan = {
      vault: { status: async () => ({ exists: true, unlocked: useVault.getState().unlocked }) },
      onVaultChanged: (callback) => {
        window.__migrationListeners.add(callback);
        return () => window.__migrationListeners.delete(callback);
      },
      passwords: {
        previewImport: async () => {
          window.__migrationCalls.preview++;
          if (window.__migrationDelay)
            return new Promise((resolve) => {
              window.__migrationResolve = resolve;
            });
          return structuredClone(window.__migrationNext);
        },
        cancelImport: async (ticket) => {
          window.__migrationCalls.cancel.push(ticket);
        },
        commitImport: async (ticket) => {
          window.__migrationCalls.commit.push(ticket);
          const assets = [
            { ...existing, id: "new-alice", name: "个人账户" },
            { ...existing, id: "new-bob", name: "工作账户" },
            { ...existing, name: "过时的原记录" },
          ];
          // 模拟后台同时收到新资产，当前界面快照不能抹去它。
          useAppStore.setState((state) => ({
            secrets: [...state.secrets, { ...existing, id: "background", name: "后台新增" }],
          }));
          return { imported: 2, skipped: 3, assets };
        },
        exportCsv: async () => {
          window.__migrationCalls.export++;
          return { count: 4 };
        },
        onChanged: () => () => {},
      },
    };
    const root = createRoot(document.getElementById("fixture"));
    window.__migrationMount = () =>
      root.render(
        createElement(BrowserPasswordTransfer, {
          close: () => {
            window.__migrationCalls.closed++;
            root.render(null);
          },
        }),
      );
    window.__migrationMount();
  });

  const dialog = page.getByRole("dialog", { name: "浏览器密码", exact: true });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Edge", exact: true }).click();
  await dialog.getByRole("button", { name: "复制密码设置地址" }).click();
  assert.equal(await page.evaluate(() => window.__migrationCopied), "edge://wallet/passwords");
  await dialog.getByRole("button", { name: "选择 CSV 文件" }).click();
  await dialog.getByRole("button", { name: "导入 2 个账号" }).waitFor();
  assert.equal(await dialog.getByRole("row").count(), 6);
  assert.equal((await dialog.innerText()).includes("must-never-render-private-password"), false);
  await page.screenshot({
    path: "screenshots/password-transfer-desktop.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "screenshots/password-transfer-mobile.png",
    animations: "disabled",
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  assert.equal(
    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
  );
  await dialog.getByRole("button", { name: "导入 2 个账号" }).click();
  await dialog.getByText("已导入 2 个账号", { exact: true }).waitFor();
  const assets = await page.evaluate(() => window.__migrationStore.getState().secrets);
  assert.equal(assets.length, 4);
  assert.equal(assets.find((asset) => asset.id === "existing").name, "保留本地修改");
  assert.equal(
    assets.some((asset) => asset.id === "background"),
    true,
  );
  assert.equal(assets.filter((asset) => asset.id.startsWith("new-")).length, 2);
  assert.deepEqual(await page.evaluate(() => window.__migrationCalls.commit), ["preview-1"]);

  await dialog.getByRole("button", { name: "选择 CSV 文件" }).click();
  await dialog.getByRole("button", { name: "导入 2 个账号" }).waitFor();
  await dialog.getByRole("button", { name: "导出到浏览器" }).click();
  assert.equal(
    await page.evaluate(() => window.__migrationCalls.cancel.includes("preview-1")),
    true,
  );
  const exportButton = dialog.getByRole("button", { name: "导出 CSV 文件" });
  assert.equal(await exportButton.isDisabled(), true);
  await dialog
    .getByRole("checkbox", { name: "我了解明文风险，导入浏览器后会删除 CSV 文件。" })
    .check();
  await page.screenshot({
    path: "screenshots/password-transfer-export-mobile.png",
    animations: "disabled",
  });
  assert.equal(
    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
  );
  await exportButton.click();
  await dialog
    .getByText("已导出 4 个账号。请到浏览器的密码设置完成导入。", { exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => window.__migrationCalls.export), 1);
  assert.equal(await exportButton.isDisabled(), true);

  await dialog.getByRole("button", { name: "导入到知屿" }).click();
  await dialog.getByRole("button", { name: "选择 CSV 文件" }).click();
  await dialog.getByRole("button", { name: "导入 2 个账号" }).waitFor();
  await page.evaluate(() => {
    window.__migrationVault.setState({ unlocked: false });
    for (const listener of window.__migrationListeners) listener();
  });
  await dialog.getByRole("button", { name: "选择 CSV 文件" }).waitFor();
  assert.equal(await dialog.getByRole("table").count(), 0);
  assert.equal((await dialog.innerText()).includes("alice@example.test"), false);

  // 已开始的文件读取在锁库后返回，也不能把预览再次显示出来。
  await page.evaluate(() => {
    window.__migrationVault.setState({ unlocked: true });
    window.__migrationDelay = true;
  });
  await dialog.getByRole("button", { name: "选择 CSV 文件" }).click();
  await page.waitForFunction(() => typeof window.__migrationResolve === "function");
  await page.evaluate(() => {
    window.__migrationVault.setState({ unlocked: false });
    window.__migrationResolve({ ...window.__migrationNext, ticket: "late-preview" });
  });
  await page.waitForFunction(() => window.__migrationCalls.cancel.includes("late-preview"));
  assert.equal(await dialog.getByRole("table").count(), 0);
  assert.equal((await dialog.innerText()).includes("alice@example.test"), false);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await dialog.waitFor({ state: "detached" });

  // 关闭向导撤销仍在预览的票据；全部为重复时不允许执行导入。
  await page.evaluate(() => {
    window.__migrationVault.setState({ unlocked: true });
    window.__migrationDelay = false;
    window.__migrationNext = { ...window.__migrationNext, ticket: "duplicates-only", added: 0 };
    window.__migrationMount();
  });
  await dialog.getByRole("button", { name: "选择 CSV 文件" }).click();
  await dialog.getByRole("button", { name: "导入 0 个账号" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "导入 0 个账号" }).isDisabled(), true);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => window.__migrationCalls.cancel.includes("duplicates-only")),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: [
          "browser-guide",
          "preview-without-passwords",
          "multi-account-merge",
          "preserve-local-edits",
          "export-consent",
          "lock-clears-preview",
          "late-preview-cancelled",
          "cancel-ticket",
          "duplicate-only",
          "mobile-layout",
        ],
        screenshots: [
          "screenshots/password-transfer-desktop.png",
          "screenshots/password-transfer-mobile.png",
          "screenshots/password-transfer-export-mobile.png",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
