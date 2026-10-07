import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService, DEFAULT_CONFIG } from "./agent-service.mjs";
import { LocalIndex } from "./rag.mjs";
import { WorkspaceKnowledge, WORKSPACE_LIMITS, documentText } from "./workspace-knowledge.mjs";

const snapshot = {
  servers: [
    { id: "server-one", name: "发布服务器", status: "online", password: "vault-password-hidden" },
  ],
  domains: [{ id: "domain-one", name: "demo.example", status: "online" }],
  links: [{ from: { kind: "server", id: "server-one" }, to: { kind: "domain", id: "domain-one" } }],
};
const metadata = (id = "doc-runbook") => ({
  id,
  title: "发布手册",
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T01:00:00.000Z",
  bindings: [
    { kind: "server", id: "server-one" },
    { kind: "secret", id: "removed-key" },
  ],
  get excerpt() {
    throw new Error("未授权读取了摘要正文");
  },
});
const content = (text = "rollback-body-marker 执行只读验证") => ({
  id: "doc-runbook",
  content: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text }] },
      { type: "image", attrs: { src: "https://hidden.example/private-image", alt: "private-alt" } },
    ],
  },
});
const tool = (name, args) => ({ name, arguments: JSON.stringify(args) });
const response = (value) => {
  const choice =
    typeof value === "string"
      ? { delta: { content: value }, finish_reason: "stop" }
      : {
          delta: {
            tool_calls: value.map((fn, index) => ({ index, id: `call-${index}`, function: fn })),
          },
          finish_reason: "tool_calls",
        };
  return new Response(`data: ${JSON.stringify({ choices: [choice] })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};
async function fixture(t, next, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "zhiyu-workspace-tools-"));
  const requests = [],
    events = [];
  let reads = 0;
  const service = new AgentService({
    directory,
    getSnapshot: () => snapshot,
    emit: (event) => events.push(event),
    secureStorage: { isEncryptionAvailable: () => true },
    workspaceDocuments: options.documents ?? {
      list: async () => [metadata()],
      get: async () => {
        reads++;
        return content();
      },
    },
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      requests.push(request);
      return response(await next(request, requests.length));
    },
  });
  await service.saveConfig({
    ...DEFAULT_CONFIG,
    baseUrl: "http://127.0.0.1:9999/v1",
    model: "mock-stream",
  });
  t.after(async () => {
    service.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { service, requests, events, directory, reads: () => reads };
}
const lastTool = (request) => JSON.parse(request.messages.at(-1).content);

test("默认仅检索工作区元信息；摘要 getter、正文和凭据不会被读取或发送", async (t) => {
  for (const permission of [undefined, false, "true"]) {
    const f = await fixture(t, (request, step) => {
      assert.equal(
        request.tools.some((entry) => entry.function.name === "get_document"),
        false,
      );
      if (step === 1)
        return [
          tool("search_documents", { query: "发布" }),
          tool("get_document", { documentId: "doc-runbook" }),
        ];
      const outputs = request.messages
        .filter((item) => item.role === "tool")
        .map((item) => JSON.parse(item.content));
      assert.equal(outputs[0].documents[0].documentId, "doc-runbook");
      assert.equal(outputs[0].documents[0].excerpt, undefined);
      assert.match(outputs[1].error, /disabled/);
      return "可查看发布手册的标题和资产关联。";
    });
    const result = await f.service.run({
      id: "metadata",
      question: "发布手册",
      allowDocumentContent: permission,
    });
    assert.equal(f.reads(), 0);
    assert.ok(result.sourceItems.some((source) => source.documentId === "doc-runbook"));
    assert.doesNotMatch(
      JSON.stringify(f.requests),
      /rollback-body-marker|vault-password-hidden|private-image/,
    );
  }
});

test("明确授权后可搜索正文并读取纯文本，正文不会落入持久化检索缓存", async (t) => {
  const f = await fixture(t, (request, step) => {
    if (step === 1) return [tool("search_documents", { query: "rollback" })];
    if (step === 2) {
      const result = lastTool(request);
      assert.match(result.documents[0].excerpt, /rollback-body-marker/);
      assert.equal(result.contentSearch.complete, true);
      return [tool("get_document", { documentId: result.documents[0].documentId })];
    }
    assert.match(lastTool(request).text, /rollback-body-marker/);
    assert.equal(lastTool(request).truncated, false);
    return "手册包含回滚检查步骤。";
  });
  const result = await f.service.run({
    id: "authorized",
    question: "rollback",
    allowDocumentContent: true,
  });
  assert.equal(f.reads(), 1);
  assert.ok(
    result.sourceItems.some(
      (source) =>
        source.documentId === "doc-runbook" && source.excerpt.includes("rollback-body-marker"),
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(f.requests),
    /private-image|private-alt|vault-password-hidden/,
  );
  for (const file of await readdir(f.directory))
    assert.doesNotMatch(
      await readFile(join(f.directory, file), "utf8"),
      /rollback-body-marker|发布手册/,
    );
});

test("资产与文档双向关联包含真实已有关系，并明确标记失效绑定", async (t) => {
  const f = await fixture(t, (request, step) => {
    if (step === 1) return [tool("get_related_resources", { sourceId: "asset:server:server-one" })];
    if (step === 2) {
      const result = lastTool(request);
      assert.equal(result.total, 2);
      assert.ok(
        result.resources.some(
          (row) => row.documentId === "doc-runbook" && row.relationship === "document_binding",
        ),
      );
      assert.ok(
        result.resources.some(
          (row) => row.sourceId === "asset:domain:domain-one" && row.relationship === "asset_link",
        ),
      );
      return [
        tool("get_related_resources", { sourceId: "workspace-document:doc-runbook:content" }),
      ];
    }
    const result = lastTool(request);
    assert.equal(
      result.resources.find((row) => row.sourceId === "asset:secret:removed-key").exists,
      false,
    );
    assert.equal(
      result.resources.find((row) => row.sourceId === "asset:server:server-one").exists,
      true,
    );
    return "已找到手册绑定的服务器及服务器关联的域名。";
  });
  await f.service.run({ id: "relations", question: "相关资料" });
  assert.equal(f.reads(), 0);
});

test("正文授权不会跨请求继承，撤权历史只过滤带正文标记的消息", async (t) => {
  const f = await fixture(t, (request, step) => {
    if (step === 1 || step === 3) return [tool("get_document", { documentId: "doc-runbook" })];
    if (step === 2) return "rollback-body-marker";
    assert.match(lastTool(request).error, /disabled/);
    assert.ok(request.messages.some((item) => item.content === "保留普通历史"));
    assert.doesNotMatch(JSON.stringify(request.messages), /rollback-body-marker/);
    return "本次只允许元信息。";
  });
  await f.service.run({ id: "allow", question: "手册", allowDocumentContent: true });
  await f.service.run({
    id: "revoke",
    question: "关联资产",
    history: [
      { role: "assistant", content: "rollback-body-marker", documentContent: true },
      { role: "user", content: "保留普通历史" },
    ],
  });
  assert.equal(f.reads(), 1);
});

test("新工具严格拒绝额外参数、非法分页和路径型标识；不存在的资源不伪造来源", async (t) => {
  const cases = [
    ["search_documents", { query: "", allowDocumentContent: true }, /Invalid/],
    ["search_documents", { query: "", offset: -1 }, /Invalid/],
    ["search_documents", { query: "", limit: 21 }, /Invalid/],
    ["search_documents", { query: 1 }, /Invalid/],
    ["get_document", { documentId: "../../vault" }, /Invalid/],
    ["get_document", { documentId: "doc-runbook", password: true }, /Invalid/],
    ["get_document", { documentId: "doc-missing" }, /not found/],
    ["get_related_resources", { sourceId: "asset:server:missing" }, /not found/],
    ["get_related_resources", { sourceId: "asset:server:server-one", limit: 0 }, /Invalid/],
  ];
  for (const [name, args, error] of cases) {
    const f = await fixture(t, (request, step) => {
      if (step === 1) return [tool(name, args)];
      assert.match(lastTool(request).error, error);
      assert.equal(lastTool(request).sources, undefined);
      return "未执行无效查询。";
    });
    await f.service.run({ id: "invalid", question: "查询", allowDocumentContent: true });
    assert.equal(f.reads(), 0);
  }
});

test("文档检索和关联查询可分页，空搜索在已授权时仍不读取正文", async (t) => {
  const documents = {
    list: async () => Array.from({ length: 25 }, (_, i) => metadata(`doc-${i}`)),
    get: async () => {
      throw new Error("空搜索不应读正文");
    },
  };
  const f = await fixture(
    t,
    (request, step) => {
      if (step === 1) return [tool("search_documents", { query: "", limit: 20 })];
      if (step === 2) {
        const result = lastTool(request);
        assert.equal(result.total, 25);
        assert.equal(result.documents.length, 20);
        assert.equal(result.nextOffset, 20);
        return [
          tool("get_related_resources", {
            sourceId: "asset:server:server-one",
            offset: 20,
            limit: 20,
          }),
        ];
      }
      assert.equal(lastTool(request).total, 26);
      assert.equal(lastTool(request).resources.length, 6);
      assert.equal(lastTool(request).nextOffset, null);
      return "已分页返回关联文档。";
    },
    { documents },
  );
  await f.service.run({ id: "page", question: "文档列表", allowDocumentContent: true });
});

test("正文输出和扫描有明确上限，大文档与未扫描内容均报告不完整", async (t) => {
  let reads = 0;
  const documents = {
    list: async () => Array.from({ length: 55 }, (_, i) => metadata(`doc-${i}`)),
    get: async (id) => {
      reads++;
      return { ...content("longtext ".repeat(10000)), id };
    },
  };
  const f = await fixture(
    t,
    (request, step) => {
      if (step === 1) return [tool("get_document", { documentId: "doc-0" })];
      if (step === 2) {
        assert.equal(lastTool(request).text.length, WORKSPACE_LIMITS.outputCharacters);
        assert.equal(lastTool(request).truncated, true);
        return [tool("search_documents", { query: "longtext" })];
      }
      assert.equal(lastTool(request).contentSearch.complete, false);
      assert.ok(
        lastTool(request).documents.every(
          (row) => row.excerpt.length <= 600 && row.contentTruncated,
        ),
      );
      return "正文扫描达到限制，结果不完整。";
    },
    { documents },
  );
  await f.service.run({ id: "bounded", question: "手册正文", allowDocumentContent: true });
  assert.equal(reads, WORKSPACE_LIMITS.bodyCharacters / WORKSPACE_LIMITS.documentCharacters);
});

test("正文和元信息读取可以取消，挂起的存储读取不阻塞 Agent 停止", async (t) => {
  for (const stage of ["list", "get"]) {
    let entered;
    const ready = new Promise((resolve) => {
      entered = resolve;
    });
    const stalled = () => {
      entered();
      return new Promise(() => {});
    };
    const f = await fixture(t, () => [tool("get_document", { documentId: "doc-runbook" })], {
      documents: { list: stage === "list" ? stalled : async () => [metadata()], get: stalled },
    });
    const running = f.service.run({ id: "cancel", question: "正文", allowDocumentContent: true });
    await ready;
    assert.equal(f.service.cancel("cancel"), true);
    await assert.rejects(running, /已停止生成/);
    assert.equal(f.service.jobs.size, 0);
    assert.equal(f.requests.length, stage === "list" ? 0 : 1);
  }
});

test("文档存储错误不暴露本机路径、错误内正文或凭据", async (t) => {
  const f = await fixture(
    t,
    (request, step) => {
      if (step === 1) return [tool("get_document", { documentId: "doc-runbook" })];
      assert.match(lastTool(request).error, /missing or cannot be read/);
      return "文档暂不可读。";
    },
    {
      documents: {
        list: async () => [metadata()],
        get: async () => {
          throw new Error("C:/private/vault sk-private");
        },
      },
    },
  );
  await f.service.run({ id: "read-error", question: "文档", allowDocumentContent: true });
  assert.doesNotMatch(JSON.stringify(f.requests), /C:\/private|sk-private/);
});

test("纯文本提取不发送图片属性，深层和超宽结构有界", () => {
  const signal = new AbortController().signal;
  assert.equal(documentText(content().content, 1000, signal).text.includes("private-image"), false);
  const wide = {
    type: "doc",
    content: Array.from({ length: WORKSPACE_LIMITS.nodes + 2 }, () => ({
      type: "text",
      text: "x",
    })),
  };
  const result = documentText(wide, 100000, signal);
  assert.ok(result.text.length <= WORKSPACE_LIMITS.nodes);
  assert.equal(result.truncated, true);
});

test("目录刷新按每次请求重读，新标题和解绑不会复用旧工作区索引", async () => {
  let rows = [metadata()];
  const make = async () => {
    const workspace = new WorkspaceKnowledge({
      documents: { list: async () => rows, get: async () => content() },
      snapshot,
      index: new LocalIndex(snapshot, []),
      signal: new AbortController().signal,
    });
    await workspace.load();
    return workspace;
  };
  assert.equal((await make()).related({ sourceId: "asset:server:server-one" }).total, 2);
  rows = [{ id: "doc-runbook", title: "新手册", bindings: [] }];
  const next = await make();
  assert.equal(next.related({ sourceId: "asset:server:server-one" }).total, 1);
  assert.equal((await next.search({ query: "新手册" })).documents[0].title, "新手册");
});

test("密集绑定目录自动缩小页尺寸，正文关闭时不会用正文关键字匹配", async () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    id: `doc-${i}`,
    title: "运维记录",
    bindings: Array.from({ length: 100 }, (_, j) => ({
      kind: "server",
      id: `${j}-` + "\\".repeat(250),
    })),
    get excerpt() {
      throw new Error("不得检索正文摘要");
    },
  }));
  const workspace = new WorkspaceKnowledge({
    documents: {
      list: async () => rows,
      get: async () => {
        throw new Error("未授权正文读取");
      },
    },
    snapshot,
    index: new LocalIndex(snapshot, []),
    signal: new AbortController().signal,
  });
  await workspace.load();
  assert.equal((await workspace.search({ query: "rollback-body-marker" })).total, 0);
  const ids = [];
  let offset = 0;
  do {
    const page = await workspace.search({ query: "", offset, limit: 20 });
    assert.ok(page.documents.length < 20);
    assert.ok(JSON.stringify(page).length < WORKSPACE_LIMITS.toolCharacters);
    ids.push(...page.documents.map((row) => row.documentId));
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(new Set(ids).size, 25);
  assert.equal(ids.length, 25);
});

test("控制字符和高转义元信息不会突破工具输出预算", async () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    id: `doc-${i}`,
    title: "\\".repeat(160),
    bindings: [{ kind: "server", id: "server-one" }],
  }));
  const workspace = new WorkspaceKnowledge({
    documents: {
      list: async () => rows,
      get: async (id) => ({ ...content("\0".repeat(20000)), id }),
    },
    snapshot,
    index: new LocalIndex(snapshot, []),
    signal: new AbortController().signal,
    allowDocumentContent: true,
  });
  await workspace.load();
  const document = await workspace.get("doc-0");
  assert.ok(JSON.stringify(document).length <= WORKSPACE_LIMITS.toolCharacters);
  assert.equal(document.truncated, true);
  const related = workspace.related({ sourceId: "asset:server:server-one", limit: 20 });
  assert.ok(JSON.stringify(related).length <= WORKSPACE_LIMITS.toolCharacters);
  assert.equal(related.nextOffset, related.resources.length);
});

test("显式元信息目录返回截断状态，部分目录不能被报告为完整检索", async () => {
  const workspace = new WorkspaceKnowledge({
    documents: {
      list: async () => ({ documents: [metadata()], truncated: true }),
      get: async () => content(),
    },
    snapshot,
    index: new LocalIndex(snapshot, []),
    signal: new AbortController().signal,
    allowDocumentContent: true,
  });
  await workspace.load();
  const result = await workspace.search({ query: "发布" });
  assert.equal(result.catalogTruncated, true);
  assert.equal(result.contentSearch.complete, false);
  assert.equal(result.documents[0].documentId, "doc-runbook");
  assert.equal(workspace.related({ sourceId: "asset:server:server-one" }).catalogTruncated, true);
});
