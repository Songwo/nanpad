import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, rename, unlink, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentsStore, normalizeDocument, documentLink, documentRevision } from "./documents.mjs";
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
test("Markdown 原文跨重启和元数据编辑保留，列表不携带正文", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nanpad-docs-markdown-"));
  const markdown =
    "# 源码\r\n\r\n| 名称 | 值 |\r\n| --- | --- |\r\n| 应用 | 知屿 |\r\n\r\n- [x] 保留格式\r\n";
  try {
    const store = new DocumentsStore(dir);
    const saved = await store.save({ ...doc(), markdown });
    assert.equal(saved.markdown, markdown);
    assert.equal(saved.content.content[0].type, "heading");
    assert.notEqual(
      documentRevision(saved),
      documentRevision({ ...saved, markdown: markdown + "\r\n" }),
    );
    await store.save({ ...saved, title: "修改标题", bindings: [{ kind: "secret", id: "s1" }] });
    const reopened = new DocumentsStore(dir);
    assert.equal((await reopened.get(saved.id)).markdown, markdown);
    assert.equal("markdown" in (await reopened.list())[0], false);
    assert.equal("markdown" in (await reopened.listMetadata()).documents[0], false);
    const { markdown: _markdown, ...rich } = await reopened.get(saved.id);
    await reopened.save(rich);
    assert.equal("markdown" in (await reopened.get(saved.id)), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("Markdown 保存允许清空但拒绝错误类型与超限原文", () => {
  assert.equal(normalizeDocument({ ...doc(), markdown: "" }).markdown, "");
  assert.throws(() => normalizeDocument({ ...doc(), markdown: {} }), /源码必须是文本/);
  assert.throws(() => normalizeDocument({ ...doc(), markdown: "中".repeat(400000) }), /1 MiB/);
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

test("迁移只创建一次，不覆盖已编辑和已解绑的文档", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nanpad-docs-import-"));
  try {
    const store = new DocumentsStore(dir);
    const first = await store.save({ ...doc(), createOnly: true });
    const edited = await store.save({ ...first, title: "用户新标题", bindings: [] });
    const repeated = await store.save({
      ...doc(),
      createOnly: true,
      bindings: [{ kind: "server", id: "s1" }],
    });
    assert.deepEqual(repeated, edited);
    assert.equal("createOnly" in repeated, false);
    assert.equal((await store.list()).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("并发迁移请求保留首次保存的内容", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nanpad-docs-import-"));
  try {
    const store = new DocumentsStore(dir);
    const [first, second] = await Promise.all([
      store.save({ ...doc(), title: "首次内容", createOnly: true }),
      store.save({ ...doc(), title: "稍后内容", createOnly: true }),
    ]);
    assert.deepEqual(second, first);
    assert.equal((await store.get(first.id)).title, "首次内容");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function metadataFixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "zhiyu-document-metadata-"));
  let reads = 0;
  const store = new DocumentsStore(dir, {
    ...options,
    readMetadataFile: async (...args) => {
      reads++;
      return readFile(...args);
    },
  });
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, store, reads: () => reads };
}

test("工作区元信息冷读只返回白名单字段，暖读复用缓存且不再解析正文", async (t) => {
  const f = await metadataFixture(t);
  const saved = await f.store.save({
    ...doc(),
    title: "标题可能敏感但属于已授权元信息",
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "正文不进入元信息目录".repeat(50000) }],
        },
      ],
    },
    bindings: [{ kind: "server", id: "server-a" }],
  });
  const first = await f.store.listMetadata();
  assert.equal(f.reads(), 1);
  assert.equal(first.truncated, false);
  assert.deepEqual(Object.keys(first.documents[0]).sort(), [
    "bindings",
    "createdAt",
    "id",
    "title",
    "updatedAt",
  ]);
  assert.equal(first.documents[0].title, saved.title);
  assert.deepEqual(first.documents[0].bindings, saved.bindings);
  assert.doesNotMatch(JSON.stringify(first), /正文不进入|excerpt|content|imageCount/);
  assert.deepEqual(await f.store.listMetadata(), first);
  assert.deepEqual(await f.store.listMetadata(), first);
  assert.equal(f.reads(), 1);
  // 返回值不能反向污染内部缓存。
  first.documents[0].title = "伪造标题";
  first.documents[0].bindings[0].id = "fake";
  assert.equal((await f.store.listMetadata()).documents[0].title, saved.title);
  assert.equal((await f.store.listMetadata()).documents[0].bindings[0].id, "server-a");
  let coldReads = 0;
  const restarted = new DocumentsStore(f.dir, {
    readMetadataFile: async (...args) => {
      coldReads++;
      return readFile(...args);
    },
  });
  assert.equal((await restarted.listMetadata()).documents[0].title, saved.title);
  assert.equal(coldReads, 1);
  await restarted.listMetadata();
  assert.equal(coldReads, 1);
});

test("保存更新、解除绑定和删除使元信息缓存失效，界面摘要读取保持原行为", async (t) => {
  const f = await metadataFixture(t);
  await f.store.save({ ...doc(), bindings: [{ kind: "server", id: "server-a" }] });
  await f.store.listMetadata();
  assert.equal(f.reads(), 1);
  await f.store.save({ ...doc(), title: "已更新标题", bindings: [] });
  const metadata = await f.store.listMetadata();
  assert.equal(f.reads(), 2);
  assert.equal(metadata.documents[0].title, "已更新标题");
  assert.deepEqual(metadata.documents[0].bindings, []);
  assert.equal((await f.store.list())[0].excerpt, "查看文档");
  await f.store.remove("doc-test");
  assert.deepEqual(await f.store.listMetadata(), { documents: [], truncated: false });
  await f.store.save({ ...doc(), title: "同标识重新创建" });
  assert.equal((await f.store.listMetadata()).documents[0].title, "同标识重新创建");
  assert.equal(f.reads(), 3);
});

test("外部原地编辑、原子替换及删除都会刷新元信息目录", async (t) => {
  const f = await metadataFixture(t);
  const saved = await f.store.save(doc());
  const path = join(f.dir, "doc-test.json");
  await f.store.listMetadata();
  await writeFile(
    path,
    JSON.stringify({ ...saved, title: "外部编辑的新标题", bindings: [{ kind: "ai", id: "ai-a" }] }),
  );
  await utimes(path, new Date(), new Date(Date.now() + 2000));
  assert.equal((await f.store.listMetadata()).documents[0].title, "外部编辑的新标题");
  assert.equal(f.reads(), 2);
  const before = await stat(path);
  const external = JSON.parse(await readFile(path, "utf8"));
  const replacement = join(f.dir, "replacement.tmp");
  await writeFile(replacement, JSON.stringify({ ...external, title: "外部替换的新标题" }));
  await utimes(replacement, before.atime, before.mtime);
  await rename(replacement, path);
  assert.equal((await f.store.listMetadata()).documents[0].title, "外部替换的新标题");
  assert.equal(f.reads(), 3);
  await unlink(path);
  assert.deepEqual(await f.store.listMetadata(), { documents: [], truncated: false });
});

test("目录在读正文前截断且明确报告，正常 UI 列表不受 Agent 上限影响", async (t) => {
  const f = await metadataFixture(t, { metadataLimit: 2 });
  for (const id of ["doc-c", "doc-a", "doc-b"]) await f.store.save({ ...doc(), id });
  const metadata = await f.store.listMetadata();
  assert.equal(metadata.documents.length, 2);
  assert.equal(metadata.truncated, true);
  assert.equal(f.reads(), 2);
  assert.equal((await f.store.list()).length, 3);
  assert.ok((await f.store.list()).every((item) => item.excerpt === "查看文档"));
  await f.store.listMetadata();
  assert.equal(f.reads(), 2);
  await f.store.remove("doc-a");
  const next = await f.store.listMetadata();
  assert.equal(next.truncated, false);
  assert.deepEqual(next.documents.map((row) => row.id).sort(), ["doc-b", "doc-c"]);
  assert.equal(f.reads(), 3);
});

test("冷读不会遍历正文或生成图片派生信息，非法文件标识不能混入目录", async (t) => {
  const f = await metadataFixture(t);
  const saved = await f.store.save(doc());
  await writeFile(
    join(f.dir, "doc-test.json"),
    JSON.stringify({
      ...saved,
      content: { type: "script", text: "不属于元信息的内容" },
      excerpt: "不应返回的摘要",
      imageCount: 200,
      password: "不应返回的额外字段",
    }),
  );
  const result = await f.store.listMetadata();
  assert.equal(result.documents[0].title, saved.title);
  assert.doesNotMatch(JSON.stringify(result), /script|摘要|imageCount|password|额外字段/);
  await writeFile(join(f.dir, "doc-test.json"), JSON.stringify({ ...saved, id: "doc-other" }));
  await assert.rejects(f.store.listMetadata(), /无法读取工作区文档元信息/);
  await f.store.save({ ...doc(), title: "修复后正常读取" });
  assert.equal((await f.store.listMetadata()).documents[0].title, "修复后正常读取");
});

test("冷读期间外部文件变化会重新校验文件状态，不缓存错配的正文版本", async (t) => {
  const f = await metadataFixture(t);
  const saved = await f.store.save(doc());
  let reads = 0;
  const store = new DocumentsStore(f.dir, {
    readMetadataFile: async (path, encoding) => {
      const text = await readFile(path, encoding);
      reads++;
      if (reads === 1)
        await writeFile(path, JSON.stringify({ ...saved, title: "读取期间发生外部修改" }));
      return text;
    },
  });
  assert.equal((await store.listMetadata()).documents[0].title, "读取期间发生外部修改");
  assert.equal(reads, 2);
  await store.listMetadata();
  assert.equal(reads, 2);
});

test("元信息读取与保存串行，旧的冷读不能覆盖新保存后的缓存", async (t) => {
  const f = await metadataFixture(t);
  await f.store.save(doc());
  let enter, resume;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  const barrier = new Promise((resolve) => {
    resume = resolve;
  });
  let reads = 0;
  const store = new DocumentsStore(f.dir, {
    readMetadataFile: async (...args) => {
      reads++;
      if (reads === 1) {
        enter();
        await barrier;
      }
      return readFile(...args);
    },
  });
  const listing = store.listMetadata();
  await entered;
  const saving = store.save({ ...doc(), title: "串行保存的新标题" });
  resume();
  assert.equal((await listing).documents[0].title, "部署说明");
  await saving;
  assert.equal((await store.listMetadata()).documents[0].title, "串行保存的新标题");
  assert.equal(reads, 2);
});
