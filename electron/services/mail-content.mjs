import sanitizeHtml from "sanitize-html";
import { inspectRaster } from "./image-data.mjs";

export const MAX_HTML_BYTES = 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 1024 * 1024;
const MAX_INLINE_TOTAL_BYTES = 3 * 1024 * 1024;
const MAX_INLINE_IMAGES = 20;
const rasterTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

function webUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return "";
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function contentId(value) {
  if (typeof value !== "string" || value.length > 512) return "";
  try {
    return decodeURIComponent(value).replace(/^<|>$/g, "");
  } catch {
    return "";
  }
}

/** 邮件 HTML 只保留静态排版；远程地址无 src，只有用户在阅读器确认后才加载。 */
export function sanitizeMailHtml(html, attachments = []) {
  if (typeof html !== "string" || !html || Buffer.byteLength(html) > MAX_HTML_BYTES)
    return undefined;
  const inline = new Map();
  for (const attachment of attachments) {
    const cid = contentId(attachment.contentId);
    if (!cid || !rasterTypes.has(attachment.contentType) || !Buffer.isBuffer(attachment.content))
      continue;
    if (attachment.content.length > MAX_INLINE_IMAGE_BYTES) continue;
    try {
      inspectRaster(attachment.content, attachment.contentType);
      inline.set(cid, attachment);
    } catch {
      // MIME 类型与图片头不符、尺寸过大时，仅保留普通附件下载入口。
    }
  }
  let inlineCount = 0;
  let inlineBytes = 0;
  let nodeCount = 0;
  const tooComplex = new Error("邮件排版节点超过限制");
  let clean;
  try {
    clean = sanitizeHtml(html, {
      onOpenTag: () => {
        if (++nodeCount > 10000) throw tooComplex;
      },
      allowedTags: [
        "p",
        "div",
        "span",
        "br",
        "hr",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "strong",
        "b",
        "em",
        "i",
        "u",
        "s",
        "del",
        "sub",
        "sup",
        "small",
        "mark",
        "blockquote",
        "pre",
        "code",
        "ul",
        "ol",
        "li",
        "dl",
        "dt",
        "dd",
        "table",
        "caption",
        "colgroup",
        "col",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "th",
        "td",
        "a",
        "img",
      ],
      allowedAttributes: {
        "*": ["style"],
        a: ["href", "title"],
        img: ["src", "alt", "data-mail-remote-src"],
        td: ["colspan", "rowspan", "align"],
        th: ["colspan", "rowspan", "align", "scope"],
        ol: ["start", "reversed"],
        li: ["value"],
      },
      allowedStyles: {
        "*": {
          "text-align": [/^(left|right|center|justify)$/],
          "vertical-align": [/^(top|middle|bottom|baseline)$/],
          "font-weight": [/^(normal|bold|[1-9]00)$/],
          "font-style": [/^(normal|italic)$/],
          "font-size": [/^(1[0-9]|2[0-8])px$/, /^(0\.(75|8|9)|1(\.[0-5])?)em$/],
          "text-decoration": [/^(none|underline|line-through)$/],
          "white-space": [/^(normal|pre-wrap|pre-line)$/],
          "line-height": [/^(1(\.[0-9])?|2(\.[0-5])?)$/],
        },
      },
      allowedSchemes: ["https", "http"],
      allowedSchemesByTag: { img: ["data"] },
      allowProtocolRelative: false,
      disallowedTagsMode: "discard",
      nonTextTags: [
        "script",
        "style",
        "textarea",
        "option",
        "iframe",
        "object",
        "embed",
        "svg",
        "math",
        "form",
        "button",
        "select",
        "noscript",
        "template",
      ],
      nestingLimit: 40,
      transformTags: {
        a: (_tag, attributes) => ({
          tagName: "a",
          attribs: { href: webUrl(attributes.href), title: (attributes.title ?? "").slice(0, 300) },
        }),
        img: (_tag, attributes) => {
          const attribs = { alt: (attributes.alt ?? "").slice(0, 300) };
          const source = attributes.src ?? "";
          const remote = webUrl(source);
          if (remote) attribs["data-mail-remote-src"] = remote;
          else if (/^cid:/i.test(source)) {
            const file = inline.get(contentId(source.slice(4)));
            if (
              file &&
              inlineCount < MAX_INLINE_IMAGES &&
              inlineBytes + file.content.length <= MAX_INLINE_TOTAL_BYTES
            ) {
              inlineCount += 1;
              inlineBytes += file.content.length;
              attribs.src = `data:${file.contentType};base64,${file.content.toString("base64")}`;
            }
          }
          return { tagName: "img", attribs };
        },
      },
    });
  } catch (error) {
    if (error === tooComplex) return undefined;
    throw error;
  }
  return clean || undefined;
}
