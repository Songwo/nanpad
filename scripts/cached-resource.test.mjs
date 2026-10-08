import test from "node:test";
import assert from "node:assert/strict";
import { createCachedResource } from "../src/lib/cached-resource.mjs";

test("重复进入页面命中快照，并发后台读取只执行一次", async () => {
  let calls = 0,
    clock = 0;
  const cache = createCachedResource(async () => ({ count: ++calls }), {
    maxAge: 100,
    now: () => clock,
  });
  const results = await Promise.all([cache.read(), cache.read(), cache.read()]);
  assert.equal(calls, 1);
  assert.equal(results[0], results[1]);
  await cache.read();
  assert.equal(calls, 1);
  clock = 101;
  assert.equal(cache.peek().count, 1);
  await cache.read();
  assert.equal(calls, 2);
  await cache.read(true);
  assert.equal(calls, 3);
});
test("刷新失败保留已有数据，并允许重试", async () => {
  let broken = false;
  const cache = createCachedResource(async () => {
    if (broken) throw Error("offline");
    return 7;
  });
  await cache.read();
  broken = true;
  await assert.rejects(cache.read(true), /offline/);
  assert.equal(cache.peek(), 7);
  broken = false;
  assert.equal(await cache.read(), 7);
});
test("写入时失效旧请求，过期响应不能覆盖新统计", async () => {
  let release,
    calls = 0;
  const cache = createCachedResource(async () => {
    if (++calls === 1)
      return await new Promise((done) => {
        release = done;
      });
    return "new";
  });
  const first = cache.read();
  await Promise.resolve();
  const second = cache.read(true);
  release("old");
  assert.deepEqual(await Promise.all([first, second]), ["new", "new"]);
  assert.equal(calls, 2);
  assert.equal(cache.peek(), "new");
});
