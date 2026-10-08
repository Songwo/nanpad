import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

/** @typedef {import("@tiptap/react").JSONContent} Content */
/** @typedef {import("mdast").Nodes} MarkdownNode */
/** @typedef {NonNullable<Content["marks"]>} Marks */
/** @typedef {{name: string, size: number, arrayBuffer(): Promise<ArrayBuffer>}} MarkdownFile */
/** @typedef {{imported: number, failed: {name: string, message: string}[], notices: {name: string, messages: string[]}[]}} ImportResult */

export const MAX_MARKDOWN_BYTES = 1024 * 1024;
export const MAX_MARKDOWN_FILES = 50;
const parser = unified().use(remarkParse).use(remarkGfm);

/** @param {string} value */
function safeLink(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** 只解析用户选择的文本，不执行 HTML，也不读取相邻文件或请求图片。
 * @param {string} name
 * @param {Uint8Array} bytes
 * @returns {{title: string, content: Content, markdown: string, notices: string[]}}
 */
export function parseMarkdownFile(name, bytes) {
  if (!/\.(md|markdown)$/i.test(name)) throw new Error("请选择 .md 或 .markdown 文件。");
  if (bytes.byteLength > MAX_MARKDOWN_BYTES) throw new Error("单篇 Markdown 文件不能超过 1 MiB。");
  const encoding =
    bytes[0] === 255 && bytes[1] === 254
      ? "utf-16le"
      : bytes[0] === 254 && bytes[1] === 255
        ? "utf-16be"
        : "utf-8";
  let source;
  try {
    source = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error("文件编码无法识别，请另存为 UTF-8 后重试。");
  }
  if (!source.trim()) throw new Error("Markdown 文件为空。");
  if (
    [...source].some((character) => character.charCodeAt(0) < 32 && !"\t\n\r".includes(character))
  )
    throw new Error("文件包含二进制内容，无法作为 Markdown 导入。");

  const tree = parser.parse(source);
  /** @type {Set<string>} */
  const notices = new Set();
  /** @type {Map<string, import("mdast").Definition>} */
  const definitions = new Map();
  let visited = 0;
  /** @param {MarkdownNode} node @param {number} depth */
  function inspect(node, depth) {
    if (++visited > 16000 || depth > 18) throw new Error("文档结构过于复杂，请拆分后导入。");
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
    if ("children" in node) for (const child of node.children) inspect(child, depth + 1);
  }
  inspect(tree, 0);

  /** @param {MarkdownNode} node */
  const raw = (node) =>
    source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
  /** @param {string} value @param {Marks} [marks] @returns {Content[]} */
  const text = (value, marks = []) =>
    value ? [{ type: "text", text: value, ...(marks.length ? { marks } : {}) }] : [];

  /** @param {MarkdownNode} node @param {Marks} [marks] @returns {Content[]} */
  function inline(node, marks = []) {
    switch (node.type) {
      case "text":
        return text(node.value, marks);
      case "emphasis":
      case "strong":
      case "delete": {
        const type = { emphasis: "italic", strong: "bold", delete: "strike" }[node.type];
        return node.children.flatMap((child) => inline(child, [...marks, { type }]));
      }
      case "inlineCode":
        return text(node.value, [...marks, { type: "code" }]);
      case "break":
        return [{ type: "hardBreak" }];
      case "link":
      case "linkReference": {
        const target = node.type === "link" ? node.url : definitions.get(node.identifier)?.url;
        const href = target && safeLink(target);
        if (!href) {
          notices.add("不安全或相对链接已保留为文本。");
          return text(raw(node), marks);
        }
        const link = {
          type: "link",
          attrs: { href, target: "_blank", rel: "noopener noreferrer" },
        };
        return node.children.flatMap((child) => inline(child, [...marks, link]));
      }
      case "image":
      case "imageReference": {
        notices.add("图片以链接或原文保留，未自动加载；可在编辑时手动插入。");
        const target = node.type === "image" ? node.url : definitions.get(node.identifier)?.url;
        const href = target && safeLink(target);
        return text(
          raw(node),
          href
            ? [
                ...marks,
                { type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer" } },
              ]
            : marks,
        );
      }
      default:
        notices.add("表格、HTML、脚注等未支持的格式已保留为原文。");
        return text(raw(node), [...marks, { type: "code" }]);
    }
  }

  /** @param {MarkdownNode} node @returns {Content[]} */
  function block(node) {
    switch (node.type) {
      case "root":
        return node.children.flatMap(block);
      case "paragraph":
        return [{ type: "paragraph", content: node.children.flatMap((child) => inline(child)) }];
      case "heading":
        if (node.depth > 3) notices.add("四至六级标题按三级标题导入。");
        return [
          {
            type: "heading",
            attrs: { level: Math.min(3, node.depth) },
            content: node.children.flatMap((child) => inline(child)),
          },
        ];
      case "blockquote":
        return [{ type: "blockquote", content: node.children.flatMap(block) }];
      case "list":
        return [
          {
            type: node.ordered ? "orderedList" : "bulletList",
            ...(node.ordered
              ? { attrs: { start: node.start && node.start > 0 ? node.start : 1 } }
              : {}),
            content: node.children.flatMap(block),
          },
        ];
      case "listItem": {
        const content = node.children.flatMap(block);
        if (content[0]?.type !== "paragraph") content.unshift({ type: "paragraph", content: [] });
        if (typeof node.checked === "boolean") {
          notices.add("任务列表以 [x] 和 [ ] 标记保留。");
          content[0].content = [
            ...text(node.checked ? "[x] " : "[ ] "),
            ...(content[0].content ?? []),
          ];
        }
        return [{ type: "listItem", content }];
      }
      case "code":
        return [
          {
            type: "codeBlock",
            ...(node.lang && /^[\w+-]{1,40}$/.test(node.lang)
              ? { attrs: { language: node.lang } }
              : {}),
            content: text(node.value),
          },
        ];
      case "thematicBreak":
        return [{ type: "horizontalRule" }];
      case "definition":
        // 定义已经用于解析引用式链接，同时保留原文，避免未使用的地址丢失。
        return [{ type: "codeBlock", content: text(raw(node)) }];
      default:
        notices.add("表格、HTML、脚注等未支持的格式已保留为原文。");
        return [{ type: "codeBlock", content: text(raw(node)) }];
    }
  }
  const content = block(tree);
  const title =
    name
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.(md|markdown)$/i, "")
      .trim()
      .slice(0, 160) || "未命名文档";
  return {
    title,
    markdown: source,
    content: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] },
    notices: [...notices],
  };
}

/** 前端与主进程共用安全解析；每篇独立保存，失败继续处理后续文件。
 * @param {MarkdownFile[]} files
 * @param {(document: {title: string, content: Content, markdown: string}) => Promise<unknown>} save
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<ImportResult>}
 */
export async function importMarkdownFiles(files, save, onProgress = () => {}) {
  if (files.length > MAX_MARKDOWN_FILES) throw new Error("一次最多导入 50 篇 Markdown 文档。");
  /** @type {ImportResult} */
  const result = { imported: 0, failed: [], notices: [] };
  onProgress(0, files.length);
  for (const [index, file] of files.entries()) {
    try {
      if (!/\.(md|markdown)$/i.test(file.name)) throw new Error("请选择 .md 或 .markdown 文件。");
      if (file.size > MAX_MARKDOWN_BYTES) throw new Error("单篇 Markdown 文件不能超过 1 MiB。");
      const document = parseMarkdownFile(file.name, new Uint8Array(await file.arrayBuffer()));
      await save({ title: document.title, content: document.content, markdown: document.markdown });
      result.imported++;
      if (document.notices.length)
        result.notices.push({ name: file.name, messages: document.notices });
    } catch (error) {
      result.failed.push({
        name: file.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    onProgress(index + 1, files.length);
  }
  return result;
}
