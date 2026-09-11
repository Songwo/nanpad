import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSecretFolders,
  moveSecrets,
  deleteSecretFolder,
  secretFolderId,
} from "./secret-folders.ts";
import type { Secret } from "./types.ts";

const secret = (id: string, folderId?: string): Secret => ({
  id,
  folderId,
  name: `${id} 密钥`,
  kind: "api",
  hint: "提示",
  // 密钥值只存在加密库，资产记录里永远为空。
  value: "",
  lastRotated: "2026-09-11T00:00:00.000Z",
  tags: ["保留标签"],
  status: "online",
  notes: "备注",
});

test("旧数据生成工作和个人密钥分组，未分类密钥归入未分组", () => {
  const folders = normalizeSecretFolders(undefined);
  assert.deepEqual(
    folders.map((item) => item.name),
    ["工作密钥", "个人密钥"],
  );
  assert.equal(secretFolderId(secret("a", "missing"), folders), "");
  assert.deepEqual(normalizeSecretFolders([]), []);
});
test("分组导入去重和约束，批量移动保留资产与标签", () => {
  const folders = normalizeSecretFolders([
    { id: "w", name: " 生产 ", color: "invalid" },
    { id: "w", name: "其他" },
    { id: "x", name: "生产" },
  ]);
  assert.equal(folders.length, 1);
  assert.equal(folders[0].color, "blue");
  const original = [secret("a"), secret("b")];
  const next = moveSecrets(original, ["a"], "w", folders);
  assert.equal(next[0].folderId, "w");
  assert.equal(next[0].notes, "备注");
  assert.deepEqual(next[0].tags, ["保留标签"]);
  assert.equal(next[1], original[1]);
  assert.equal(original[0].folderId, undefined);
  assert.throws(() => moveSecrets(original, ["a"], "missing", folders), /密钥分组不存在/);
});
test("删除分组只解除归属，不删除密钥或修改其他分组", () => {
  const result = deleteSecretFolder(
    [secret("a", "work"), secret("b", "personal")],
    normalizeSecretFolders(undefined),
    "work",
  );
  assert.equal(result.secrets.length, 2);
  assert.equal(result.secrets[0].folderId, undefined);
  assert.equal(result.secrets[1].folderId, "personal");
  assert.equal(result.secretFolders.length, 1);
});
