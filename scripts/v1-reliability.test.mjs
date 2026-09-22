import assert from "node:assert/strict";
import test from "node:test";
import { ProbeFlights, currentProbeAsset } from "../src/lib/probe-guard.ts";
import { subscriptionCost } from "../src/lib/subscription-cost.ts";
test("探测重叠只连接一次，完成后允许新探测，失败后允许重试", async () => {
  const flights = new ProbeFlights();
  let calls = 0;
  let release;
  const first = flights.run("a", () => {
    calls++;
    return new Promise((r) => (release = r));
  });
  const second = flights.run("a", async () => {
    calls++;
  });
  assert.equal(first, second);
  await Promise.resolve();
  release();
  await first;
  assert.equal(calls, 1);
  await assert.rejects(
    flights.run("a", async () => {
      throw Error("offline");
    }),
    /offline/,
  );
  await flights.run("a", async () => {
    calls++;
  });
  assert.equal(calls, 2);
});
test("探测结果保留期间新增的节点和名称，删除或更改连接目标则丢弃", () => {
  const original = { id: "s", host: "a", name: "旧名称", nodes: [] };
  const edited = { ...original, name: "新名称", nodes: ["hy2"] };
  assert.equal(currentProbeAsset([edited], original, ["host"]), edited);
  assert.equal(currentProbeAsset([], original, ["host"]), undefined);
  assert.equal(currentProbeAsset([{ ...edited, host: "b" }], original, ["host"]), undefined);
});
test("未知月费不等于免费，混合价格只汇总已知项", () => {
  assert.deepEqual(subscriptionCost([{ monthlyUsd: 0, monthlyUsdKnown: false }]), {
    total: 0,
    known: 0,
    missing: 1,
  });
  assert.deepEqual(
    subscriptionCost([
      { monthlyUsd: 0 },
      { monthlyUsd: 20 },
      { monthlyUsd: 100, monthlyUsdKnown: false },
      { monthlyUsd: NaN },
    ]),
    { total: 20, known: 2, missing: 2 },
  );
});
