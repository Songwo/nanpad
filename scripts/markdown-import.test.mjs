import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DocumentsStore, normalizeDocument } from "../electron/services/documents.mjs";

const implementation = await import("../src/lib/markdown-import.mjs").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});
function api() {
  assert.ok(implementation, "尚未实现 Markdown 文件导入");
  return implementation;
}
const bytes = (text) => new TextEncoder().encode(text);
const parse = (text, name = "部署说明.md") => api().parseMarkdownFile(name, bytes(text));
function nodes(content) {
  return [content, ...(content.content ?? []).flatMap(nodes)];
}
function text(content) {
  return nodes(content)
    .map((node) => node.text ?? "")
    .join("");
}

test("Markdown 文件转换为可保存的标题、列表、引用、链接和代码块", () => {
  const result = parse(
    "# 部署\n\n**先备份**，再访问[说明](https://example.test/help)。\n\n3. 第一步\n4. 第二步\n\n> 注意事项\n\n```sh\nprintf 'hello'\n```\n\n---\n",
  );
  assert.equal(result.title, "部署说明");
  const all = nodes(result.content);
  assert.equal(all.find((n) => n.type === "heading").attrs.level, 1);
  assert.equal(all.find((n) => n.type === "orderedList").attrs.start, 3);
  assert.ok(all.some((n) => n.type === "blockquote"));
  assert.equal(all.find((n) => n.type === "codeBlock").attrs.language, "sh");
  assert.ok(all.some((n) => n.marks?.some((mark) => mark.type === "bold")));
  assert.ok(
    all.some((n) => n.marks?.some((mark) => mark.attrs?.href === "https://example.test/help")),
  );
  const normalized = normalizeDocument({ id: "doc-import-check", ...result, bindings: [] });
  assert.deepEqual(normalized.content, result.content);
  assert.deepEqual(result.notices, []);
});

test("支持 UTF-8 BOM、Windows 换行和带 BOM 的 UTF-16 中文文件", () => {
  for (const content of [
    bytes("\uFEFF# 中文\r\n\r\n正文"),
    Buffer.concat([Buffer.from([255, 254]), Buffer.from("# 中文\r\n\r\n正文", "utf16le")]),
  ]) {
    assert.equal(text(api().parseMarkdownFile("中文.MD", content).content), "中文正文");
  }
  const utf16be = Buffer.concat([
    Buffer.from([254, 255]),
    Buffer.from("# 中文", "utf16le").swap16(),
  ]);
  assert.equal(text(api().parseMarkdownFile("中文.markdown", utf16be).content), "中文");
});

test("保存代码块只保留有效的字符串语言属性", () => {
  for (const language of [["sh"], 123, {}, 'sh" onclick="run', "x".repeat(41)]) {
    const saved = normalizeDocument({
      id: "doc-code-language",
      content: {
        type: "doc",
        content: [
          { type: "codeBlock", attrs: { language }, content: [{ type: "text", text: "sample" }] },
        ],
      },
    });
    assert.equal(saved.content.content[0].attrs, undefined);
    assert.equal(text(saved.content), "sample");
  }
});

test("拒绝错误扩展名、空文件、损坏编码、二进制和过大文件", () => {
  assert.throws(() => parse("正文", "wrong.txt"), /\.md/);
  assert.throws(() => parse(" \r\n\t"), /空/);
  assert.throws(() => api().parseMarkdownFile("bad.md", new Uint8Array([255, 255, 255])), /编码/);
  assert.throws(() => parse("abc\u0000def"), /二进制/);
  assert.throws(
    () => api().parseMarkdownFile("large.md", new Uint8Array(api().MAX_MARKDOWN_BYTES + 1)),
    /1 MiB/,
  );
});

test("原始 HTML 和危险链接保留为文本，图片不会成为自动加载的图片节点", () => {
  const source =
    "<script>alert(1)</script>\n\n[打开](javascript:alert%281%29)\n\n![外链](https://example.test/tracker.png)\n\n![本地图](./private.png)";
  const result = parse(source);
  const all = nodes(result.content);
  assert.equal(
    all.some((n) => n.type === "image"),
    false,
  );
  assert.ok(text(result.content).includes("<script>alert(1)</script>"));
  assert.ok(text(result.content).includes("./private.png"));
  for (const node of all)
    for (const mark of node.marks ?? []) {
      if (mark.type === "link") assert.match(mark.attrs.href, /^https?:\/\//);
    }
  assert.ok(result.notices.length > 0);
  assert.doesNotThrow(() => normalizeDocument({ id: "doc-safe-import", ...result, bindings: [] }));
});

test("保留 GFM 删除线、任务状态、引用式链接，表格与脚注保留原文", () => {
  const table = "| 名称 | 值 |\n| --- | --- |\n| 环境 | 测试 |";
  const result = parse(
    `~~旧值~~\n\n- [x] 已完成\n- [ ] 未完成\n\n[参考][guide]\n\n[guide]: https://example.test/docs\n\n${table}\n\n说明[^1]\n\n[^1]: 脚注内容`,
  );
  const all = nodes(result.content);
  assert.ok(all.some((n) => n.marks?.some((mark) => mark.type === "strike")));
  assert.ok(text(result.content).includes("[x] 已完成"));
  assert.ok(text(result.content).includes("[ ] 未完成"));
  assert.ok(
    all.some((n) => n.marks?.some((mark) => mark.attrs?.href === "https://example.test/docs")),
  );
  assert.ok(all.some((n) => n.type === "codeBlock" && text(n) === table));
  assert.ok(text(result.content).includes("[^1]: 脚注内容"));
});

test("空列表项、深层标题和硬换行均产生编辑器可接受的结构", () => {
  const result = parse("###### 小标题\n\n-\n- 有内容\n\n第一行  \n第二行");
  assert.equal(nodes(result.content).find((n) => n.type === "heading").attrs.level, 3);
  for (const item of nodes(result.content).filter((n) => n.type === "listItem"))
    assert.equal(item.content[0].type, "paragraph");
  assert.ok(nodes(result.content).some((n) => n.type === "hardBreak"));
  assert.doesNotThrow(() => normalizeDocument({ id: "doc-structure", ...result, bindings: [] }));
});

test("过深或节点过多的文档在保存之前拒绝", () => {
  assert.throws(() => parse(`${"> ".repeat(28)}深层引用`), /复杂/);
  assert.throws(() => parse("x\n\n".repeat(11000)), /复杂/);
});

test("批量导入继续处理有效文件，单个读取或保存失败如实报告", async () => {
  const saved = [];
  const progress = [];
  const result = await api().importMarkdownFiles(
    [
      new File(["# 正常"], "正常.md"),
      new File(["x"], "忽略.txt"),
      {
        name: "读失败.md",
        size: 10,
        arrayBuffer: async () => {
          throw Error("read denied");
        },
      },
      new File(["正文"], "写失败.md"),
      new File(["# 后续"], "后续.md"),
    ],
    async (doc) => {
      if (doc.title === "写失败") throw Error("disk full");
      saved.push(doc);
    },
    (done, total) => progress.push([done, total]),
  );
  assert.equal(result.imported, 2);
  assert.deepEqual(
    result.failed.map((f) => f.name),
    ["忽略.txt", "读失败.md", "写失败.md"],
  );
  assert.deepEqual(
    saved.map((doc) => doc.title),
    ["正常", "后续"],
  );
  assert.deepEqual(progress.at(-1), [5, 5]);
});

test("批量上限在读取文件或保存前检查", async () => {
  let calls = 0;
  await assert.rejects(
    api().importMarkdownFiles(
      Array.from({ length: 51 }, () => ({
        name: "a.md",
        size: 1,
        arrayBuffer: async () => {
          calls++;
          return bytes("a").buffer;
        },
      })),
      async () => {
        calls++;
      },
    ),
    /50/,
  );
  assert.equal(calls, 0);
});

test("同名 Markdown 创建独立文件且重开存储后可读取，不覆盖已有文档", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhiyu-md-import-"));
  try {
    const store = new DocumentsStore(directory);
    const save = (doc) => store.save({ ...doc, id: "doc-" + crypto.randomUUID(), bindings: [] });
    await api().importMarkdownFiles(
      [new File(["# 旧记录"], "同名.md"), new File(["# 新记录"], "同名.md")],
      save,
    );
    const reopened = new DocumentsStore(directory);
    const list = await reopened.list();
    assert.equal(list.length, 2);
    assert.notEqual(list[0].id, list[1].id);
    assert.deepEqual(
      new Set(
        await Promise.all(list.map(async (doc) => text((await reopened.get(doc.id)).content))),
      ),
      new Set(["旧记录", "新记录"]),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
