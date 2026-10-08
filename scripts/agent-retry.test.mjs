import assert from "node:assert/strict";
import { test } from "node:test";
import {
  continuationRequest,
  modelHistory,
  retryRequest,
  workspaceAccessOptions,
} from "../src/lib/agent-retry.mjs";

const messages = [
  { id: "q1", role: "you", blocks: [{ type: "text", text: "总结指南" }] },
  {
    id: "a1",
    role: "agent",
    blocks: [
      { type: "text", text: "正文片段" },
      { type: "run", status: "success", documentContent: true },
    ],
  },
  { id: "q2", role: "you", blocks: [{ type: "text", text: "整理账号" }] },
  {
    id: "a2",
    role: "agent",
    blocks: [
      { type: "text", text: "连接失败" },
      { type: "run", status: "error" },
    ],
  },
];
test("重试同一问题不会重复附加最后一条问题或发送失败回答", () => {
  const retry = retryRequest(messages, "a2");
  assert.equal(retry.question, "整理账号");
  assert.equal(retry.appendQuestion, false);
  assert.equal(retry.history.length, 2);
  assert.equal(JSON.stringify(modelHistory(retry.history)).includes("连接失败"), false);
  assert.equal(Object.hasOwn(retry, "allowDocumentContent"), false);
});
test("正文历史保留权限标记，提案与凭据块不会进入后续模型正文", () => {
  const history = modelHistory([
    ...messages,
    { role: "agent", blocks: [{ type: "proposal", proposal: { before: "sensitive-proposal" } }] },
    { role: "agent", blocks: [{ type: "secret", value: "secret-test" }] },
  ]);
  assert.equal(history.find((item) => item.content === "正文片段").documentContent, true);
  assert.equal(JSON.stringify(history).includes("secret-test"), false);
  assert.equal(JSON.stringify(history).includes("sensitive-proposal"), false);
});
test("重试更早的问题只取其之前的上下文，不携带之后的讨论", () => {
  const retry = retryRequest(
    [...messages, { id: "q3", role: "you", blocks: [{ type: "text", text: "后续问题" }] }],
    "a2",
  );
  assert.equal(retry.appendQuestion, true);
  assert.equal(JSON.stringify(retry.history).includes("后续问题"), false);
  assert.equal(retryRequest(messages, "a1"), null);
});

test("本次授权继续原问题，不重复问题也不回传缺权限的回答", () => {
  const result = continuationRequest(messages, "a1");
  assert.equal(result.question, "总结指南");
  assert.deepEqual(result.history, []);
  assert.equal(result.appendQuestion, true);
  assert.equal(continuationRequest(messages.slice(0, 2), "a1").appendQuestion, false);
  assert.equal(continuationRequest(messages, "q1"), null);
  assert.equal(continuationRequest(messages, "missing"), null);
});

test("正文编辑继续按钮明确展示两类权限，而标题修改不扩大到正文", () => {
  const answer = (permissions, flags) => ({
    role: "agent",
    blocks: [
      { type: "access", request: { permissions, reason: "继续原任务" } },
      { type: "run", status: "success", ...flags },
    ],
  });
  assert.deepEqual(
    workspaceAccessOptions(answer(["documentContent"], { workspaceChanges: true }))[0].permissions,
    ["documentContent", "workspaceChanges"],
  );
  assert.deepEqual(
    workspaceAccessOptions(answer(["workspaceChanges"], { documentContent: false }))[0].permissions,
    ["workspaceChanges"],
  );
  assert.deepEqual(workspaceAccessOptions(answer(["mailboxChecks", "unknown"], {})), []);
  assert.deepEqual(
    workspaceAccessOptions({ role: "agent", blocks: [{ type: "run", status: "error" }] }),
    [],
  );
});

test("旧版仅有文档元数据的回答提供分别授权入口，新版普通回答不多余提示", () => {
  const blocks = [
    { type: "sources", sources: [{ documentId: "doc-demo" }] },
    { type: "run", status: "success", documentContent: false },
  ];
  assert.deepEqual(
    workspaceAccessOptions({ role: "agent", blocks }).map((request) => request.permissions),
    [["documentContent"], ["workspaceChanges"]],
  );
  blocks[1].workspaceChanges = false;
  assert.deepEqual(workspaceAccessOptions({ role: "agent", blocks }), []);
});
