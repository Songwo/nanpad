import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { _electron as electron } from "playwright";

// 仅用于协议与界面集成测试；从不写入用户配置，也不作为生产模型的替代品。
const directory = await mkdtemp(join(tmpdir(), "nanpad-agent-ui-"));
let instance;
const requests = [];
const service = createServer(async (req, res) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  const body = text ? JSON.parse(text) : {};
  requests.push({ url: req.url, body });
  if (req.url === "/v1/models") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ data: [{ id: "integration-model" }] }));
  }
  if (!body.stream) {
    res.setHeader("Content-Type", "application/json");
    return res.end(
      JSON.stringify({ model: "integration-model", choices: [{ message: { content: "OK" } }] }),
    );
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const write = (choice) => res.write(`data: ${JSON.stringify({ choices: [choice] })}\n\n`);
  if (body.messages.some((m) => m.role === "user" && m.content === "停止测试")) {
    write({ delta: { content: "等待测试取消" } });
    return;
  }
  if (!body.messages.some((m) => m.role === "tool")) {
    write({
      delta: {
        tool_calls: [
          {
            index: 0,
            id: "call-search",
            function: { name: "search_knowledge", arguments: '{"query":"API 高负载处理"}' },
          },
        ],
      },
      finish_reason: "tool_calls",
    });
  } else {
    write({ delta: { content: "## 运行状态\n\n演示环境的 **hk-api-02** CPU 为 84%。\n\n- 检查慢请求\n- 比较节点流量\n\n```bash\nssh example\n```\n\n| 指标 | 数值 |\n| --- | --- |\n| CPU | 84% |\n\n[危险链接](javascript:alert(1)) ![远程图片](https://example.test/track.png)\n\n" } });
    write({
      delta: { content: "请先比较节点流量，再检查慢请求和连接池 [S1]。" },
      finish_reason: "stop",
    });
  }
  res.end("data: [DONE]\n\n");
});
await new Promise((done) => service.listen(0, "127.0.0.1", done));
try {
  const env = { ...process.env, NANPAD_TEST_DATA_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SINAN_DEV_URL;
  instance = await electron.launch({ args: [resolve("electron/main.mjs")], env, timeout: 45000 });
  const page = await instance.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator('[data-app-ready="true"]').waitFor();
  await page.getByRole("textbox", { name: "你的名字", exact: true }).fill("集成测试用户");
  await page.getByRole("textbox", { name: "主密码", exact: true }).fill("integration-master-2026");
  await page.getByRole("textbox", { name: "确认主密码", exact: true }).fill("integration-master-2026");
  await page.screenshot({ path: "screenshots/nanpad-onboarding.png" });
  await page.getByRole("button", { name: "进入司南", exact: true }).click();
  await page.getByRole("dialog", { name: "首次设置" }).waitFor({ state: "detached" });
  const snapshot = await page.evaluate(() => window.sinan.store.addDemo());
  assert.equal(snapshot.servers.length, 6);
  assert.equal(snapshot.links.length, 13);
  await page.evaluate(() => window.sinan.store.addDemo());
  await page.reload();
  await page.locator('[data-app-ready="true"]').waitFor();
  await page.getByRole("button", { name: "问答", exact: true }).click();
  await page.getByRole("button", { name: "模型与知识库", exact: true }).click();
  await page
    .getByRole("textbox", { name: "API Base URL", exact: true })
    .fill(`http://127.0.0.1:${service.address().port}/v1`);
  await page.getByRole("combobox", { name: "模型名称", exact: true }).fill("integration-model");
  await page.getByRole("textbox", { name: "API Key", exact: true }).fill("integration-only-key");
  await page.getByRole("button", { name: "读取模型", exact: true }).click();
  await page.getByText("模型列表已更新", { exact: true }).waitFor();
  assert.ok(!(await readFile(join(directory, "agent-config.json"), "utf8")).includes("integration-only-key"));
  assert.equal((await page.evaluate(() => window.sinan.agent.config())).hasApiKey, true);
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await page.getByText(/真实模型连接成功/).waitFor();
  await page.getByRole("button", { name: "重建索引", exact: true }).click();
  await page.getByText("本地索引已重建", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.sinan.agent.knowledge())).documents.length, 1);
  await mkdir("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/nanpad-agent-settings.png" });
  await page.getByRole("button", { name: "模型与知识库", exact: true }).click();
  await page.getByRole("textbox", { name: "向模型提问" }).fill("API 高负载处理");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByText(/integration-model · 生成完成/).waitFor();
  await page.screenshot({ path: "screenshots/nanpad-markdown-check.png" });
  assert.equal(await page.locator(".markdown-body h2").first().innerText(), "运行状态");
  assert.equal(await page.locator(".markdown-body strong").first().innerText(), "hk-api-02");
  assert.ok(await page.locator(".markdown-body table").count());
  assert.ok(await page.locator(".markdown-body pre code").count());
  assert.equal(await page.locator('.markdown-body a[href^="javascript:"]').count(), 0);
  assert.equal(await page.locator(".markdown-body img").count(), 0);
  await page.locator(".agent-sources summary").click();
  assert.ok((await page.locator(".agent-sources").innerText()).includes("星桥商城演示运维手册"));
  assert.ok(requests.some((req) => req.body.messages?.some((m) => m.role === "tool")));
  await page.screenshot({ path: "screenshots/nanpad-agent-answer.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".agent-sources summary").click();
  await page.screenshot({ path: "screenshots/nanpad-agent-mobile.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("textbox", { name: "向模型提问" }).fill("停止测试");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByText("等待测试取消", { exact: true }).waitFor();
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await page.getByText(/integration-model · 已停止/).waitFor();
  await page.reload();
  await page.locator('[data-app-ready="true"]').waitFor();
  const stored = JSON.parse(await readFile(join(directory, "conversations.json"), "utf8"));
  assert.ok(JSON.stringify(stored).includes('"type":"sources"'));
  assert.ok(JSON.stringify(stored).includes('"status":"stopped"'));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        demoAssets: 22,
        links: 13,
        ragDocument: true,
        streamedToolRoundTrip: true,
        cancellation: true,
        persistedSources: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
} finally {
  await instance?.close();
  service.closeAllConnections();
  await new Promise((done) => service.close(done));
  await rm(directory, { recursive: true, force: true });
}
