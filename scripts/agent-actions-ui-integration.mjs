import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const origin = "http://127.0.0.1:8080";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1200, height: 860 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`${origin}/__agent-actions-test`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><head><link rel="stylesheet" href="/src/styles.css"></head><body><main id="root" style="display:flex;height:100vh"></main></body></html>',
    }),
  );
  await page.goto(`${origin}/__agent-actions-test`);
  await page.evaluate(async () => {
    window.__requests = [];
    window.__applies = [];
    window.__discards = [];
    window.__saved = [];
    window.__config = {
      model: "failing-model",
      baseUrl: "http://127.0.0.1:9999/v1",
      topK: 6,
      maxSteps: 4,
      maxTokens: 2048,
      embeddingEnabled: false,
      embeddingBaseUrl: "http://127.0.0.1:9999/v1",
      embeddingModel: "",
      hasApiKey: true,
      apiKeyReadable: true,
    };
    window.sinan = {
      store: { load: async () => null, save: async () => {}, saveConversations: async () => {} },
      documents: {
        list: async () => [],
        save: async (document) => {
          window.__saved.push(document);
          return document;
        },
      },
      aiAccounts: { list: async () => [] },
      agent: {
        config: async () => window.__config,
        saveConfig: async (config) => (window.__config = config),
        knowledge: async () => ({ assets: 0, chunks: 0, documents: [] }),
        onEvent: (listener) => {
          window.__listener = listener;
          return () => {};
        },
        run: async (request) => {
          window.__requests.push({ ...request, model: window.__config.model });
          if (window.__config.model === "failing-model")
            throw Error("模型鉴权失败，请检查 API Key 和服务权限。");
          window.__listener({ id: request.id, type: "delta", text: "已生成建议，请审阅。" });
          return {
            model: window.__config.model,
            sources: 0,
            steps: 1,
            text: "已生成建议，请审阅。",
            sourceItems: [],
            tools: ["propose_document_edit"],
            proposals: [
              {
                id: `proposal-${window.__requests.length}`,
                type: "document-edit",
                title: "部署指南",
                documentId: "doc-demo",
                before: "旧地址",
                after: "新地址",
                reason: "用户明确指定替换地址。",
                expiresAt: Date.now() + 60000,
              },
            ],
          };
        },
        applyProposal: async (id) => {
          window.__applies.push(id);
          return {
            document: {
              id: "doc-demo",
              title: "部署指南",
              content: {
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text: "新地址" }] }],
              },
              bindings: [],
              updatedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
          };
        },
        discardProposal: async (id) => {
          window.__discards.push(id);
          if (window.__discardFails) throw new Error("暂时无法忽略，请重试。");
          return true;
        },
      },
    };
    const RefreshRuntime = (await import("/@react-refresh")).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const ReactDOM = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { AgentView } = await import("/src/components/agent-view.tsx");
    const resources = performance.getEntriesByType("resource");
    const { useConversations } = await import(
      resources.find((entry) => entry.name.includes("/src/lib/conversations.ts")).name
    );
    useConversations.setState({
      hydrated: true,
      conversations: [
        {
          id: "conversation-test",
          title: "修改部署指南",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
        },
      ],
      activeId: "conversation-test",
    });
    window.__conversations = useConversations;
    const { useDocuments } = await import(
      resources.find((entry) => entry.name.includes("/src/lib/documents.ts")).name
    );
    window.__documents = useDocuments;
    ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(AgentView));
  });
  await page.getByRole("textbox", { name: "向模型提问" }).fill("请将部署指南的旧地址改成新地址");
  await page.getByLabel("本次允许检索文档正文", { exact: true }).check();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("button", { name: "重试这条问题", exact: true }).waitFor();
  assert.equal(await page.getByLabel("本次允许检索文档正文", { exact: true }).isChecked(), false);
  await page.getByRole("button", { name: "检查模型设置", exact: true }).click();
  await page.getByLabel("模型名称", { exact: true }).fill("corrected-model");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await page.getByText("模型配置已保存", { exact: true }).waitFor();
  await page.getByRole("button", { name: "返回对话", exact: true }).click();
  await page.getByRole("button", { name: "重试这条问题", exact: true }).click();
  await page.getByRole("button", { name: "确认应用这项修改", exact: true }).waitFor();
  const requests = await page.evaluate(() => window.__requests);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].model, "corrected-model");
  assert.equal(requests[1].question, requests[0].question);
  assert.equal(requests[1].allowDocumentContent, false);
  assert.equal(JSON.stringify(requests[1].history).includes("鉴权失败"), false);
  assert.equal(
    await page.evaluate(
      () =>
        window.__conversations
          .getState()
          .conversations[0].messages.filter((message) => message.role === "you").length,
    ),
    1,
  );
  assert.equal(await page.evaluate(() => window.__applies.length), 0);
  await page.getByRole("button", { name: "内置能力", exact: true }).click();
  await page.getByRole("button", { name: /修改文档/ }).click();
  assert.equal(await page.getByLabel("本次生成修改建议", { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel("本次允许检索文档正文", { exact: true }).isChecked(), false);
  await mkdir("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/agent-actions-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "screenshots/agent-actions-mobile.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "确认应用这项修改", exact: true }).click();
  await page.getByText("修改已保存到本机。", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__applies.length), 1);
  assert.equal(
    await page.evaluate(
      () => window.__documents.getState().drafts["doc-demo"].content.content[0].content[0].text,
    ),
    "新地址",
  );
  await page.getByRole("textbox", { name: "向模型提问" }).fill("再生成一项文档修改建议");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("button", { name: "忽略", exact: true }).waitFor();
  await page.evaluate(() => {
    window.__discardFails = true;
  });
  await page.getByRole("button", { name: "忽略", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "暂时无法忽略，请重试。" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "确认应用这项修改", exact: true }).isEnabled(),
    true,
  );
  await page.evaluate(() => {
    window.__discardFails = false;
  });
  await page.getByRole("button", { name: "忽略", exact: true }).click();
  await page.getByText("已保留原有内容。", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__discards), ["proposal-3", "proposal-3"]);
  assert.equal(await page.evaluate(() => window.__applies.length), 1);
  assert.equal(
    await page.evaluate(
      () =>
        window.__conversations
          .getState()
          .conversations[0].messages.flatMap((message) => message.blocks)
          .find((block) => block.proposal?.id === "proposal-3").proposal.status,
    ),
    "dismissed",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "failed-question-retry",
        "updated-model-config",
        "no-duplicate-question",
        "permission-not-restored",
        "proposal-not-auto-applied",
        "explicit-apply",
        "discard-failure-retry",
        "discard-bridge-and-persisted-status",
        "mobile-no-overflow",
      ],
    }),
  );
} finally {
  await browser.close();
}
