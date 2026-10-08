import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readMonitorMinutes,
  validateMonitorMinutes,
  startServerMonitor,
} from "../electron/services/server-monitor.mjs";
import { shouldRefreshProbe } from "../src/lib/probe-cache.mjs";

test("服务器手动模式不在启动时或后台执行采集", async () => {
  let requests = 0;
  const stop = startServerMonitor({
    minutes: 0,
    refresh: async () => requests++,
    schedule: () => assert.fail("不应创建定时器"),
  });
  await Promise.resolve();
  stop();
  assert.equal(requests, 0);
});
test("间隔配置按白名单读取，旧安装默认五分钟", () => {
  for (const n of [0, 1, 5, 15, 30, 60]) assert.equal(validateMonitorMinutes(n), n);
  for (const n of [-1, 0.1, NaN, "1", null]) assert.throws(() => validateMonitorMinutes(n));
  assert.equal(readMonitorMinutes(undefined), 5);
});
test("自动采集等待前次完成，页面不可见时跳过，停止后不重排", async () => {
  let finish;
  let requests = 0;
  let next;
  let delay;
  const stop = startServerMonitor({
    minutes: 15,
    refresh: () => {
      requests++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    schedule: (fn, ms) => {
      next = fn;
      delay = ms;
      return 1;
    },
    unschedule: () => {},
  });
  assert.equal(requests, 1);
  assert.equal(next, undefined);
  stop();
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(next, undefined);
  const hiddenStop = startServerMonitor({
    minutes: 15,
    visible: () => false,
    refresh: async () => {
      requests++;
    },
    schedule: (fn, ms) => {
      next = fn;
      delay = ms;
      return 2;
    },
    unschedule: () => {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal(delay, 900000);
  assert.equal(typeof next, "function");
  hiddenStop();
});
test("重新打开窗口复用所选采集周期内的缓存，手动强制刷新仍即时", () => {
  const now = Date.now();
  const asset = { probedAt: new Date(now - 120000).toISOString() };
  assert.equal(shouldRefreshProbe(asset, { force: false, now, minAgeMs: 900000 }), false);
  assert.equal(shouldRefreshProbe(asset, { force: true, now, minAgeMs: 900000 }), true);
});
