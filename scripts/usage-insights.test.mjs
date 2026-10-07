import test from "node:test";
import assert from "node:assert/strict";
import { filterUsage, summarizeUsage, exportUsage, usageDay } from "../src/lib/usage-insights.mjs";

const row = {
  sourceId: "api",
  sourceName: "测试组织",
  key: "day",
  kind: "tokens",
  label: "model",
  checkedAt: "2026-10-06T10:00:00Z",
  bucketStart: "2026-10-06",
  input: 100,
  output: 20,
  cached: 50,
};
test("本机日志与组织用量分开，缓存不重复累加", () => {
  const summary = summarizeUsage([row, { ...row, origin: "local", input: 50 }]);
  assert.equal(summary.api, 120);
  assert.equal(summary.local, 70);
});
test("流量只累计可确认增量，首采和重置不伪造数据", () => {
  const base = { ...row, kind: "traffic", upload: 9000, download: 10000 };
  const summary = summarizeUsage([
    base,
    { ...base, deltaUpload: 30, deltaDownload: 50 },
    { ...base, counterReset: true, deltaUpload: 1, deltaDownload: 2 },
  ]);
  assert.equal(summary.upload, 30);
  assert.equal(summary.download, 50);
  assert.equal(summary.unknownTraffic, 2);
});
test("时间、来源、范围及模型筛选同时生效", () => {
  const rows = [
    row,
    { ...row, origin: "local", sourceId: "local:codex", model: "gpt-test" },
    { ...row, bucketStart: "2026-09-01" },
  ];
  const now = new Date(2026, 9, 6, 15).getTime();
  assert.equal(
    filterUsage(
      rows,
      { category: "local", source: "local:codex", period: "1", model: "gpt-test" },
      now,
    ).length,
    1,
  );
  assert.equal(filterUsage(rows, { category: "api", period: "7" }, now).length, 1);
  assert.equal(filterUsage(rows, { period: "all" }, now).length, 3);
});
test("导出不会透传凭据和完整文件路径", () => {
  const output = exportUsage([
    { ...row, apiKey: "secret", path: "C:/private/log", prompt: "private text" },
  ]);
  assert.equal(output[0].input, 100);
  assert.doesNotMatch(JSON.stringify(output), /secret|private|apiKey/);
});
test("本机统计日按本地午夜还原，不被UTC日期切到前一天", () => {
  const local = { ...row, origin: "local", bucketStart: new Date(2026, 9, 6, 0).toISOString() };
  assert.equal(usageDay(local), "2026-10-06");
  assert.equal(filterUsage([local], { period: "1" }, new Date(2026, 9, 6, 1).getTime()).length, 1);
});
