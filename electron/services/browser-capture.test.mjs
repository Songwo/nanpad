import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCapture, captureUrl, parseCaptureUrl, CaptureQueue } from "./browser-capture.mjs";

test("插件移除路径、查询、片段和嵌入凭据", () => {
  const value = normalizeCapture({
    url: "https://user:secret@example.com/reset/token?code=secret#key",
    title: " 网站\n ",
  });
  assert.deepEqual(value, { url: "https://example.com/", title: "网站" });
  assert.deepEqual(parseCaptureUrl(captureUrl(value)), value);
});
test("外部协议拒绝非网站、重复参数、未知路由及额外凭据字段", () => {
  for (const url of ["file:///secret", "javascript:alert(1)", "data:text/plain,test"])
    assert.throws(() => normalizeCapture({ url }));
  for (const url of [
    "nanpad://delete?url=https://example.com",
    "nanpad://capture/x?url=https://example.com",
    "nanpad://capture?url=https://a.com&url=https://b.com",
    "nanpad://capture?url=https://example.com&password=secret",
    "nanpad://user:pass@capture?url=https://example.com",
    "nanpad://capture?url=file:///secret",
    "nanpad://capture?url=%",
    "x".repeat(9000),
  ])
    assert.equal(parseCaptureUrl(url), null, url.slice(0, 80));
});
test("接收队列去重、限制长度、按编号丢弃且不覆盖在编写的请求", () => {
  const queue = new CaptureQueue();
  for (let i = 0; i < 10; i++)
    assert.equal(queue.add(captureUrl({ url: `https://${i}.example.com` })), true);
  assert.equal(queue.add(captureUrl({ url: "https://new.example.com" })), false);
  assert.equal(queue.add(captureUrl({ url: "https://0.example.com" })), false);
  const first = queue.list()[0];
  first.title = "changed";
  assert.notEqual(queue.list()[0].title, "changed");
  queue.discard(first.id);
  assert.equal(queue.list().length, 9);
  assert.equal(queue.add(captureUrl({ url: "https://new.example.com" })), true);
});
