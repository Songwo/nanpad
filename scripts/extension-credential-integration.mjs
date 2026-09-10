import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";
import { completeOnboarding } from "./onboarding-helper.mjs";

const directory = await mkdtemp(join(tmpdir(), "nanpad-credential-capture-"));
const origin = `chrome-extension://${"a".repeat(32)}`;
const secret = "isolated-browser-fixture-password-2026";
const errors = [];
let instance;
try {
  const packagedPath = process.argv[2];
  const env = { ...process.env, NANPAD_TEST_DATA_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SINAN_DEV_URL;
  if (packagedPath) delete env.NANPAD_TEST_DATA_DIR;
  instance = await electron.launch({
    ...(packagedPath
      ? {
          executablePath: resolve(packagedPath),
          args: [`--user-data-dir=${directory}`],
        }
      : { args: [resolve("electron/main.mjs")] }),
    env,
    timeout: 45000,
  });
  const actual = await instance.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    directory: app.getPath("userData"),
  }));
  assert.equal(actual.directory, directory);
  assert.equal(actual.packaged, Boolean(packagedPath));
  const page = await instance.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await completeOnboarding(page);
  await page.locator('[data-app-ready="true"]').waitFor();
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await settings.getByRole("button", { name: "浏览器插件", exact: true }).click();
  await settings.getByRole("button", { name: "生成配对码", exact: true }).click();
  const pairingCode = await settings.getByLabel("配对码", { exact: true }).inputValue();
  assert.match(pairingCode, /^[a-f0-9]{64}$/);
  const { port } = await page.evaluate(() => window.sinan.extension.status());
  assert.notEqual(port, 47832);
  const request = async (path, body, token) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(7000),
    });
    return { status: response.status, data: await response.json() };
  };
  let paired = await request("/v1/pair", { code: pairingCode });
  assert.equal(paired.status, 200);
  let token = paired.data.token;
  await settings.getByLabel("配对码", { exact: true }).waitFor({ state: "detached" });
  await settings.getByRole("button", { name: "生成配对码", exact: true }).click();
  const stillValidCode = await settings.getByLabel("配对码", { exact: true }).inputValue();
  const extra = await request(
    "/v1/captures",
    {
      url: "https://queue.fixture.test",
      title: "配对期间的队列变化",
      username: "queue-fixture",
      password: secret,
    },
    token,
  );
  assert.equal(extra.status, 201);
  await page.waitForFunction(
    async () => (await window.sinan.extension.status()).pendingCount === 1,
  );
  await page.evaluate((id) => window.sinan.extension.discard(id), extra.data.id);
  assert.equal(await settings.getByLabel("配对码", { exact: true }).inputValue(), stillValidCode);
  const renewed = await request("/v1/pair", { code: stillValidCode });
  assert.equal(renewed.status, 200);
  token = renewed.data.token;
  await settings.getByLabel("配对码", { exact: true }).waitFor({ state: "detached" });
  await page.screenshot({ path: "screenshots/nanpad-v070-extension-settings.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "screenshots/nanpad-v070-extension-settings-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  await settings.waitFor({ state: "detached" });

  const payload = {
    url: "https://fixture.test/reset/private-token?secret=private#private",
    title: "浏览器本地保存验证",
    username: "reader@fixture.test",
    password: secret,
  };
  const captured = await request("/v1/captures", payload, token);
  assert.equal(captured.status, 201);
  const pending = await page.evaluate(() => window.sinan.extension.list());
  assert.equal(pending.length, 1);
  assert.equal(pending[0].url, "https://fixture.test/");
  assert.ok(!JSON.stringify(pending).includes(secret));
  assert.equal((await page.evaluate(() => window.sinan.vault.list())).length, 0);
  await page.getByRole("button", { name: "核对账号并保存", exact: true }).click();
  let composer = page.getByRole("dialog", { name: "密钥", exact: true });
  assert.equal(await composer.getByLabel("账号", { exact: true }).inputValue(), payload.username);
  assert.equal(await composer.getByLabel("密码", { exact: true }).inputValue(), secret);
  assert.equal(await composer.getByLabel("密码", { exact: true }).getAttribute("type"), "password");
  await page.screenshot({ path: "screenshots/nanpad-v070-extension-review.png" });
  await composer.getByRole("button", { name: "添加", exact: true }).click();
  await composer.waitFor({ state: "detached" });
  const saved = await page.evaluate(() => window.sinan.store.load());
  const website = saved.state.secrets.find((item) => item.name === payload.title);
  assert.ok(website);
  assert.ok(!JSON.stringify(saved).includes(secret));
  assert.ok(!JSON.stringify(saved).includes(payload.username));
  assert.ok(!JSON.stringify(saved).includes("private-token"));
  const credential = await page.evaluate(
    (id) => window.sinan.vault.get(`account:${id}`),
    website.id,
  );
  assert.equal(credential.password, secret);
  assert.equal(credential.url, "https://fixture.test/");
  const assetsFile = await readFile(join(directory, "assets.json"), "utf8");
  assert.ok(!assetsFile.includes(secret));
  const vaultFile = await readFile(join(directory, "vault.enc"), "utf8");
  assert.ok(!vaultFile.includes(secret));

  assert.equal(
    (await request("/v1/captures", { ...payload, title: "锁库清理验证" }, token)).status,
    201,
  );
  await page.getByRole("button", { name: "核对账号并保存", exact: true }).click();
  composer = page.getByRole("dialog", { name: "密钥", exact: true });
  await composer.waitFor();
  assert.equal(
    (await request("/v1/captures", { ...payload, title: "锁库清理队列" }, token)).status,
    201,
  );
  await page.evaluate(() => window.sinan.vault.lock());
  await composer.waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => window.sinan.extension.list()), []);
  assert.ok([401, 423].includes((await request("/v1/status", {}, token)).status));
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  await page.evaluate(() => window.sinan.vault.unlock("integration-master-2026"));
  paired = await page.evaluate(() => window.sinan.extension.beginPairing());
  token = (await request("/v1/pair", { code: paired.code })).data.token;
  await page.reload();
  await page.locator('[data-app-ready="true"]').waitFor();
  assert.equal(await page.getByRole("dialog", { name: "密钥", exact: true }).count(), 0);
  assert.equal((await page.evaluate(() => window.sinan.store.load())).state.secrets.length, 1);
  assert.equal(
    (await request("/v1/captures", { ...payload, title: "取消保存验证" }, token)).status,
    201,
  );
  await page.getByRole("button", { name: "核对账号并保存", exact: true }).click();
  composer = page.getByRole("dialog", { name: "密钥", exact: true });
  await composer.getByRole("button", { name: "取消", exact: true }).click();
  await composer.waitFor({ state: "detached" });
  assert.equal((await page.evaluate(() => window.sinan.vault.list())).length, 1);
  assert.equal((await page.evaluate(() => window.sinan.store.load())).state.secrets.length, 1);
  await page.evaluate(() => window.sinan.extension.revoke());
  assert.equal((await request("/v1/status", {}, token)).status, 401);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      packaged: actual.packaged,
      pairingUI: true,
      authenticatedLoopback: true,
      explicitSave: true,
      encryptedCredential: true,
      sensitiveSnapshotExcluded: true,
      lockedQueueAndComposerCleared: true,
      revokedTokenRejected: true,
      canceledSaveExcluded: true,
      mobileOverflow: false,
      pageErrors: errors,
    }),
  );
} finally {
  await instance?.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
