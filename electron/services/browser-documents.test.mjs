import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentsStore } from "./documents.mjs";
import { saveBrowserDocument, browserDocument } from "./browser-documents.mjs";

test("网页快照保留纯文本和来源，移除追踪/认证参数，同源重复不覆盖编辑", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "zhiyu-web-doc-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new DocumentsStore(directory);
  const input = {
    url: "https://docs.qq.com/doc/example?token=secret#auth",
    title: "网页资料",
    text: "第一段\n\n<script>仅作为文字</script>",
  };
  const first = await saveBrowserDocument(store, input);
  assert.equal(first.status, "created");
  const doc = await store.get(first.id);
  const raw = JSON.stringify(doc);
  assert.equal(raw.includes("token=secret"), false);
  assert.equal(raw.includes("https://docs.qq.com/doc/example"), true);
  assert.equal(doc.content.content[0].content[0].text, "第一段");
  await store.save({ ...doc, title: "本机编辑" });
  assert.equal((await saveBrowserDocument(store, input)).status, "existing");
  assert.equal((await store.get(first.id)).title, "本机编辑");
});

test("公众号标识保留以区分文章，不保存网页结构或无限正文", () => {
  const a = browserDocument({
    url: "https://mp.weixin.qq.com/s?__biz=public&mid=1&idx=1&sn=aaa&key=secret",
    title: "文章",
    text: "",
  });
  const b = browserDocument({
    url: "https://mp.weixin.qq.com/s?__biz=public&mid=2&idx=1&sn=bbb",
    title: "文章",
    text: "",
  });
  assert.notEqual(a.id, b.id);
  assert.equal(JSON.stringify(a).includes("key=secret"), false);
  for (const url of ["javascript:alert(1)", "https://u:p@example.test/", "http://example.test/"]) {
    assert.throws(() => browserDocument({ url, title: "a", text: "a" }));
  }
  assert.throws(() =>
    browserDocument({ url: "https://example.test/", title: "a", text: "a".repeat(200001) }),
  );
});

test("写入队列开始前授权失效，不产生文档文件", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "zhiyu-web-doc-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new DocumentsStore(directory);
  await assert.rejects(
    saveBrowserDocument(
      store,
      { url: "https://example.test/", title: "资料", text: "正文" },
      () => {
        throw new Error("locked");
      },
    ),
    /locked/,
  );
  assert.equal((await store.list()).length, 0);
});
