import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentsStore, normalizeDocument, documentLink } from "./documents.mjs";
const doc = () => ({
  id: "doc-test",
  title: "部署说明",
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "查看文档",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
        ],
      },
    ],
  },
  bindings: [],
});
test("文档独立保存、跨重启读取、多资产绑定和解除", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nanpad-docs-"));
  try {
    const store = new DocumentsStore(dir);
    const saved = await store.save(doc());
    assert.equal((await store.list())[0].excerpt, "查看文档");
    await store.save({
      ...saved,
      bindings: [
        { kind: "server", id: "s1" },
        { kind: "ai", id: "a1" },
        { kind: "ai", id: "a1" },
      ],
    });
    const restarted = new DocumentsStore(dir);
    assert.equal((await restarted.get(saved.id)).bindings.length, 2);
    await restarted.save({ ...(await restarted.get(saved.id)), bindings: [] });
    assert.deepEqual((await restarted.get(saved.id)).bindings, []);
    await restarted.remove(saved.id);
    assert.deepEqual(await restarted.list(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("文档并发写入有序，失败不会阻塞后续保存", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nanpad-docs-"));
  try {
    const store = new DocumentsStore(dir);
    await Promise.all([
      store.save({ ...doc(), title: "一" }),
      store.save({ ...doc(), title: "二" }),
    ]);
    assert.equal((await store.get("doc-test")).title, "二");
    assert.throws(() => store.save({ ...doc(), id: "../secrets" }));
    await store.save({ ...doc(), title: "三" });
    assert.equal((await store.get("doc-test")).title, "三");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("文档拒绝危险链接、外部图片、脚本和路径穿越", () => {
  assert.equal(documentLink("javascript:alert(1)"), null);
  assert.equal(documentLink("https://user:pass@example.com"), null);
  assert.throws(() => normalizeDocument({ ...doc(), id: "doc-../../secret" }));
  assert.throws(() =>
    normalizeDocument({ ...doc(), content: { type: "doc", content: [{ type: "script" }] } }),
  );
  assert.throws(() =>
    normalizeDocument({
      ...doc(),
      content: {
        type: "doc",
        content: [{ type: "image", attrs: { src: "https://example.com/a.png" } }],
      },
    }),
  );
});
test("文档图片保存保留真实 PNG 与摘要", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nanpad-docs-"));
  try {
    const store = new DocumentsStore(dir);
    const src =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZZkAAAAASUVORK5CYII=";
    await store.save({
      ...doc(),
      content: { type: "doc", content: [{ type: "image", attrs: { src } }] },
    });
    assert.equal((await store.list())[0].imageCount, 1);
    assert.equal((await store.get("doc-test")).content.content[0].attrs.src, src);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
