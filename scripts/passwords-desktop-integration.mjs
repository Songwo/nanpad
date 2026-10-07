import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { _electron as electron } from "playwright";
import { completeOnboarding } from "./onboarding-helper.mjs";

const directory = await mkdtemp(join(tmpdir(), "zhiyu-passwords-desktop-"));
const input = join(directory, "synthetic-input.csv");
const outputDirectory = await mkdtemp(join(tmpdir(), "zhiyu-passwords-export-"));
const output = join(outputDirectory, "synthetic-export.csv");
const secret = "synthetic-password-unique-2026";
await writeFile(
  input,
  `name,url,username,password\nExample,https://example.test/login,alice,${secret}\nExample,https://example.test/login,bob,another-test-password\nExample,https://example.test/login,alice,${secret}\nExample,https://example.test/login,alice,conflicting-password\n`,
);
const env = { ...process.env, NANPAD_TEST_DATA_DIR: directory };
const packaged = process.argv[2];
if (packaged) delete env.NANPAD_TEST_DATA_DIR;
delete env.ELECTRON_RUN_AS_NODE;
delete env.SINAN_DEV_URL;
let instance;
let page;
function post(port, route, body, token) {
  return new Promise((resolveResponse, reject) => {
    const data = JSON.stringify(body);
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path: route,
        method: "POST",
        headers: {
          Origin: `chrome-extension://${"a".repeat(32)}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolveResponse({ status: res.statusCode, body: JSON.parse(data) }));
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}
try {
  instance = await electron.launch({
    ...(packaged ? { executablePath: resolve(packaged) } : {}),
    args: packaged ? [`--user-data-dir=${directory}`] : [resolve("electron/main.mjs")],
    env,
    timeout: 45000,
  });
  assert.equal(await instance.evaluate(({ app }) => app.getPath("userData")), directory);
  page = await instance.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await completeOnboarding(page);
  await page.locator('[data-app-ready="true"]').waitFor();
  await instance.evaluate(
    ({ dialog }, { input, output }) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] });
      dialog.showMessageBox = async () => ({ response: 1 });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
    },
    { input, output },
  );
  const before = await page.evaluate(() => window.sinan.store.load());
  const preview = await page.evaluate(() => window.sinan.passwords.previewImport());
  assert.equal(preview.added, 2);
  assert.equal(preview.duplicates, 1);
  assert.equal(preview.conflicts, 1);
  assert.equal(JSON.stringify(preview).includes(secret), false);
  const result = await page.evaluate(
    (ticket) => window.sinan.passwords.commitImport(ticket),
    preview.ticket,
  );
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 2);
  // 模拟仍未收到后台新增事件的旧快照保存，不能抹掉导入账号。
  await page.evaluate((snapshot) => window.sinan.store.save(snapshot), before);
  let snapshot = await page.evaluate(() => window.sinan.store.load());
  assert.equal(snapshot.state.secrets.length, 2);
  const rawAssets = await readFile(join(directory, "assets.json"), "utf8");
  const rawVault = await readFile(join(directory, "vault.enc"), "utf8");
  for (const raw of [rawAssets, rawVault]) assert.equal(raw.includes(secret), false);
  assert.equal(rawAssets.includes("alice"), false);
  assert.equal((await page.evaluate(() => window.sinan.passwords.exportCsv())).count, 2);
  assert.equal((await readFile(output, "utf8")).includes(secret), true);
  const pairing = await page.evaluate(() => window.sinan.extension.beginPairing());
  const pair = await post(pairing.port, "/v1/pair", { code: pairing.code });
  const token = pair.body.token;
  const list = await post(
    pairing.port,
    "/v1/accounts/list",
    { url: "https://example.test/login" },
    token,
  );
  assert.equal(list.body.accounts.length, 2);
  const alice = list.body.accounts.find((item) => item.username === "alice");
  const fill = await post(
    pairing.port,
    "/v1/accounts/fill",
    { url: "https://example.test/", id: alice.id, selectionToken: list.body.selectionToken },
    token,
  );
  assert.equal(fill.body.password, secret);
  const saved = await post(
    pairing.port,
    "/v1/accounts/save",
    {
      url: "https://example.test/",
      title: "Example",
      username: "carol",
      password: "test-carol-password",
    },
    token,
  );
  assert.equal(saved.status, 201);
  snapshot = await page.evaluate(() => window.sinan.store.load());
  assert.equal(snapshot.state.secrets.length, 3);
  const doc = await post(
    pairing.port,
    "/v1/documents",
    {
      url: "https://docs.qq.com/doc/synthetic",
      title: "浏览器文档回归",
      text: "本机合成正文\n\n仅供验证",
    },
    token,
  );
  assert.equal(doc.status, 201);
  const documents = await page.evaluate(() => window.sinan.documents.list());
  assert.equal(documents.find((item) => item.id === doc.body.id).title, "浏览器文档回归");
  const repeat = await post(
    pairing.port,
    "/v1/documents",
    { url: "https://docs.qq.com/doc/synthetic", title: "不会覆盖", text: "不会覆盖" },
    token,
  );
  assert.equal(repeat.body.status, "existing");
  const ticket = await page.evaluate(() => window.sinan.passwords.previewImport());
  await page.evaluate(() => window.sinan.vault.lock());
  assert.equal(
    (await post(pairing.port, "/v1/accounts/list", { url: "https://example.test/" }, token)).status,
    423,
  );
  await assert.rejects(
    page.evaluate((ticket) => window.sinan.passwords.commitImport(ticket), ticket.ticket),
  );
  await page.evaluate(() => window.sinan.vault.unlock("integration-master-2026"));
  await assert.rejects(
    page.evaluate((ticket) => window.sinan.passwords.commitImport(ticket), ticket.ticket),
  );
  // 删除加密记录后，后台合并不得复活已经删除的账号。
  await page.evaluate((id) => window.sinan.vault.remove("account:" + id), alice.id);
  snapshot.state.secrets = snapshot.state.secrets.filter((item) => item.id !== alice.id);
  await page.evaluate((snapshot) => window.sinan.store.save(snapshot), snapshot);
  assert.equal(
    (await page.evaluate(() => window.sinan.store.load())).state.secrets.some(
      (item) => item.id === alice.id,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "密码迁移桌面集成通过：真实 CSV 导入导出、主进程 IPC、同站多账号、后台保存、旧快照合并、文档快照、锁库和删除回归。",
  );
} catch (error) {
  await page?.screenshot({ path: "screenshots/passwords-desktop-failure.png" }).catch(() => {});
  throw error;
} finally {
  await instance?.close();
  await rm(directory, { recursive: true, force: true });
  await rm(outputDirectory, { recursive: true, force: true });
}
