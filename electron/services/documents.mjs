import { hostedImageUrl } from "./hosted-image.mjs";
import { mkdir, readFile, readdir, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { inspectRaster } from "./image-data.mjs";

const KINDS = new Set(["server", "domain", "mail", "ai", "secret", "cert"]);
const TYPES = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
  "image",
]);
export function documentLink(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function normalizeDocument(input) {
  if (!input || typeof input !== "object" || !/^doc-[a-zA-Z0-9-]{1,80}$/.test(input.id))
    throw new Error("文档标识无效");
  if (JSON.stringify(input).length > 16 * 1024 * 1024) throw new Error("单篇文档不能超过 16 MiB");
  let count = 0;
  const walk = (node, depth = 0) => {
    if (++count > 20000 || depth > 24 || !node || !TYPES.has(node.type))
      throw new Error("文档结构无效或内容过长");
    const out = { type: node.type };
    if (node.type === "text") {
      if (typeof node.text !== "string") throw new Error("文本无效");
      out.text = node.text;
    }
    if (node.type === "heading")
      out.attrs = { level: [1, 2, 3].includes(node.attrs?.level) ? node.attrs.level : 2 };
    if (node.type === "orderedList")
      out.attrs = {
        start:
          Number.isSafeInteger(node.attrs?.start) && node.attrs.start > 0 ? node.attrs.start : 1,
      };
    if (node.type === "image") {
      const src = node.attrs?.src;
      const match =
        typeof src === "string" &&
        /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
      if (!match && !hostedImageUrl(src))
        throw new Error("图片必须是上传图片或 HTTPS 图床地址，不支持 SVG");
      if (match) {
        const bytes = Buffer.from(match[2], "base64");
        if (bytes.length > 2 * 1024 * 1024 || bytes.toString("base64") !== match[2])
          throw new Error("图片编码无效或超过 2 MiB");
        const size = inspectRaster(bytes, "image/" + match[1]);
        if (Math.max(size.width, size.height) > 2048)
          throw new Error("图片最长边不能超过 2048 像素");
      }
      out.attrs = { src, alt: String(node.attrs?.alt ?? "图片").slice(0, 300) };
    }
    if (Array.isArray(node.marks))
      out.marks = node.marks.map((mark) => {
        if (["bold", "italic", "strike", "underline", "code"].includes(mark.type))
          return { type: mark.type };
        if (mark.type === "link") {
          const href = documentLink(mark.attrs?.href);
          if (!href) throw new Error("链接只支持 HTTP 或 HTTPS");
          return { type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer" } };
        }
        throw new Error("不支持的文本格式");
      });
    if (Array.isArray(node.content))
      out.content = node.content.map((child) => walk(child, depth + 1));
    return out;
  };
  if (input.content?.type !== "doc") throw new Error("缺少文档正文");
  const seen = new Set();
  const bindings = (Array.isArray(input.bindings) ? input.bindings : [])
    .map((ref) => {
      if (!KINDS.has(ref?.kind) || typeof ref.id !== "string" || !ref.id || ref.id.length > 256)
        throw new Error("关联资产无效");
      return { kind: ref.kind, id: ref.id };
    })
    .filter((ref) => {
      const key = JSON.stringify(ref);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (bindings.length > 100) throw new Error("单篇文档最多关联 100 项资产");
  return {
    id: input.id,
    title:
      String(input.title ?? "")
        .trim()
        .slice(0, 160) || "未命名文档",
    content: walk(input.content),
    bindings,
  };
}
export function documentSummary(doc) {
  const text = [];
  let imageCount = 0;
  const walk = (node) => {
    if (node.text) text.push(node.text);
    if (node.type === "image") imageCount++;
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc.content);
  return {
    id: doc.id,
    title: doc.title,
    bindings: doc.bindings,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    excerpt: text.join(" ").slice(0, 180),
    imageCount,
  };
}
export class DocumentsStore {
  #directory;
  #queue = Promise.resolve();
  constructor(directory) {
    this.#directory = directory;
  }
  #path(id) {
    if (!/^doc-[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error("文档标识无效");
    return join(this.#directory, id + ".json");
  }
  async list() {
    await this.#queue;
    let names;
    try {
      names = await readdir(this.#directory);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const result = [];
    for (const name of names.filter((n) => /^doc-[a-zA-Z0-9-]{1,80}\.json$/.test(n)))
      result.push(documentSummary(await this.get(name.slice(0, -5))));
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(id) {
    await this.#queue;
    const doc = JSON.parse(await readFile(this.#path(id), "utf8"));
    return { ...normalizeDocument(doc), createdAt: doc.createdAt, updatedAt: doc.updatedAt };
  }
  save(input) {
    const clean = normalizeDocument(input);
    const job = this.#queue.then(async () => {
      const path = this.#path(clean.id);
      let createdAt = new Date().toISOString();
      try {
        createdAt = JSON.parse(await readFile(path, "utf8")).createdAt || createdAt;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const doc = { ...clean, createdAt, updatedAt: new Date().toISOString() };
      await mkdir(this.#directory, { recursive: true });
      await writeFile(path + ".tmp", JSON.stringify(doc), "utf8");
      await rename(path + ".tmp", path);
      return doc;
    });
    this.#queue = job.catch(() => {});
    return job;
  }
  remove(id) {
    const path = this.#path(id);
    const job = this.#queue.then(() => unlink(path));
    this.#queue = job.catch(() => {});
    return job;
  }
}
