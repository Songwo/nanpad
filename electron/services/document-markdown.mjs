import { MAX_MARKDOWN_BYTES, parseMarkdownFile } from "./markdown-import.mjs";

/** Markdown 原文是正文真值；富文本结构只用于索引与明确转换。
 * @param {string} markdown
 * @returns {import("@tiptap/react").JSONContent}
 */
export function markdownContent(markdown) {
  if (typeof markdown !== "string") throw new Error("Markdown 源码必须是文本。");
  const bytes = new TextEncoder().encode(markdown);
  if (bytes.byteLength > MAX_MARKDOWN_BYTES) throw new Error("Markdown 源码不能超过 1 MiB。");
  if (!markdown.trim()) return { type: "doc", content: [{ type: "paragraph" }] };
  return parseMarkdownFile("document.md", bytes).content;
}

/** @param {string} text */
const escape = (text) =>
  text.replace(/([\\`*_{}[\]<>~])/g, "\\$1").replace(/(^|\n)([>#]|\d+[.)] |[-+] )/g, "$1\\$2");
/** @param {string} url */
const destination = (url) =>
  url.replace(/[\s()<>]/g, (value) =>
    value === "(" ? "%28" : value === ")" ? "%29" : encodeURIComponent(value),
  );
/** @param {import("@tiptap/react").JSONContent} node @returns {string} */
function inline(node) {
  if (node.type === "hardBreak") return "  \n";
  if (node.type !== "text") return (node.content ?? []).map(inline).join("");
  let value = escape(node.text ?? "");
  const marks = node.marks ?? [];
  if (marks.some((mark) => mark.type === "code")) {
    const text = node.text ?? "";
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = "`".repeat(longest + 1);
    const pad = /^[` ]|[` ]$/.test(text) ? " " : "";
    value = `${fence}${pad}${text}${pad}${fence}`;
  }
  for (const mark of marks) {
    if (mark.type === "bold") value = `**${value}**`;
    if (mark.type === "italic") value = `*${value}*`;
    if (mark.type === "strike") value = `~~${value}~~`;
    if (mark.type === "link" && /^https?:\/\//i.test(mark.attrs?.href ?? ""))
      value = `[${value}](${destination(String(mark.attrs?.href ?? ""))})`;
  }
  return value;
}

/** 将既有富文本导出为 Markdown。已有源码的文档必须直接返回源码。
 * @param {import("@tiptap/react").JSONContent} node
 * @returns {string}
 */
export function richTextToMarkdown(node) {
  switch (node.type) {
    case "doc":
      return (node.content ?? []).map(richTextToMarkdown).join("\n\n");
    case "paragraph":
      return (node.content ?? []).map(inline).join("");
    case "heading":
      return `${"#".repeat(Math.max(1, Math.min(6, Number(node.attrs?.level) || 2)))} ${(node.content ?? []).map(inline).join("")}`;
    case "blockquote":
      return (node.content ?? [])
        .map(richTextToMarkdown)
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "codeBlock": {
      const text = (node.content ?? []).map((child) => child.text ?? "").join("");
      const fence = "`".repeat(
        Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1)),
      );
      const language = /^[\w+-]{1,40}$/.test(node.attrs?.language ?? "")
        ? node.attrs?.language
        : "";
      return `${fence}${language}\n${text}\n${fence}`;
    }
    case "horizontalRule":
      return "---";
    case "image":
      return `![${escape(String(node.attrs?.alt ?? ""))}](${destination(String(node.attrs?.src ?? ""))})`;
    case "bulletList":
    case "orderedList":
      return (node.content ?? [])
        .map((item, index) => {
          const marker =
            node.type === "orderedList" ? `${(Number(node.attrs?.start) || 1) + index}. ` : "- ";
          return (item.content ?? [])
            .map(richTextToMarkdown)
            .join("\n\n")
            .split("\n")
            .map((line, lineIndex) => `${lineIndex ? " ".repeat(marker.length) : marker}${line}`)
            .join("\n");
        })
        .join("\n");
    case "text":
      return inline(node);
    default:
      return (node.content ?? []).map(richTextToMarkdown).join("\n\n");
  }
}

/** @param {{markdown?: string, content: import("@tiptap/react").JSONContent}} doc */
export function documentMarkdown(doc) {
  return typeof doc.markdown === "string" ? doc.markdown : richTextToMarkdown(doc.content);
}
