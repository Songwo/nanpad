/** 图床响应与文档中可显示的 HTTPS 图片地址。拒绝带凭据 URL 和脚本协议。 */
/** @param {unknown} value */
export function hostedImageUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["https://tumbr.me", "https://zensimagebed.pages.dev"].includes(url.origin) &&
      !url.username &&
      !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
