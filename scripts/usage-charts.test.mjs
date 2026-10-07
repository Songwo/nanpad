import test from "node:test";
import assert from "node:assert/strict";
import { buildUsageChart, buildQuotaChart } from "../src/lib/usage-charts.mjs";
import { filterUsage } from "../src/lib/usage-insights.mjs";

const base = {
  sourceId: "one",
  sourceName: "测试来源",
  key: "one",
  kind: "tokens",
  label: "样本",
  checkedAt: "2026-10-07T04:00:00Z",
  bucketStart: "2026-10-07",
  input: 100,
  output: 25,
  cached: 80,
  cacheWrite: 10,
  model: "模型 A",
};

test("图表单独统计 API 与本机，缓存不重复计入输入", () => {
  const rows = [base, { ...base, origin: "local", input: 50 }];
  assert.equal(buildUsageChart(rows, "api").total, 125);
  assert.equal(buildUsageChart(rows, "local").total, 75);
  assert.deepEqual(buildUsageChart(rows, "api").daily[0], {
    day: "2026-10-07",
    first: 100,
    second: 25,
    total: 125,
    samples: 1,
    unknown: 0,
  });
});

test("流量按采集日归集已确认增量，首采和重置为 null", () => {
  const traffic = {
    ...base,
    kind: "traffic",
    bucketStart: "2026-01-01",
    upload: 99999,
    download: 99999,
  };
  const chart = buildUsageChart(
    [
      { ...traffic, checkedAt: new Date(2026, 9, 5, 12).toISOString() },
      { ...traffic, deltaUpload: 20, deltaDownload: 30 },
      { ...traffic, counterReset: true, deltaUpload: 500, deltaDownload: 900 },
      { ...traffic, deltaUpload: -2, deltaDownload: 7 },
    ],
    "traffic",
  );
  assert.equal(chart.total, 50);
  assert.equal(chart.unknown, 3);
  assert.equal(chart.daily[0].day, "2026-10-05");
  assert.equal(chart.daily[0].total, null);
  assert.equal(chart.daily[1].total, 50);
  assert.equal(chart.daily.length, 2, "不为没有采集的日期虚构 0");
});

test("确认的零值与未知值区分，空数据不生成假曲线", () => {
  assert.equal(buildUsageChart([], "api").daily.length, 0);
  const chart = buildUsageChart(
    [{ ...base, kind: "traffic", deltaUpload: 0, deltaDownload: 0 }],
    "traffic",
  );
  assert.equal(chart.samples, 1);
  assert.equal(chart.total, 0);
  assert.equal(chart.daily[0].total, 0);
});

test("来源重名仍保持独立，模型构成和日期来源筛选一致", () => {
  const rows = [
    base,
    { ...base, sourceId: "two", model: "模型 B", input: 200 },
    { ...base, bucketStart: "2026-09-01" },
  ];
  assert.equal(buildUsageChart(rows, "api").composition.length, 2);
  const filtered = filterUsage(
    rows,
    { source: "two", model: "模型 B", period: "7" },
    new Date(2026, 9, 7, 14).getTime(),
  );
  assert.equal(buildUsageChart(filtered, "api", "model").total, 225);
  assert.equal(buildUsageChart(filtered, "api", "model").composition[0].name, "模型 B");
});

test("本机统计日保留本地午夜语义", () => {
  const chart = buildUsageChart(
    [{ ...base, origin: "local", bucketStart: new Date(2026, 9, 7, 0).toISOString() }],
    "local",
  );
  assert.equal(chart.daily[0].day, "2026-10-07");
});

test("额度按来源与窗口选最新快照，每日取最后一次且不累加百分比", () => {
  const quota = { ...base, kind: "quota", key: "5h", usedPercent: 80 };
  const charts = buildQuotaChart([
    { ...quota, checkedAt: "2026-10-06T01:00:00Z" },
    { ...quota, checkedAt: "2026-10-07T01:00:00Z", usedPercent: 90 },
    { ...quota, checkedAt: "2026-10-07T04:00:00Z", usedPercent: 10 },
    { ...quota, key: "weekly", usedPercent: 45 },
    { ...quota, sourceId: "two", usedPercent: 25 },
  ]);
  assert.equal(charts.length, 3);
  const chart = charts.find((item) => item.id === JSON.stringify(["one", "5h"]));
  assert.equal(chart.value, 10);
  assert.deepEqual(
    chart.daily.map((day) => day.value),
    [80, 10],
  );
});

test("额度最新快照未知时不沿用旧数值或补零", () => {
  const quota = { ...base, kind: "quota", usedPercent: 60 };
  const [chart] = buildQuotaChart([
    quota,
    { ...quota, checkedAt: "2026-10-08T04:00:00Z", usedPercent: null },
  ]);
  assert.equal(chart.value, null);
  assert.equal(chart.daily[1].value, null);
});
