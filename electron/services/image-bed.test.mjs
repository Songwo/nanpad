import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageBed, IMAGE_BED_ORIGIN } from "./image-bed.mjs";
import { hostedImageUrl } from "./hosted-image.mjs";
import { normalizeSnapshotImages } from "./image-data.mjs";
import { DocumentsStore } from "./documents.mjs";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const key = "zib_" + "a".repeat(32);
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: () => Buffer.from("encrypted-test-record"),
  decryptString: () => key,
};
test("内部上传使用固定端点、Bearer、multipart、文档目录，状态不回传密钥", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nanpad-image-"));
  try {
    const api = new ImageBed({
      file: join(dir, "config.json"),
      secureStorage: storage,
      fetchImpl: async (url, options) => {
        assert.equal(url, IMAGE_BED_ORIGIN + "/api/upload/direct");
        assert.equal(options.headers.Authorization, "Bearer " + key);
        assert.equal(options.redirect, "error");
        assert.equal(options.body.get("folder"), "nanpad/documents");
        assert.equal(options.body.get("tags"), "nanpad,document");
        assert.equal(options.body.get("file").type, "image/png");
        return new Response(
          JSON.stringify({
            url: "https://tumbr.me/test.png",
            key: "test.png",
            filename: "test.png",
            size: 100,
          }),
        );
      },
    });
    await api.configure({ apiKey: key, enabled: true });
    assert.ok(!(await readFile(join(dir, "config.json"), "utf8")).includes(key));
    assert.deepEqual(await api.status(), {
      enabled: true,
      configured: true,
      origin: IMAGE_BED_ORIGIN,
    });
    assert.equal(
      (await api.upload({ dataUrl: png, filename: "照片.png", kind: "document" })).url,
      "https://tumbr.me/test.png",
    );
    await api.configure({ enabled: false });
    await assert.rejects(api.upload({ dataUrl: png }), /尚未启用/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("上传拒绝伪图片、失效 Key、非图床响应及重定向，不回显服务端敏感正文", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nanpad-image-errors-"));
  try {
    let mode = 0;
    const api = new ImageBed({
      file: join(dir, "config.json"),
      secureStorage: storage,
      fetchImpl: async () =>
        mode === 0
          ? new Response(key, { status: 401 })
          : mode === 1
            ? new Response(JSON.stringify({ url: "https://evil.example/test.png" }))
            : Promise.reject(new Error(key)),
    });
    await api.configure({ apiKey: key, enabled: true });
    await assert.rejects(api.upload({ dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" }), /只支持/);
    await assert.rejects(
      api.upload({ dataUrl: png }),
      (e) => /Key 无效/.test(e.message) && !e.message.includes(key),
    );
    mode = 1;
    await assert.rejects(api.upload({ dataUrl: png }), /HTTPS/);
    mode = 2;
    await assert.rejects(
      api.upload({ dataUrl: png }),
      (e) => /超时/.test(e.message) && !e.message.includes(key),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("图床图片在文档和资产快照中保存与恢复，旧内嵌图片仍兼容", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nanpad-hosted-doc-"));
  try {
    const url = "https://tumbr.me/2026-09-22/nanpad/documents/photo.webp";
    const store = new DocumentsStore(dir);
    await store.save({
      id: "doc-hosted",
      title: "图床文档",
      bindings: [],
      content: {
        type: "doc",
        content: [
          { type: "image", attrs: { src: url, alt: "部署截图" } },
          { type: "image", attrs: { src: png } },
        ],
      },
    });
    assert.equal(
      (await new DocumentsStore(dir).get("doc-hosted")).content.content[0].attrs.src,
      url,
    );
    assert.equal((await store.list())[0].imageCount, 2);
    assert.equal(
      normalizeSnapshotImages({ servers: [{ id: "s", imageDataUrl: url }] }).servers[0]
        .imageDataUrl,
      url,
    );
    for (const invalid of [
      "javascript:alert(1)",
      "https://user:pass@tumbr.me/x.png",
      "http://tumbr.me/x.png",
      "https://tumbr.me.evil.example/x.png",
    ])
      assert.equal(hostedImageUrl(invalid), "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("系统加密不可用时不保存明文 Key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nanpad-encryption-"));
  try {
    const api = new ImageBed({
      file: join(dir, "config.json"),
      secureStorage: { ...storage, isEncryptionAvailable: () => false },
    });
    await assert.rejects(api.configure({ apiKey: key, enabled: true }), /加密存储不可用/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
