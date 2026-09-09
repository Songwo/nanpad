import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";
import { completeOnboarding } from "./onboarding-helper.mjs";
import { chooseOption } from "./select-helper.mjs";

const directory = await mkdtemp(join(tmpdir(), "nanpad-mail-ui-"));
const env = { ...process.env, NANPAD_TEST_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SINAN_DEV_URL;
let instance;
try {
  instance = await electron.launch({ args: [resolve("electron/main.mjs")], env, timeout: 45000 });
  const page = await instance.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 960 });
  await completeOnboarding(page);
  await page.locator('[data-app-ready="true"]').waitFor();
  await page.evaluate(async () => {
    const saved = await window.sinan.store.load();
    saved.state.mailFolders = [
      { id: "work", name: "工作邮箱", color: "blue" },
      { id: "personal", name: "生活邮箱", color: "green" },
    ];
    saved.state.mailboxes = Array.from({ length: 9 }, (_, index) => ({
      id: `mail-${index}`,
      address: `account${index}@example.test`,
      domain: "example.test",
      kind: "mailbox",
      tags: [],
      status: "online",
      notes: "",
      usedMb: 0,
      quotaMb: 1000,
      folderId: index < 4 ? "work" : index < 7 ? "personal" : undefined,
      imap: { host: "imap.example.test", port: 993, secure: true },
      smtp: { host: "smtp.example.test", port: 587, security: "starttls" },
    }));
    await window.sinan.store.save(saved);
    await window.sinan.vault.set("account:mail-0", {
      username: "account0@example.test",
      password: "fixture-password",
    });
  });
  // UI 测试替换涉及网络的 IPC，草稿、凭据和资产持久化仍走真实主进程；协议解析另有服务测试。
  await instance.evaluate(({ ipcMain }) => {
    let seen = false;
    globalThis.mailUiTestSent = [];
    const summary = () => ({
      uid: 10,
      subject: "Weekly delivery",
      from: [{ name: "Product Team", address: "team@example.test" }],
      to: [{ name: "", address: "account0@example.test" }],
      date: "2026-09-09T01:00:00Z",
      seen,
      size: 200,
    });
    const methods = {
      folders: () => [
        { path: "INBOX", name: "Inbox", specialUse: null },
        { path: "Sent", name: "Sent", specialUse: "\\Sent" },
      ],
      messages: (_id, options) => ({
        items: options.unseen && seen ? [] : [summary()],
        total: 1,
        page: 0,
        folder: options.folder,
        uidValidity: "123",
      }),
      read: () => ({
        ...summary(),
        text: "Private weekly delivery body.\nDo not send this content to AI.",
        messageId: "<weekly@example.test>",
        replyTo: [{ name: "", address: "team@example.test" }],
        cc: [],
        attachments: [],
      }),
      seen: async (_id, _selection, value) => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        seen = value;
        return true;
      },
      send: (_id, value) => {
        globalThis.mailUiTestSent.push(value);
        return { messageId: "<sent@example.test>", accepted: [value.to], rejected: [] };
      },
    };
    for (const [name, method] of Object.entries(methods)) {
      ipcMain.removeHandler(`mail-client:${name}`);
      ipcMain.handle(`mail-client:${name}`, async (_event, ...args) => ({
        ok: true,
        data: await method(...args),
      }));
    }
  });
  await page.reload();
  await page.locator('[data-app-ready="true"]').waitFor();
  await page.getByRole("button", { name: "邮箱", exact: true }).click();
  await page.getByRole("button", { name: "打开文件夹 工作邮箱", exact: true }).waitFor();
  assert.equal(await page.locator("[data-mailbox-id]").count(), 0);
  await page.screenshot({ path: "screenshots/nanpad-v050-mail-folders.png" });
  await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新建文件夹", exact: true });
  await editor.getByRole("textbox", { name: "文件夹名称", exact: true }).fill("项目通知");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "打开文件夹 未分组", exact: true }).click();
  await page.getByRole("checkbox", { name: "全选", exact: true }).check();
  await chooseOption(
    page,
    page.getByRole("combobox", { name: "移动到文件夹", exact: true }),
    "项目通知",
  );
  await page.getByText("没有匹配的邮箱。", { exact: true }).waitFor();
  const snapshot = await page.evaluate(() => window.sinan.store.load());
  const folder = snapshot.state.mailFolders.find((item) => item.name === "项目通知");
  assert.equal(snapshot.state.mailboxes.filter((item) => item.folderId === folder.id).length, 2);
  await page.getByRole("button", { name: "返回文件夹", exact: true }).click();
  await page.getByRole("button", { name: "打开文件夹 工作邮箱", exact: true }).click();
  await page.locator('[data-mailbox-id="mail-0"]').getByRole("button").first().click();
  const reader = page.getByRole("dialog", { name: "account0@example.test", exact: true });
  await reader.getByRole("button", { name: "查看邮件 Weekly delivery", exact: true }).click();
  await reader.getByText(/Private weekly delivery body/).waitFor();
  await reader.getByRole("button", { name: "标为已读", exact: true }).click();
  assert.ok(await reader.getByRole("combobox", { name: "邮件文件夹", exact: true }).isDisabled());
  await reader.getByRole("button", { name: "标为未读", exact: true }).waitFor();
  await page.screenshot({ path: "screenshots/nanpad-v050-mail-reader.png" });
  await reader.getByRole("button", { name: "回复", exact: true }).click();
  assert.equal(
    await reader.getByRole("textbox", { name: "收件人", exact: true }).inputValue(),
    "team@example.test",
  );
  await reader
    .getByRole("textbox", { name: "邮件正文", exact: true })
    .fill("Private draft for integration verification");
  await reader.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.getByText("草稿已加密保存", { exact: true }).waitFor();
  const persisted = await readFile(join(directory, "assets.json"), "utf8");
  const encrypted = await readFile(join(directory, "vault.enc"), "utf8");
  assert.ok(!persisted.includes("Private draft"));
  assert.ok(!encrypted.includes("Private draft"));
  await reader.getByRole("button", { name: "发送", exact: true }).click();
  assert.equal(await instance.evaluate(() => globalThis.mailUiTestSent.length), 0);
  await reader.getByRole("button", { name: "确认发送", exact: true }).click();
  await page.getByText("邮件已提交给 SMTP 服务器", { exact: true }).waitFor();
  assert.equal(await instance.evaluate(() => globalThis.mailUiTestSent.length), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("邮件已提交给 SMTP 服务器", { exact: true }).waitFor({ state: "hidden" });
  await page.screenshot({ path: "screenshots/nanpad-v050-mail-reader-mobile.png" });
  await reader.getByRole("button", { name: "写邮件", exact: true }).click();
  const sendBox = await reader.getByRole("button", { name: "发送", exact: true }).boundingBox();
  assert.ok(sendBox && sendBox.y >= 0 && sendBox.y + sendBox.height <= 844);
  await page.screenshot({ path: "screenshots/nanpad-v050-mail-compose-mobile.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.evaluate(() => window.sinan.vault.lock());
  await reader.waitFor({ state: "detached" });
  assert.equal(await page.getByText(/Private weekly delivery body/).count(), 0);
  await page.getByRole("button", { name: "返回文件夹", exact: true }).click();
  await page.screenshot({ path: "screenshots/nanpad-v050-mail-folders-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.reload();
  await page.getByRole("button", { name: "邮箱", exact: true }).click();
  await page.getByRole("button", { name: "打开文件夹 项目通知", exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
  console.log(
    JSON.stringify({
      ok: true,
      collapsedFolders: true,
      createAndMove: true,
      readMessage: true,
      markRead: true,
      reply: true,
      encryptedDraft: true,
      explicitSendConfirmation: true,
      mailNetworkBoundary: "IPC fixture",
      lockClearsReader: true,
      mobileOverflow: false,
      reloadPersistence: true,
      pageErrors,
    }),
  );
} finally {
  if (instance) await instance.close();
  await rm(directory, { recursive: true, force: true });
}
