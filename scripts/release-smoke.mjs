import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { _electron as electron } from "playwright";
import { completeOnboarding } from "./onboarding-helper.mjs";
import { chooseOption, verifyOptions } from "./select-helper.mjs";

const directory = await mkdtemp(join(tmpdir(), "nanpad-packaged-"));
let instance;
try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SINAN_DEV_URL;
  delete env.NANPAD_TEST_DATA_DIR;
  instance = await electron.launch({
    executablePath: resolve(process.argv[2] ?? "release/win-unpacked/Nanpad.exe"),
    args: [`--user-data-dir=${directory}`, "nanpad://capture?url=https%3A%2F%2Frelease.example.test%2Flogin%3Ftoken%3Dprivate&title=Release"],
    env,
    timeout: 45000,
  });
  const actual = await instance.evaluate(({ app }) => ({
    path: app.getPath("userData"),
    packaged: app.isPackaged,
    version: app.getVersion(),
  }));
  assert.equal(actual.path, directory, "打包验证必须使用隔离数据目录");
  assert.equal(actual.packaged, true);
  assert.equal(actual.version, JSON.parse(await readFile("package.json", "utf8")).version);
  const page = await instance.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await completeOnboarding(page);
  assert.equal((await page.evaluate(() => window.sinan.capture.list()))[0].url, "https://release.example.test/");
  await page.getByRole("button", { name: "忽略网站", exact: true }).click();
  await page.getByText("桌面验证用户", { exact: true }).waitFor();
  await page.getByRole("button", { name: "问答", exact: true }).click();
  await page.getByRole("button", { name: "模型与知识库", exact: true }).click();
  await verifyOptions(page, page.getByRole("combobox", { name: "授权服务商" }), [
    "OpenAI / ChatGPT",
    "Anthropic / Claude",
    "xAI / Grok",
    "Google / Gemini",
  ]);
  await chooseOption(page, page.getByRole("combobox", { name: "授权服务商" }), "xAI / Grok");
  await page.getByRole("button", { name: "网页登录授权" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "screenshots/nanpad-ai-accounts.png" });
  await chooseOption(page, page.getByRole("combobox", { name: "授权服务商" }), "Google / Gemini");
  assert.equal(
    await page.getByRole("combobox", { name: "授权服务商" }).textContent(),
    "Google / Gemini",
  );
  assert.equal(await page.getByRole("button", { name: "添加演示数据" }).count(), 0);
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.sinan.store.addDemo();
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  await page.reload();
  await page.getByText("桌面验证用户", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "首次设置" }).count(), 0);
  await page.getByRole("button", { name: "AI 订阅", exact: true }).click();
  await page.getByRole("button", { name: "添加资产", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "添加 AI 订阅", exact: true });
  assert.equal(
    await composer
      .getByRole("tab", { name: "快速登录", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await composer.getByLabel("名称", { exact: true }).count(), 0);
  await verifyOptions(page, composer.getByRole("combobox", { name: "授权服务商" }), [
    "OpenAI / ChatGPT",
    "Anthropic / Claude",
    "xAI / Grok",
    "Google / Gemini",
  ]);
  await chooseOption(page, composer.getByRole("combobox", { name: "授权服务商" }), "xAI / Grok");
  await page.waitForFunction(() => {
    const panel = document.querySelector('[role="dialog"][aria-label="添加 AI 订阅"]');
    return panel?.getAttribute("data-shown") === "true" && getComputedStyle(panel).opacity === "1";
  });
  await page.screenshot({ path: "screenshots/nanpad-packaged-ai-login.png" });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      version: actual.version,
      packaged: true,
      isolated: true,
      providers: 4,
      onboarding: true,
      restart: true,
      productionDemoDisabled: true,
      pageErrors: errors,
    }),
  );
} finally {
  await instance?.close();
  await rm(directory, { recursive: true, force: true });
}
