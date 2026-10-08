import { randomUUID } from "node:crypto";
import { markdownContent } from "./document-markdown.mjs";

const literal = (value) => String(value).replace(/([\\`*_{}[\]<>~])/g, "\\$1");
/** 仅由主进程传入已核验作者的全文，活动摘要不可用于保存成功。 */
export function identityPostsDocument(account, items) {
  if (!account || !Array.isArray(items) || !items.length || items.length > 20)
    throw new Error("请选择 1–20 篇已读取正文的帖子。");
  const sections = items.map((item) => {
    if (
      !item?.post ||
      typeof item.content !== "string" ||
      !item.content.trim() ||
      !["markdown", "text"].includes(item.format)
    )
      throw new Error("帖子正文不完整，未保存文档。");
    const post = item.post;
    const body =
      item.format === "markdown"
        ? item.content
        : literal(item.content).replace(/(^|\n)([>#]|\d+[.)] |[-+] )/g, "$1\\$2");
    return `## ${literal(post.title || "未命名帖子").replace(/[\r\n]/g, " ")}\n\n来源：${post.url}${post.createdAt ? `\n\n发布时间：${post.createdAt}` : ""}\n\n${body}`;
  });
  const markdown = sections.join("\n\n---\n\n");
  const now = new Date().toISOString();
  return {
    id: `doc-${randomUUID()}`,
    title:
      items.length === 1
        ? items[0].post.title
        : `Linux.do · ${account.profile.name || account.profile.username} · 我的帖子`,
    bindings: [{ kind: "secret", id: account.assetId }],
    createdAt: now,
    updatedAt: now,
    markdown,
    content: markdownContent(markdown),
  };
}
