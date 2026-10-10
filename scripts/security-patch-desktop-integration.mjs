import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { _electron as electron } from "playwright";
import { completeOnboarding } from "./onboarding-helper.mjs";

// 只使用合成配置与隔离资料目录，不修改用户的密钥库或系统剪贴板内容。
const directory = await mkdtemp(join(tmpdir(), "zhiyu-security-patch-"));
const packaged = process.argv[2];
const env = { ...process.env, NANPAD_TEST_DATA_DIR: directory };
if (packaged) delete env.NANPAD_TEST_DATA_DIR;
delete env.ELECTRON_RUN_AS_NODE;
delete env.SINAN_DEV_URL;
let instance;
let page;
try {
  await writeFile(
    join(directory, "local-usage.json"),
    JSON.stringify({ version: 1, enabled: false, events: [], checkpoints: [], records: [] }),
  );
  await writeFile(
    join(directory, "preferences.json"),
    JSON.stringify({ locale: "zh", closeToTray: false, notifications: false }),
  );
  instance = await electron.launch({
    ...(packaged ? { executablePath: resolve(packaged) } : {}),
    args: packaged ? [`--user-data-dir=${directory}`] : [resolve("electron/main.mjs")],
    env,
    locale: "zh-CN",
    timeout: 45000,
  });
  assert.equal(await instance.evaluate(({ app }) => app.getPath("userData")), directory);
  page = await instance.firstWindow();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await completeOnboarding(page);
  await page.locator('[data-app-ready="true"]').waitFor();

  const permissions = await page.evaluate(async () =>
    Object.fromEntries(
      await Promise.all(
        [
          "clipboard-read",
          "clipboard-write",
          "camera",
          "microphone",
          "geolocation",
          "notifications",
        ].map(async (name) => [name, (await navigator.permissions.query({ name })).state]),
      ),
    ),
  );
  assert.deepEqual(permissions, {
    "clipboard-read": "granted",
    "clipboard-write": "granted",
    camera: "denied",
    microphone: "denied",
    geolocation: "denied",
    notifications: "denied",
  });
  const geolocation = await page.evaluate(
    () =>
      new Promise((resolveResult) =>
        navigator.geolocation.getCurrentPosition(
          () => resolveResult("unexpected-success"),
          (error) => resolveResult(error.code),
          { timeout: 3000 },
        ),
      ),
  );
  assert.equal(geolocation, 1);
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  for (const directive of ["object-src 'none'", "base-uri 'self'", "form-action 'none'"])
    assert.ok(csp.includes(directive));

  // Electron 原生选择器返回合成文件，页面与 IPC 保持真实实现。
  async function selectFile(path) {
    await instance.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: path === null,
        filePaths: path === null ? [] : [path],
      });
    }, path);
  }
  const sidebar = page.locator("aside.app-sidebar:visible");
  await sidebar.getByRole("button", { name: "邮箱", exact: true }).click();
  await page.keyboard.press("Control+n");
  await page.getByRole("button", { name: /快捷登录/ }).click();
  const pick = page.getByRole("button", { name: "选择客户端 JSON", exact: true });
  await pick.waitFor();
  const file = join(directory, "client.json");
  await writeFile(
    file,
    JSON.stringify({
      installed: { client_id: "fixture-client", client_secret: "synthetic-private-client" },
    }),
  );
  await selectFile(file);
  await pick.click();
  await page.getByText("已读取客户端配置，保存后即可登录", { exact: true }).waitFor();
  const client = page.getByRole("dialog").locator("input").filter({ visible: true });
  assert.ok(
    (await client.evaluateAll((inputs) => inputs.map((input) => input.value))).includes(
      "fixture-client",
    ),
  );
  for (const content of [
    " ".repeat(256 * 1024 + 1),
    '{"client_secret":"synthetic-private-client"',
  ]) {
    await writeFile(file, content);
    await pick.click();
    await page
      .getByText("无法读取客户端配置，请选择不超过 256 KB 的有效 JSON 文件。", { exact: true })
      .last()
      .waitFor();
    assert.ok(
      (await client.evaluateAll((inputs) => inputs.map((input) => input.value))).includes(
        "fixture-client",
      ),
    );
    assert.equal(
      (await page.locator("body").innerText()).includes("synthetic-private-client"),
      false,
    );
  }
  await writeFile(file, JSON.stringify({ installed: { client_id: { malformed: true } } }));
  await pick.click();
  await page
    .getByText("这个 JSON 里没有有效的 client_id 或 client_secret", { exact: true })
    .waitFor();
  await selectFile(null);
  assert.equal(await page.evaluate(() => window.sinan.pickJson()), null);
  await pick.click();
  assert.ok(
    (await client.evaluateAll((inputs) => inputs.map((input) => input.value))).includes(
      "fixture-client",
    ),
  );
  await mkdir("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/security-patch-oauth-desktop.png" });
  assert.deepEqual(errors, []);
  const vault = JSON.parse(await readFile(join(directory, "vault.enc"), "utf8"));
  assert.equal(vault.v, 2);
  assert.deepEqual(vault.kdf, { N: 131072, r: 8, p: 1 });
  console.log(
    "安全补丁桌面集成通过：权限白名单、定位请求拒绝、打包 CSP、JSON 成功/超限/格式错误/取消、无凭据回显、新建 v2 密钥库。",
  );
} catch (error) {
  await page?.screenshot({ path: "screenshots/security-patch-failure.png" }).catch(() => {});
  throw error;
} finally {
  await instance?.close();
  await rm(directory, { recursive: true, force: true });
}
