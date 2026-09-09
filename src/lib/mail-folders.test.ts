import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMailFolders,
  moveMailboxes,
  deleteMailFolder,
  mailFolderId,
} from "./mail-folders.ts";
import type { Mailbox } from "./types.ts";
const mailbox = (id: string, folderId?: string): Mailbox => ({
  id,
  folderId,
  address: `${id}@example.test`,
  domain: "example.test",
  kind: "mailbox",
  tags: ["保留标签"],
  notes: "备注",
  usedMb: 0,
  quotaMb: 0,
  status: "online",
});
test("旧数据生成工作和生活分组，未分类邮箱归入未分组", () => {
  const folders = normalizeMailFolders(undefined);
  assert.deepEqual(
    folders.map((item) => item.name),
    ["工作邮箱", "生活邮箱"],
  );
  assert.equal(mailFolderId(mailbox("a", "missing"), folders), "");
  assert.deepEqual(normalizeMailFolders([]), []);
});
test("文件夹导入去重和约束，批量移动保留资产与标签", () => {
  const folders = normalizeMailFolders([
    { id: "w", name: " 工作 ", color: "invalid" },
    { id: "w", name: "其他" },
    { id: "x", name: "工作" },
  ]);
  assert.equal(folders.length, 1);
  assert.equal(folders[0].color, "blue");
  const original = [mailbox("a"), mailbox("b")];
  const next = moveMailboxes(original, ["a"], "w", folders);
  assert.equal(next[0].folderId, "w");
  assert.equal(next[0].notes, "备注");
  assert.deepEqual(next[0].tags, ["保留标签"]);
  assert.equal(next[1], original[1]);
  assert.equal(original[0].folderId, undefined);
  assert.throws(() => moveMailboxes(original, ["a"], "missing", folders));
});
test("删除文件夹只解除归属，不删除邮箱或修改其他分类", () => {
  const result = deleteMailFolder(
    [mailbox("a", "work"), mailbox("b", "personal")],
    normalizeMailFolders(undefined),
    "work",
  );
  assert.equal(result.mailboxes.length, 2);
  assert.equal(result.mailboxes[0].folderId, undefined);
  assert.equal(result.mailboxes[1].folderId, "personal");
  assert.equal(result.mailFolders.length, 1);
});
