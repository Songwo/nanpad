import assert from "node:assert/strict";
import test from "node:test";
import { AUTOMATIC_PROBE_TTL_MS, shouldRefreshProbe } from "../src/lib/probe-cache.mjs";

const now = Date.parse("2026-10-08T10:00:00Z");
test("自动探测重用90秒内成功或失败的结果，避免反复解锁时再次连接", () => {
  for (const probeError of [undefined, "连接失败"]) {
    const asset = { probedAt: new Date(now - 20_000).toISOString(), probeError };
    assert.equal(shouldRefreshProbe(asset, { force: false, now }), false);
    assert.equal(
      shouldRefreshProbe(asset, { force: false, now: now + AUTOMATIC_PROBE_TTL_MS }),
      true,
    );
  }
});
test("手动刷新始终检查；缺失、失效及未来时间不能阻止自动探测", () => {
  assert.equal(shouldRefreshProbe({ probedAt: new Date(now).toISOString() }, { now }), true);
  for (const probedAt of [undefined, "invalid", new Date(now + 1000).toISOString()])
    assert.equal(shouldRefreshProbe({ probedAt }, { force: false, now }), true);
  assert.equal(
    shouldRefreshProbe(
      { probedAt: new Date(now - AUTOMATIC_PROBE_TTL_MS).toISOString() },
      { force: false, now },
    ),
    true,
  );
});
