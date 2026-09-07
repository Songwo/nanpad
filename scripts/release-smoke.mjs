import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { _electron as electron } from "playwright";
import { completeOnboarding } from "./onboarding-helper.mjs";

const directory = await mkdtemp(join(tmpdir(), "nanpad-packaged-"));
let instance;
try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SINAN_DEV_URL;
  delete env.NANPAD_TEST_DATA_DIR;
  instance = await electron.launch({ executablePath: resolve(process.argv[2] ?? "release/win-unpacked/Nanpad.exe"), args: [`--user-data-dir=${directory}`], env, timeout: 45000 });
  const actual = await instance.evaluate(({ app }) => ({ path: app.getPath("userData"), packaged: app.isPackaged, version: app.getVersion() }));
  assert.equal(actual.path, directory, "打包验证必须使用隔离数据目录");
  assert.equal(actual.packaged, true);
  assert.equal(actual.version, JSON.parse(await readFile("package.json", "utf8")).version);
  const page = await instance.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await completeOnboarding(page);
  await page.getByText("桌面验证用户", { exact: true }).waitFor();
  await page.getByRole("button", { name: "问答", exact: true }).click();
  await page.getByRole("button", { name: "模型与知识库", exact: true }).click();
  assert.deepEqual(await page.getByRole("combobox", { name: "授权服务商" }).locator("option").allTextContents(), ["OpenAI / ChatGPT", "Anthropic / Claude", "xAI / Grok", "Google / Gemini"]);
  await page.getByRole("combobox", { name: "授权服务商" }).selectOption("grok");
  await page.getByRole("button", { name: "网页登录授权" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "screenshots/nanpad-ai-accounts.png" });
  await page.getByRole("combobox", { name: "授权服务商" }).selectOption("gemini");
  assert.equal(await page.getByRole("combobox", { name: "授权服务商" }).inputValue(), "gemini");
  assert.equal(await page.getByRole("button", { name: "添加演示数据" }).count(), 0);
  assert.equal(await page.evaluate(async () => { try { await window.sinan.store.addDemo(); return false; } catch { return true; } }), true);
  await page.reload();
  await page.getByText("桌面验证用户", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "首次设置" }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, version: actual.version, packaged: true, isolated: true, providers: 4, onboarding: true, restart: true, productionDemoDisabled: true, pageErrors: errors }));
} finally {
  await instance?.close();
  await rm(directory, { recursive: true, force: true });
}
