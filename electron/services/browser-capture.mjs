export function normalizeCapture(value) {
  if (!value || typeof value.url !== "string" || value.url.length > 4096)
    throw new Error("网站地址不正确。");
  const url = new URL(value.url);
  if (!["https:", "http:"].includes(url.protocol) || !url.hostname)
    throw new Error("仅支持 HTTP 或 HTTPS 网站。");
  // 路径也可能含重置令牌；跨应用只传站点根地址。
  return {
    url: `${url.origin}/`,
    title:
      typeof value.title === "string"
        ? value.title
            .replace(/\p{Cc}/gu, "")
            .trim()
            .slice(0, 120) || url.hostname
        : url.hostname,
  };
}

export function captureUrl(value) {
  const capture = normalizeCapture(value);
  const url = new URL("nanpad://capture");
  url.searchParams.set("url", capture.url);
  url.searchParams.set("title", capture.title);
  return url.href;
}

export function parseCaptureUrl(value) {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "nanpad:" ||
      url.hostname !== "capture" ||
      !["", "/"].includes(url.pathname) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return null;
    if (
      [...url.searchParams.keys()].some((key) => !["url", "title"].includes(key)) ||
      url.searchParams.getAll("url").length !== 1 ||
      url.searchParams.getAll("title").length > 1
    )
      return null;
    return normalizeCapture({
      url: url.searchParams.get("url"),
      title: url.searchParams.get("title"),
    });
  } catch {
    return null;
  }
}

export class CaptureQueue {
  #items = [];
  #next = 0;
  add(value) {
    const capture = parseCaptureUrl(value);
    if (!capture || this.#items.length >= 10) return false;
    if (this.#items.some((item) => item.url === capture.url)) return false;
    this.#items.push({ ...capture, id: String(++this.#next) });
    return true;
  }
  list() {
    return this.#items.map((item) => ({ ...item }));
  }
  discard(id) {
    this.#items = this.#items.filter((item) => item.id !== id);
  }
}
