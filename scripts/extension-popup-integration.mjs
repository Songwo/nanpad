import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir, cp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { ExtensionBridge } from "../electron/services/extension-bridge.mjs";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const builtExtension = resolve(`release/v${version}/nanpad-browser-extension`);
const directory = await mkdtemp(join(tmpdir(), "nanpad-extension-browser-"));
const extension = join(directory, "extension");
const fixture = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(
    '<!doctype html><title>示例网站</title><form><input autocomplete="username" value="work@example.test"><input type="password" value=" fixture-password "></form><form><input type="email" value="personal@example.test"><input type="password" value="second-password"></form>',
  );
});
let context;
let unlocked = true;
const bridge = new ExtensionBridge({ isUnlocked: () => unlocked, port: 0 });
const pageErrors = [];
const requests = [];
try {
  await new Promise((done) => fixture.listen(0, "127.0.0.1", done));
  const fixtureBase = `http://127.0.0.1:${fixture.address().port}`;
  const status = await bridge.start();
  assert.equal(status.running, true, status.error || "fixture bridge did not start");
  const bridgeBase = `http://127.0.0.1:${status.port}`;
  await cp(builtExtension, extension, { recursive: true });
  const bridgeConfig = await readFile(join(extension, "bridge-config.mjs"), "utf8");
  assert.equal(bridgeConfig.split('export const BRIDGE = "http://127.0.0.1:47832";').length, 2);
  // 隔离测试只改本机端口（弹窗与后台服务共用此常量），真实扩展权限、来源、表单注入和 HTTP 行为保持不变。
  await writeFile(
    join(extension, "bridge-config.mjs"),
    bridgeConfig.replace(
      'export const BRIDGE = "http://127.0.0.1:47832";',
      `export const BRIDGE = "${bridgeBase}";`,
    ),
  );
  context = await chromium.launchPersistentContext(join(directory, "profile"), {
    headless: true,
    ...(process.env.NANPAD_EXTENSION_BROWSER_PATH
      ? { executablePath: process.env.NANPAD_EXTENSION_BROWSER_PATH }
      : { channel: "chromium" }),
    args: ["--enable-unsafe-extension-debugging"],
    ignoreDefaultArgs: ["--disable-extensions"],
    viewport: { width: 380, height: 600 },
  });
  const session = await context.browser().newBrowserCDPSession();
  const { id } = await session.send("Extensions.loadUnpacked", { path: extension });
  assert.match(id, /^[a-p]{32}$/);
  const website = await context.newPage();
  await website.goto(`${fixtureBase}/reset/secret-path?token=private#private`);
  const popup = await context.newPage();
  popup.on("pageerror", (error) => pageErrors.push(error.message));
  popup.on("request", (request) => {
    if (!request.url().startsWith(`${bridgeBase}/`)) return;
    requests.push({ method: request.method(), pathname: new URL(request.url()).pathname });
  });
  // 测试以标签页打开 popup，仅固定活动标签；注入、存储、HTTP 均使用真实扩展 API。
  await popup.addInitScript((base) => {
    const query = globalThis.chrome.tabs.query.bind(globalThis.chrome.tabs);
    globalThis.chrome.tabs.query = async () =>
      (await query({})).filter((tab) => tab.url?.startsWith(base));
  }, fixtureBase);
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator("#capture-hint").filter({ hasText: "已读取 2 个表单" }).waitFor();
  await popup
    .getByLabel("账号", { exact: true })
    .inputValue()
    .then((value) => assert.equal(value, "work@example.test"));
  assert.equal(await popup.getByLabel("密码", { exact: true }).inputValue(), " fixture-password ");
  assert.equal(await popup.getByLabel("密码", { exact: true }).getAttribute("type"), "password");
  assert.equal(await popup.getByRole("radio").count(), 2);
  await popup.getByRole("radio").nth(1).check();
  assert.equal(
    await popup.getByLabel("账号", { exact: true }).inputValue(),
    "personal@example.test",
  );
  assert.equal(await popup.getByLabel("密码", { exact: true }).inputValue(), "second-password");
  await popup.getByRole("button", { name: "显示密码", exact: true }).click();
  assert.equal(await popup.getByLabel("密码", { exact: true }).getAttribute("type"), "text");
  await popup.getByRole("radio").first().check();
  assert.equal(await popup.getByLabel("密码", { exact: true }).getAttribute("type"), "password");
  assert.equal(bridge.list().length, 0);
  await mkdir("screenshots", { recursive: true });
  await popup.screenshot({ path: "screenshots/nanpad-v080-extension-pair.png", fullPage: true });
  await popup.getByLabel("桌面配对码").fill(bridge.beginPairing().code);
  await popup.getByRole("button", { name: "连接", exact: true }).click();
  try {
    await popup.getByText("已连接本机司南", { exact: true }).waitFor({ timeout: 10000 });
  } catch (error) {
    console.error(
      JSON.stringify({
        status: await popup.locator("#status").textContent(),
        connection: await popup.locator("#connection-state").textContent(),
        requests,
        pageErrors,
      }),
    );
    throw error;
  }
  assert.equal(await popup.getByLabel("桌面配对码").inputValue(), "");
  const stored = await popup.evaluate(async () => ({
    session: await globalThis.chrome.storage.session.get(null),
    local: await globalThis.chrome.storage.local.get(null),
    sync: await globalThis.chrome.storage.sync.get(null),
  }));
  assert.deepEqual(Object.keys(stored.session), ["nanpadConnectionToken"]);
  assert.deepEqual(stored.local, {});
  assert.deepEqual(stored.sync, {});
  assert.ok(!JSON.stringify(stored).includes("fixture-password"));
  await popup.reload();
  await popup.getByText("已连接本机司南", { exact: true }).waitFor();
  await popup.locator("#capture-hint").filter({ hasText: "已读取 2 个表单" }).waitFor();
  assert.equal(bridge.list().length, 0);
  await popup.getByRole("button", { name: "发送到司南", exact: true }).click();
  await popup.getByRole("status").filter({ hasText: "已送达司南" }).waitFor();
  assert.equal(await popup.getByLabel("密码", { exact: true }).inputValue(), "");
  const [item] = bridge.list();
  assert.equal(item.url, `${fixtureBase}/`);
  assert.ok(!JSON.stringify(item).includes("fixture-password"));
  const credential = bridge.take(item.id);
  assert.equal(credential.password, " fixture-password ");
  assert.equal(credential.username, "work@example.test");
  assert.ok(!credential.url.includes("private"));
  await popup.screenshot({ path: "screenshots/nanpad-v080-extension-ready.png", fullPage: true });
  await popup.emulateMedia({ colorScheme: "dark" });
  await popup.screenshot({
    path: "screenshots/nanpad-v080-extension-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.ok(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(
    await popup
      .locator("img")
      .evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)),
    true,
  );
  await popup.getByLabel("密码", { exact: true }).fill("retained-on-failure");
  bridge.revoke();
  await popup.getByRole("button", { name: "发送到司南", exact: true }).click();
  await popup.getByRole("status").filter({ hasText: "生成新的配对码" }).waitFor();
  assert.equal(await popup.getByLabel("密码", { exact: true }).inputValue(), "retained-on-failure");
  assert.deepEqual(await popup.evaluate(() => globalThis.chrome.storage.session.get(null)), {});
  assert.equal(bridge.list().length, 0);
  // —— 自动采集：重新配对后打开开关，提交登录表单即送达（source=auto，页面有提示）。 ——
  await popup.getByLabel("桌面配对码").fill(bridge.beginPairing().code);
  await popup.getByRole("button", { name: "连接", exact: true }).click();
  await popup.getByText("已连接本机司南", { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await popup.getByLabel("登录时自动采集").isChecked(), false);
  await popup.getByLabel("登录时自动采集").check();
  assert.deepEqual(await popup.evaluate(() => globalThis.chrome.storage.local.get(null)), {
    nanpadAutoCapture: true,
  });
  await website.evaluate(() => {
    document
      .querySelector("form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const [auto] = bridge.list();
  assert.equal(auto.source, "auto");
  assert.equal(auto.url, `${fixtureBase}/`);
  const autoCredential = bridge.take(auto.id);
  assert.equal(autoCredential.username, "work@example.test");
  assert.equal(autoCredential.password, " fixture-password ");
  assert.ok(
    await website.evaluate(() =>
      [...document.documentElement.children].some(
        (el) => el.tagName === "DIV" && el.style.position === "fixed",
      ),
    ),
    "自动采集后页面应出现结果提示",
  );
  // 请求计数只覆盖弹窗上下文：自动采集由后台服务发出，不经此监听器；
  // 其送达证据是上面的桥接队列（source=auto + 一次性取出凭据一致）。
  assert.equal(requests.filter((request) => request.pathname === "/v1/captures").length, 2);
  assert.equal(requests.filter((request) => request.pathname === "/v1/status").length, 3);
  assert.ok(requests.every((request) => request.method === "POST"));
  unlocked = false;
  bridge.revoke();
  assert.deepEqual(pageErrors, []);
  console.log(
    JSON.stringify({
      version,
      realManifestV3: true,
      actualFormInjection: true,
      actualPairingAndCapture: true,
      sessionReconnect: true,
      credentialStorageUnused: true,
      maskAndSelection: true,
      expiredTokenCleared: true,
      autoCaptureRelay: true,
      automaticRetry: false,
      imagesLoaded: true,
      pageErrors,
    }),
  );
} finally {
  await context?.close();
  await bridge.stop();
  await new Promise((done) => fixture.close(done));
  await rm(directory, { recursive: true, force: true });
}
