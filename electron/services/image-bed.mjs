import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { inspectRaster } from "./image-data.mjs";
import { hostedImageUrl } from "./hosted-image.mjs";
export const IMAGE_BED_ORIGIN = "https://zensimagebed.pages.dev";
export class ImageBed {
  #file;
  #storage;
  #fetch;
  #decode;
  #queue = Promise.resolve();
  constructor({ file, secureStorage, fetchImpl = fetch, decode }) {
    this.#file = file;
    this.#storage = secureStorage;
    this.#fetch = fetchImpl;
    this.#decode = decode;
  }
  async #read() {
    try {
      return JSON.parse(await readFile(this.#file, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return { enabled: false };
      throw new Error("图床配置读取失败，请检查本机配置文件");
    }
  }
  async status() {
    await this.#queue;
    const config = await this.#read();
    return {
      configured: Boolean(config.encryptedKey),
      enabled: Boolean(config.enabled && config.encryptedKey),
      origin: IMAGE_BED_ORIGIN,
    };
  }
  configure(input) {
    const job = this.#queue.then(async () => {
      if (
        !this.#storage.isEncryptionAvailable() ||
        this.#storage.getSelectedStorageBackend?.() === "basic_text"
      )
        throw new Error("操作系统加密存储不可用，未保存 Key");
      const config = await this.#read();
      if (input?.apiKey) {
        const key = String(input.apiKey).trim();
        if (!/^zib_[A-Za-z0-9]{16,128}$/.test(key)) throw new Error("图床 API Key 格式无效");
        config.encryptedKey = this.#storage.encryptString(key).toString("base64");
      }
      if (typeof input?.enabled === "boolean") config.enabled = input.enabled;
      if (config.enabled && !config.encryptedKey) throw new Error("请先填写图床 API Key");
      await mkdir(dirname(this.#file), { recursive: true });
      await writeFile(this.#file + ".tmp", JSON.stringify(config), { mode: 0o600 });
      await rename(this.#file + ".tmp", this.#file);
      return {
        configured: Boolean(config.encryptedKey),
        enabled: Boolean(config.enabled && config.encryptedKey),
        origin: IMAGE_BED_ORIGIN,
      };
    });
    this.#queue = job.catch(() => {});
    return job;
  }
  async upload(input) {
    await this.#queue;
    const config = await this.#read();
    if (!config.enabled || !config.encryptedKey) throw new Error("图床尚未启用，请先配置 Key");
    const match =
      typeof input?.dataUrl === "string" &&
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.dataUrl);
    if (!match || input.dataUrl.length > 12 * 1024 * 1024)
      throw new Error("只支持 8 MiB 以内的 PNG、JPEG、WebP 图片");
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > 8 * 1024 * 1024 || bytes.toString("base64") !== match[2])
      throw new Error("图片编码无效或超过 8 MiB");
    const mime = "image/" + match[1];
    inspectRaster(bytes, mime);
    if (this.#decode && !this.#decode(input.dataUrl))
      throw new Error("图片无法解码，请重新选择图片");
    let key;
    try {
      key = this.#storage.decryptString(Buffer.from(config.encryptedKey, "base64"));
    } catch {
      throw new Error("无法解密图床 Key，请在当前系统重新配置");
    }
    const folder = input.kind === "asset" ? "nanpad/assets" : "nanpad/documents";
    const filename =
      (typeof input.filename === "string" ? input.filename : "image")
        .replace(/[^\p{L}\p{N}_.-]/gu, "_")
        .slice(0, 120)
        .replace(/\.[^.]*$/, "") +
      "." +
      (match[1] === "jpeg" ? "jpg" : match[1]);
    const body = new FormData();
    body.append("file", new Blob([bytes], { type: mime }), filename);
    body.append("tags", input.kind === "asset" ? "nanpad,asset" : "nanpad,document");
    body.append("folder", folder);
    let response;
    try {
      response = await this.#fetch(IMAGE_BED_ORIGIN + "/api/upload/direct", {
        method: "POST",
        headers: { Authorization: "Bearer " + key },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new Error("图床上传失败或超时，请检查网络后重试");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        response.status === 401 || response.status === 403
          ? "图床 Key 无效或没有上传权限，请更新 Key"
          : `图床上传失败（HTTP ${response.status}），请稍后重试`,
      );
    }
    let text = "",
      length = 0;
    const reader = response.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 65536) throw new Error("图床响应过大");
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("图床返回了无效响应，未插入图片");
    }
    const url = hostedImageUrl(data.url);
    if (!url || url.includes(key)) throw new Error("图床未返回有效 HTTPS 图片地址");
    return {
      url,
      key: typeof data.key === "string" ? data.key.slice(0, 1024) : "",
      filename: typeof data.filename === "string" ? data.filename.slice(0, 200) : filename,
      size: typeof data.size === "number" ? data.size : bytes.length,
    };
  }
}
