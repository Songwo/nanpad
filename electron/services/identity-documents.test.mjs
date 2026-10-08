import { test } from "node:test";
import assert from "node:assert/strict";
import { identityPostsDocument } from "./identity-documents.mjs";
import { normalizeDocument } from "./documents.mjs";

const account = {
  assetId: "secret-linuxdo-synthetic",
  profile: { username: "alice", name: "Alice" },
  posts: {
    items: [
      {
        id: "1",
        title: "标题 <script>",
        url: "https://linux.do/t/topic/123/1",
        createdAt: "2026-10-08",
        excerpt: "正文摘要",
        kind: "topic",
      },
      {
        id: "2",
        title: "回复",
        url: "https://linux.do/t/topic/124/2",
        excerpt: "回复摘要",
        kind: "reply",
      },
    ],
  },
};
const fullPosts = account.posts.items.map((post) => ({
  post,
  content: `完整正文 ${post.id}\n\n账号：alice\n密码：synthetic-value`,
  format: "markdown",
  fetchedAt: "2026-10-08",
}));
test("保存自己的帖子全文并保留Markdown及身份关联，不以摘要冒充正文", () => {
  const doc = normalizeDocument(identityPostsDocument(account, fullPosts));
  assert.deepEqual(doc.bindings, [{ kind: "secret", id: account.assetId }]);
  assert.equal(doc.content.content.filter((n) => n.type === "heading").length, 2);
  assert.match(doc.markdown, /完整正文 1/);
  assert.match(doc.markdown, /完整正文 2/);
  assert.equal(doc.markdown.includes("正文摘要"), false);
  assert.match(JSON.stringify(doc.content), /标题 <script>/);
  assert.match(JSON.stringify(doc.content), /https:\/\/linux.do\/t\/topic\/123\/1/);
});
test("缺失正文或越界的输入拒绝保存，失败不产生空文档", () => {
  for (const items of [[], ["missing"], Array(21).fill(fullPosts[0]), "1", [null]])
    assert.throws(() => identityPostsDocument(account, items));
});
test("每次保存新建文档，不覆盖本机用户修改", () => {
  assert.notEqual(
    identityPostsDocument(account, fullPosts).id,
    identityPostsDocument(account, fullPosts).id,
  );
});
