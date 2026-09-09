import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";
import { completeOnboarding } from "./onboarding-helper.mjs";

const directory = await mkdtemp(join(tmpdir(), "nanpad-mail-push-"));
const env = { ...process.env, NANPAD_TEST_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SINAN_DEV_URL;
let instance;
try {
  instance = await electron.launch({ args: [resolve("electron/main.mjs")], env, timeout: 45000 });
  // 仅此隔离测试进程拦截网络，任何测试提醒都不会发给第三方。
  await instance.evaluate(({ net }) => {
    globalThis.__mailPushQaRequests = [];
    net.fetch = async (url, options) => {
      globalThis.__mailPushQaRequests.push({
        host: new URL(url).hostname,
        body: JSON.parse(options.body),
      });
      if (!String(url).startsWith("https://api.telegram.org/bot"))
        throw new Error("Unexpected fixture endpoint");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
  });
  const page = await instance.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await completeOnboarding(page);
  await page.locator('[data-app-ready="true"]').waitFor();
  assert.equal(await instance.evaluate(({ app }) => app.getPath("userData")), directory);
  const initial = await page.evaluate(() => window.sinan.mailPush.config());
  assert.equal(initial.enabled, false);
  assert.equal(initial.hasToken, false);

  const validation = await page.evaluate(async () => {
    const bridge = window.sinan;
    const connection = await bridge.mailboxes.validate({
      host: "imap.example.test",
      port: 993,
      secure: true,
    });
    const errors = {};
    for (const [key, action] of Object.entries({
      invalidConnection: () =>
        bridge.mailboxes.validate({ host: "https://invalid.test", port: 993, secure: true }),
      invalidMailbox: () => bridge.mailboxes.check("missing"),
      invalidStoredConnection: () =>
        bridge.store.save({
          mailboxes: [
            { id: "broken", imap: { host: "https://invalid.test", port: 993, secure: true } },
          ],
        }),
      testWithoutToken: () => bridge.mailPush.test(),
      readReserved: () => bridge.vault.get("notification:mail-push"),
      readReservedArray: () => bridge.vault.get(["notification:mail-push"]),
      writeReserved: () => bridge.vault.set("notification:mail-push", { token: "forbidden" }),
      removeReserved: () => bridge.vault.remove("notification:mail-push"),
      invalidInterval: () =>
        bridge.mailPush.save({
          enabled: false,
          provider: "telegram",
          destination: "",
          mailboxIds: [],
          intervalMinutes: 1,
        }),
    })) {
      try {
        await action();
        errors[key] = false;
      } catch {
        errors[key] = true;
      }
    }
    return { connection, errors };
  });
  assert.equal(validation.connection.host, "imap.example.test");
  assert.equal(validation.connection.secure, true);
  assert.equal(Object.values(validation.errors).every(Boolean), true, JSON.stringify(validation));

  await page.evaluate(async () => {
    const previous = await window.sinan.store.load();
    const snapshot = previous?.state ?? previous ?? {};
    await window.sinan.store.save({
      version: 0,
      state: {
        ...snapshot,
        mailboxes: [
          {
            id: "mail-push-qa",
            address: "notifications@example.test",
            domain: "example.test",
            kind: "mailbox",
            usedMb: 0,
            quotaMb: 1024,
            tags: [],
            status: "online",
            notes: "",
            imap: { host: "imap.example.test", port: 993, secure: true },
          },
        ],
      },
    });
  });
  await page.reload();
  await page.locator('[data-app-ready="true"]').waitFor();
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("button", { name: "设置…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByRole("button", { name: "邮件推送", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "启用自动邮件推送", exact: true }).waitFor();
  assert.equal(
    await dialog.getByRole("checkbox", { name: "启用自动邮件推送", exact: true }).isChecked(),
    false,
  );
  await dialog.getByRole("combobox", { name: "推送渠道" }).click();
  await page.getByRole("option", { name: "企业微信群机器人", exact: true }).click();
  assert.equal(await dialog.getByRole("textbox", { name: "Chat ID" }).count(), 0);
  await dialog.getByRole("combobox", { name: "推送渠道" }).click();
  await page.getByRole("option", { name: "Telegram", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Chat ID", exact: true }).fill("-1001234567");
  await dialog.getByLabel("推送凭据", { exact: true }).fill("123456:abcdefghijklmnopqrstuvwxyz");
  await dialog.getByRole("checkbox", { name: "notifications@example.test", exact: true }).check();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.getByText("邮件推送配置已保存。", { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel("推送凭据", { exact: true }).inputValue(), "");
  const saved = await page.evaluate(() => window.sinan.mailPush.config());
  assert.equal(saved.hasToken, true);
  assert.equal(saved.enabled, false);
  assert.equal(JSON.stringify(saved).includes("abcdefghijklmnopqrstuvwxyz"), false);
  assert.doesNotMatch(
    await readFile(join(directory, "vault.enc"), "utf8"),
    /abcdefghijklmnopqrstuvwxyz/,
  );
  await dialog.getByRole("button", { name: "发送测试消息", exact: true }).click();
  await dialog.getByText("测试消息已发送。", { exact: true }).waitFor();
  const requests = await instance.evaluate(() => globalThis.__mailPushQaRequests);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].host, "api.telegram.org");
  assert.doesNotMatch(requests[0].body.text, /notifications@example/);

  await mkdir("screenshots", { recursive: true });
  await dialog.getByRole("heading", { name: "邮件推送", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "screenshots/mail-push-desktop.png" });
  const desktopOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(desktopOverflow, false);
  await instance.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(320, 480);
    window.setSize(390, 844);
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: "screenshots/mail-push-mobile.png" });
  const mobileOverflow = await page.evaluate(() => {
    const dialog = document.querySelector('[aria-label="设置"][role="dialog"]');
    return {
      document: document.documentElement.scrollWidth > innerWidth,
      dialog: dialog.scrollWidth > dialog.clientWidth,
    };
  });
  assert.deepEqual(mobileOverflow, { document: false, dialog: false });
  await page.evaluate(() => window.sinan.vault.lock());
  await dialog.getByRole("button", { name: "解锁密钥库", exact: true }).waitFor();
  const locked = await page.evaluate(async () => {
    const bridge = window.sinan;
    const results = [];
    for (const action of [
      () => bridge.mailPush.config(),
      () =>
        bridge.mailPush.save({
          enabled: false,
          provider: "telegram",
          destination: "",
          mailboxIds: [],
          intervalMinutes: 15,
        }),
      () => bridge.mailPush.test(),
      () => bridge.mailboxes.check("mail-push-qa"),
    ]) {
      try {
        await action();
        results.push(false);
      } catch {
        results.push(true);
      }
    }
    return results;
  });
  assert.equal(locked.every(Boolean), true);
  assert.equal((await instance.evaluate(() => globalThis.__mailPushQaRequests)).length, 1);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: [
          "default-disabled",
          "mailbox-ipc",
          "validation",
          "write-only-push-token",
          "provider-ui",
          "save-ui",
          "fixture-test-message",
          "vault-lock",
          "desktop-layout",
          "mobile-layout",
        ],
        screenshots: ["screenshots/mail-push-desktop.png", "screenshots/mail-push-mobile.png"],
      },
      null,
      2,
    ),
  );
} finally {
  await instance?.close();
  await rm(directory, { recursive: true, force: true });
}
