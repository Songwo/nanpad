import test from "node:test";
import assert from "node:assert/strict";
import { createRefreshBatch } from "./refresh-batch.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

test("自动批次跳过缓存A且等待B时，多个人工请求合并为一次强制批次并补查A", async () => {
  const gate = deferred();
  const started = deferred();
  const calls = [];
  const refresh = createRefreshBatch(async (force) => {
    calls.push(["A", force]);
    if (!force) {
      started.resolve();
      await gate.promise;
    }
    calls.push(["B", force]);
    return { force };
  });
  const automatic = refresh(false);
  await started.promise;
  const manual = refresh(true);
  const secondManual = refresh(true);
  assert.equal(manual, secondManual);
  assert.equal(refresh(false), automatic);
  gate.resolve();
  assert.deepEqual(await automatic, { force: false });
  assert.deepEqual(await manual, { force: true });
  assert.deepEqual(calls, [
    ["A", false],
    ["B", false],
    ["A", true],
    ["B", true],
  ]);
});

test("自动失败不会吞掉排队的人工刷新，强制进行中同类请求仍复用", async () => {
  const gate = deferred();
  const forcedGate = deferred();
  const forcedStarted = deferred();
  let calls = 0;
  const refresh = createRefreshBatch(async (force) => {
    calls++;
    if (!force) {
      await gate.promise;
      throw Error("synthetic auto failure");
    }
    forcedStarted.resolve();
    await forcedGate.promise;
    return "fresh";
  });
  const automatic = refresh();
  const manual = refresh(true);
  const rejection = assert.rejects(automatic, /synthetic auto failure/);
  gate.resolve();
  await forcedStarted.promise;
  const joined = refresh(true);
  assert.equal(refresh(false), joined);
  forcedGate.resolve();
  await rejection;
  assert.deepEqual(await Promise.all([manual, joined]), ["fresh", "fresh"]);
  assert.equal(calls, 2);
});
