import { usageDay } from "./usage-insights.mjs";

/** @typedef {import('./usage').UsageRecord} UsageRecord */
/** @typedef {'api'|'local'|'traffic'|'quota'} ChartMetric */
/** @typedef {{day:string, first:number|null, second:number|null, total:number|null, samples:number, unknown:number}} DailyPoint */
/** @typedef {{id:string, name:string, value:number, first:number, second:number}} CompositionPoint */

/** @param {UsageRecord} row @returns {ChartMetric} */
export function chartMetric(row) {
  return row.kind === "tokens" ? (row.origin === "local" ? "local" : "api") : row.kind;
}

/** @param {number|null|undefined} value */
const valid = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** 采集型记录使用本地采集日，与页面时间筛选保持一致。
 * @param {UsageRecord} row
 */
function collectionDay(row) {
  const date = new Date(row.checkedAt);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 仅汇总一种单位；缺失或重置的流量增量保持未知，不补零。
 * @param {UsageRecord[]} rows
 * @param {Exclude<ChartMetric,'quota'>} metric
 * @param {'source'|'model'} group
 */
export function buildUsageChart(rows, metric, group = "source") {
  /** @type {Map<string,DailyPoint>} */
  const days = new Map();
  /** @type {Map<string,CompositionPoint>} */
  const groups = new Map();
  let unknown = 0;
  let samples = 0;
  for (const row of rows) {
    if (chartMetric(row) !== metric) continue;
    const day = row.kind === "tokens" ? usageDay(row) || collectionDay(row) : collectionDay(row);
    if (!day) continue;
    const point = days.get(day) ?? {
      day,
      first: null,
      second: null,
      total: null,
      samples: 0,
      unknown: 0,
    };
    days.set(day, point);
    const first = metric === "traffic" ? row.deltaUpload : (row.input ?? 0);
    const second = metric === "traffic" ? row.deltaDownload : (row.output ?? 0);
    if ((metric === "traffic" && row.counterReset) || !valid(first) || !valid(second)) {
      point.unknown++;
      unknown++;
      continue;
    }
    const a = /** @type {number} */ (first);
    const b = /** @type {number} */ (second);
    point.first = (point.first ?? 0) + a;
    point.second = (point.second ?? 0) + b;
    point.total = (point.total ?? 0) + a + b;
    point.samples++;
    samples++;
    const id =
      group === "model" && metric !== "traffic"
        ? JSON.stringify(["model", row.model ?? null])
        : JSON.stringify(["source", row.sourceId]);
    const name = group === "model" && metric !== "traffic" ? (row.model ?? "") : row.sourceName;
    const item = groups.get(id) ?? { id, name, value: 0, first: 0, second: 0 };
    item.first += a;
    item.second += b;
    item.value += a + b;
    groups.set(id, item);
  }
  const composition = [...groups.values()].sort(
    (a, b) => b.value - a.value || a.id.localeCompare(b.id),
  );
  return {
    daily: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    composition,
    total: composition.reduce((total, item) => total + item.value, 0),
    first: composition.reduce((total, item) => total + item.first, 0),
    second: composition.reduce((total, item) => total + item.second, 0),
    samples,
    unknown,
  };
}

/** 窗口由来源及采集器的稳定 key 标识；不同账号的同名窗口保持独立。
 * @param {UsageRecord[]} rows
 */
export function buildQuotaChart(rows) {
  /** @type {Map<string,{id:string, name:string, label:string, latest:UsageRecord, history:UsageRecord[]}>} */
  const groups = new Map();
  for (const row of rows) {
    if (row.kind !== "quota" || !Number.isFinite(Date.parse(row.checkedAt))) continue;
    const id = JSON.stringify([row.sourceId, row.key]);
    const group = groups.get(id) ?? {
      id,
      name: row.sourceName,
      label: row.label,
      latest: row,
      history: [],
    };
    group.history.push(row);
    if (Date.parse(row.checkedAt) >= Date.parse(group.latest.checkedAt)) group.latest = row;
    groups.set(id, group);
  }
  return [...groups.values()]
    .map((group) => {
      /** @type {Map<string,UsageRecord>} */
      const days = new Map();
      group.history.sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt));
      for (const row of group.history) days.set(collectionDay(row), row);
      return {
        id: group.id,
        name: `${group.name} · ${group.label}`,
        value: valid(group.latest.usedPercent) ? group.latest.usedPercent : null,
        checkedAt: group.latest.checkedAt,
        daily: [...days].map(([day, row]) => ({
          day,
          value: valid(row.usedPercent) ? row.usedPercent : null,
          checkedAt: row.checkedAt,
        })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
