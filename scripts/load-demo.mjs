import { _electron as electron } from "playwright";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

// 显式参数才操作日常数据；使用与「添加演示数据」按钮相同的追加接口。
if (!process.argv.includes("--apply")) throw new Error("需要 --apply 才会向日常数据追加演示资产。");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SINAN_DEV_URL;
delete env.NANPAD_TEST_DATA_DIR;
const instance = await electron.launch({ args: [resolve("electron/main.mjs")], env, timeout: 45000 });
try {
  const page = await instance.firstWindow();
  await page.locator('[data-app-ready="true"]').waitFor();
  const counts = await page.evaluate(async () => {
    const state = await window.sinan.store.addDemo();
    const knowledge = await window.sinan.agent.rebuild();
    return { assets: [state.servers, state.domains, state.certs, state.mailboxes, state.aiAssets, state.secrets].reduce((n, rows) => n + rows.length, 0), links: state.links.length, documents: knowledge.documents.length };
  });
  await page.reload();
  await page.locator('[data-app-ready="true"]').waitFor();
  await page.getByRole("button", { name: "表格视图", exact: true }).click();
  await page.locator(".asset-table tbody tr").first().waitFor();
  await mkdir("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/nanpad-demo-loaded.png" });
  console.log(JSON.stringify(counts));
} finally {
  await instance.close();
}
