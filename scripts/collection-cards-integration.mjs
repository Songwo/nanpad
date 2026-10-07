import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

// 独立浏览器 context 只注入合成邮箱与凭据元数据，不接入桌面桥接或真实账号。
const origin = new URL(checkedUrl(process.env.NANPAD_QA_URL ?? "http://127.0.0.1:8080/")).origin;
const output = "release/screenshots/collection-cards";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"],
});
const checks = [];
const errors = [];
let failure;
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
    locale: "zh-CN",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.fulfill({ status: 204, body: "" }),
  );
  await page.route(`${origin}/__ui-regression/collection-cards`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><main id="collection-root" style="max-width:1200px;margin:auto;padding:24px 0"></main></body></html>',
    }),
  );
  await page.goto(`${origin}/__ui-regression/collection-cards`);
  await page.evaluate(async () => {
    const RefreshRuntime = (await import("/@react-refresh")).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const ReactDOM = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { MailWorkspace } = await import("/src/components/mail-workspace.tsx");
    const { VaultWorkspace } = await import("/src/components/vault-workspace.tsx");
    // 读取真实组件的模块路径，避免 HMR 版本参数导致夹具创建第二个状态库。
    const source = await fetch("/src/components/mail-workspace.tsx").then((response) =>
      response.text(),
    );
    const storePath = source.match(/from\s+["']([^"']*\/src\/lib\/store\.ts[^"']*)["']/)?.[1];
    if (!storePath) throw new Error("Store import was not found");
    const { useAppStore } = await import(storePath);
    const mailBase = {
      domain: "example.test",
      kind: "mailbox",
      usedMb: 0,
      quotaMb: 1024,
      status: "online",
      notes: "",
      tags: [],
    };
    const secretBase = {
      hint: "合成记录，无真实凭据",
      value: "",
      lastRotated: "2026-10-07",
      status: "online",
      notes: "",
      tags: [],
    };
    window.__collectionLongName = "项目归档与跨团队协作资料".repeat(3).slice(0, 40);
    useAppStore.setState({
      servers: [],
      domains: [],
      aiAssets: [],
      certs: [],
      phoneNumbers: [],
      links: [],
      activity: [],
      query: "",
      filter: "all",
      tagFilter: [],
      mailFolders: [
        { id: "mail-work", name: "职场与协作", color: "blue" },
        { id: "mail-personal", name: "生活与订阅", color: "green" },
        { id: "mail-long", name: window.__collectionLongName, color: "rose" },
        { id: "mail-empty", name: "待整理的空文件夹", color: "amber" },
      ],
      secretFolders: [
        { id: "vault-work", name: "工作账号", color: "blue" },
        { id: "vault-personal", name: "个人服务", color: "green" },
        { id: "vault-long", name: window.__collectionLongName, color: "rose" },
        { id: "vault-empty", name: "待整理的空分组", color: "amber" },
      ],
      mailboxes: [
        {
          ...mailBase,
          id: "mail-one",
          address: "collaboration@example.test",
          folderId: "mail-work",
        },
        { ...mailBase, id: "mail-two", address: "design@example.test", folderId: "mail-work" },
        {
          ...mailBase,
          id: "mail-three",
          address: "newsletter@example.test",
          folderId: "mail-personal",
        },
        {
          ...mailBase,
          id: "mail-long",
          address: `${"synthetic-long-name-".repeat(4)}@example.test`,
          folderId: "mail-long",
        },
      ],
      secrets: [
        {
          ...secretBase,
          id: "secret-one",
          name: "协作平台账号",
          kind: "account",
          folderId: "vault-work",
        },
        {
          ...secretBase,
          id: "secret-two",
          name: "示例接口凭据",
          kind: "api",
          folderId: "vault-work",
        },
        {
          ...secretBase,
          id: "secret-three",
          name: "个人服务账号",
          kind: "account",
          folderId: "vault-personal",
        },
        {
          ...secretBase,
          id: "secret-long",
          name: "仅用于测试很长名称下的预览标签是否截断".repeat(3),
          kind: "token",
          folderId: "vault-long",
        },
      ],
    });
    const root = ReactDOM.createRoot(document.getElementById("collection-root"));
    window.__showCollection = (mode) =>
      root.render(
        React.createElement(mode === "mail" ? MailWorkspace : VaultWorkspace, { key: mode }),
      );
    window.__collectionState = () => useAppStore.getState();
    window.__showCollection("mail");
  });

  const configs = [
    {
      mode: "mail",
      region: "邮箱文件夹",
      first: "职场与协作",
      renamed: "团队协作（已更新）",
      edit: "编辑文件夹",
      open: "打开文件夹",
      back: "返回文件夹",
      field: "文件夹名称",
      colorGroup: "文件夹颜色",
      color: "绿色",
      colorClass: "green",
      empty: "待整理的空文件夹",
      emptyText: "没有匹配的邮箱。",
      member: "collaboration@example.test",
      storeKey: "mailFolders",
      storeId: "mail-work",
    },
    {
      mode: "vault",
      region: "密钥分组",
      first: "工作账号",
      renamed: "项目凭据（已更新）",
      edit: "编辑分组",
      open: "打开分组",
      back: "返回分组",
      field: "分组名称",
      colorGroup: "分组颜色",
      color: "玫红",
      colorClass: "rose",
      empty: "待整理的空分组",
      emptyText: "没有匹配的密钥。",
      member: "协作平台账号",
      storeKey: "secretFolders",
      storeId: "vault-work",
    },
  ];
  for (const config of configs) {
    await page.evaluate((mode) => window.__showCollection(mode), config.mode);
    const region = page.getByRole("region", { name: config.region, exact: true });
    await region.waitFor();
    assert.equal(await region.locator(".collection-card").count(), 5);
    const firstCard = region.locator(".collection-card").filter({
      has: page.getByRole("button", { name: `${config.open} ${config.first}`, exact: true }),
    });
    assert.equal(await firstCard.locator(".collection-card-count strong").innerText(), "2");
    assert.equal(await firstCard.locator("button button").count(), 0, "打开与编辑按钮不能嵌套");
    await region
      .getByRole("button", { name: `${config.open} ${config.first}`, exact: true })
      .click();
    await region.getByText(config.member, { exact: true }).waitFor();
    await region.getByRole("button", { name: config.back, exact: true }).click();
    checks.push(`${config.region}：卡片打开正确分组并显示成员，返回后恢复卡片`);

    await region
      .getByRole("button", { name: `${config.edit} ${config.first}`, exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: config.edit, exact: true });
    await dialog.waitFor();
    assert.equal(
      await page.locator("#collection-root .collection-grid").count(),
      1,
      "直接编辑不得意外进入分组",
    );
    await dialog.getByRole("textbox", { name: config.field, exact: true }).fill(config.renamed);
    const color = dialog
      .getByRole("group", { name: config.colorGroup, exact: true })
      .getByRole("button", { name: config.color, exact: true });
    await color.click();
    assert.equal(await color.getAttribute("aria-pressed"), "true");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const renamedCard = region.locator(".collection-card").filter({
      has: page.getByRole("button", { name: `${config.open} ${config.renamed}`, exact: true }),
    });
    assert.match(
      await renamedCard.getAttribute("class"),
      new RegExp(`collection-card-${config.colorClass}`),
    );
    const saved = await page.evaluate(
      ({ key, id }) => window.__collectionState()[key].find((item) => item.id === id),
      { key: config.storeKey, id: config.storeId },
    );
    assert.equal(saved.name, config.renamed);
    assert.equal(saved.color, config.colorClass);
    const persisted = await page.evaluate(
      ({ key, id }) =>
        JSON.parse(localStorage.getItem("sinan-assets-v1")).state[key].find(
          (item) => item.id === id,
        ),
      { key: config.storeKey, id: config.storeId },
    );
    assert.equal(persisted.name, config.renamed);
    assert.equal(persisted.color, config.colorClass);
    checks.push(`${config.region}：卡片直接编辑名称和颜色，状态与独立浏览器存储一致`);

    const emptyCard = region.locator(".collection-card").filter({
      has: page.getByRole("button", { name: `${config.open} ${config.empty}`, exact: true }),
    });
    assert.equal(await emptyCard.getAttribute("data-empty"), "true");
    assert.equal(await emptyCard.locator(".collection-card-count strong").innerText(), "0");
    await emptyCard
      .getByRole("button", { name: `${config.open} ${config.empty}`, exact: true })
      .click();
    await region.getByText(config.emptyText, { exact: true }).waitFor();
    await region.getByRole("button", { name: config.back, exact: true }).click();
    const ungrouped = region
      .locator(".collection-card")
      .filter({ has: page.getByRole("button", { name: `${config.open} 未分组`, exact: true }) });
    assert.equal(await ungrouped.locator(".collection-card-edit").count(), 0);
    checks.push(`${config.region}：空分组能打开并展示空状态，未分组不提供编辑入口`);

    const longName = await page.evaluate(() => window.__collectionLongName);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 850 });
        const overflow = await page.evaluate(() => ({
          viewport: innerWidth,
          page: document.documentElement.scrollWidth,
          cards: [...document.querySelectorAll(".collection-card")].map((item) => ({
            left: item.getBoundingClientRect().left,
            right: item.getBoundingClientRect().right,
          })),
        }));
        assert.ok(
          overflow.page <= overflow.viewport + 1,
          `${config.mode}/${theme}/${width} 页面溢出`,
        );
        assert.ok(overflow.cards.every((item) => item.left >= 0 && item.right <= width + 1));
        const title = region.locator(".collection-card-title").filter({ hasText: longName });
        assert.equal(
          await title.evaluate((node) => getComputedStyle(node).textOverflow),
          "ellipsis",
        );
        if (width === 390)
          assert.equal(
            await region
              .locator(".collection-grid")
              .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length),
            1,
          );
        await page.screenshot({
          path: `${output}/${config.mode}-${width}-${theme}.png`,
          fullPage: true,
        });
      }
    }
    await region.getByRole("button", { name: `${config.open} ${longName}`, exact: true }).click();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "长名称分组打开后不能溢出",
    );
    await region.getByRole("button", { name: config.back, exact: true }).click();
    await region
      .getByRole("button", { name: `${config.edit} ${config.renamed}`, exact: true })
      .click();
    await page.getByRole("dialog", { name: config.edit, exact: true }).waitFor();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "手机编辑弹窗不能溢出",
    );
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    checks.push(
      `${config.region}：1280/390px 浅深主题、长名称卡片、打开长名称分组与手机编辑无溢出`,
    );
    await page.setViewportSize({ width: 1280, height: 850 });
  }
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
} finally {
  await browser.close();
}
const result = { ok: !failure, checks, errors, isolated: true, failure: failure?.stack ?? null };
await writeFile(`${output}/verdict.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failure) process.exitCode = 1;
