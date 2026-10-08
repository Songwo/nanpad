import test from "node:test";
import assert from "node:assert/strict";
import { createUsageResource } from "../src/lib/usage-resource.mjs";

function fixture() {
  let changed;
  let calls = 0;
  let data = { records: [{ input: 10 }], sources: [] };
  let status = { enabled: true, lastScannedAt: "first", sources: [] };
  const api = {
    onChanged(listener) {
      changed = listener;
      return () => {};
    },
    async list() {
      calls++;
      return data;
    },
    async localStatus() {
      return status;
    },
    async refreshLocal() {
      assert.fail("展示统计不得触发采集");
    },
    async refreshAll() {
      assert.fail("展示统计不得触发远程请求");
    },
  };
  const resource = createUsageResource(() => api);
  return {
    resource,
    calls: () => calls,
    publish(recordsChanged, input = 20) {
      data = { ...data, records: [{ input }] };
      status = { ...status, lastScannedAt: "next" };
      changed({ recordsChanged, localStatus: status });
    },
  };
}

test("采集完成立即失效新鲜缓存，多个展示方共用一次统计读取", async () => {
  const { resource, calls, publish } = fixture();
  await resource.read();
  const reads = [];
  resource.subscribe((recordsChanged) => {
    assert.equal(recordsChanged, true);
    reads.push(resource.read(), resource.read());
  });
  publish(true, 25);
  const values = await Promise.all(reads);
  assert.deepEqual(
    values.map((value) => value.data.records[0].input),
    [25, 25],
  );
  assert.equal(calls(), 2);
});

test("无新增用量的扫描只更新状态，保留相同统计对象且不重复读取", async () => {
  const { resource, calls, publish } = fixture();
  const original = await resource.read();
  let notified = false;
  resource.subscribe((recordsChanged) => {
    notified = true;
    assert.equal(recordsChanged, false);
  });
  publish(false);
  assert.equal(notified, true);
  assert.equal(resource.peek().data, original.data);
  assert.equal(resource.peek().status.lastScannedAt, "next");
  assert.equal(calls(), 1);
});

test("离开页面后事件仍使缓存失效，再进入不用等十秒", async () => {
  const { resource, calls, publish } = fixture();
  const unsubscribe = resource.subscribe(() => {});
  await resource.read();
  unsubscribe();
  publish(true, 40);
  assert.equal((await resource.read()).data.records[0].input, 40);
  assert.equal(calls(), 2);
});

test("采集完成发生在旧读取中，旧响应不能覆盖新记录或新扫描状态", async () => {
  let changed,
    release,
    calls = 0;
  const resource = createUsageResource(() => api);
  const api = {
    onChanged(listener) {
      changed = listener;
      return () => {};
    },
    list() {
      return ++calls === 1
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve({ records: [20] });
    },
    async localStatus() {
      return { lastScannedAt: calls === 1 ? "old" : "new" };
    },
  };
  const first = resource.read();
  await Promise.resolve();
  changed({ recordsChanged: true, localStatus: { lastScannedAt: "new" } });
  const second = resource.read();
  release({ records: [10] });
  const values = await Promise.all([first, second]);
  for (const value of values) {
    assert.deepEqual(value.data.records, [20]);
    assert.equal(value.status.lastScannedAt, "new");
  }
  assert.equal(calls, 2);
});
