import test from "node:test";
import assert from "node:assert/strict";
import {
  documentMarkdown,
  markdownContent,
  richTextToMarkdown,
} from "../src/lib/document-markdown.mjs";
import { importMarkdownFiles } from "../src/lib/markdown-import.mjs";

test("Markdown 原文保留表格、任务、脚注、空行与 Windows 换行", async () => {
  const source =
    "# 表格\r\n\r\n| 列 | 值 |\r\n| --- | --- |\r\n| a | b |\r\n\r\n- [x] 完成\r\n\r\n脚注[^1]\r\n\r\n[^1]: 原文  \r\n";
  let imported;
  const result = await importMarkdownFiles([new File([source], "原文.md")], async (value) => {
    imported = value;
  });
  assert.equal(result.imported, 1);
  assert.equal(imported.markdown, source);
  assert.equal(documentMarkdown(imported), source);
  assert.equal(markdownContent(source).type, "doc");
});

test("空源码可以保存，超限和二进制源码拒绝", () => {
  assert.deepEqual(markdownContent(" \n"), { type: "doc", content: [{ type: "paragraph" }] });
  assert.throws(() => markdownContent("x".repeat(1024 * 1024 + 1)), /1 MiB/);
  assert.throws(() => markdownContent("test\0"), /二进制/);
});

test("富文本转 Markdown 转义文字标记并保留代码围栏、链接和嵌套列表", () => {
  const original = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "标题 * 字面" }] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "路径",
            marks: [{ type: "link", attrs: { href: "https://example.test/a(b)" } }],
          },
        ],
      },
      {
        type: "codeBlock",
        attrs: { language: "md" },
        content: [{ type: "text", text: "```quoted```" }],
      },
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "步骤" }] },
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "子项" }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const markdown = richTextToMarkdown(original);
  assert.ok(markdown.includes("## 标题 \\* 字面"));
  assert.ok(markdown.includes("https://example.test/a%28b%29"));
  assert.ok(markdown.includes("````md\n```quoted```\n````"));
  const parsed = markdownContent(markdown);
  assert.equal(parsed.content[2].content[0].text, "```quoted```");
  assert.equal(parsed.content[3].attrs.start, 3);
  assert.equal(parsed.content[3].content[0].content[1].type, "bulletList");
});
