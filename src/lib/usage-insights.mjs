/** @typedef {import('./usage').UsageRecord} UsageRecord */

/** @param {UsageRecord} row */
export function usageDay(row) {
  if (!row.bucketStart) return "";
  if (row.origin !== "local") return row.bucketStart.slice(0, 10);
  const day = new Date(row.bucketStart);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/** 按来源范围筛选，组织账单与本机日志始终独立。日桶按其统计日筛选。
 * @param {UsageRecord[]} rows
 * @param {{category?:string, source?:string, period?:string, model?:string}} filters
 * @param {number} now
 */
export function filterUsage(rows, filters = {}, now = Date.now()) {
  const { category = "all", source = "all", period = "30", model = "all" } = filters;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period !== "all") start.setDate(start.getDate() - Math.max(0, Number(period) - 1));
  const startDay = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return rows
    .filter((row) => {
      const rowCategory =
        row.kind === "tokens" ? (row.origin === "local" ? "local" : "api") : row.kind;
      const inPeriod =
        period === "all" ||
        (row.bucketStart
          ? usageDay(row) >= startDay
          : Date.parse(row.checkedAt) >= start.getTime());
      return (
        (category === "all" || category === rowCategory) &&
        (source === "all" || row.sourceId === source) &&
        (model === "all" || row.model === model) &&
        inPeriod
      );
    })
    .sort((a, b) => (b.bucketStart ?? b.checkedAt).localeCompare(a.bucketStart ?? a.checkedAt));
}

/** @param {UsageRecord[]} rows */
export function summarizeUsage(rows) {
  const result = {
    api: 0,
    local: 0,
    upload: 0,
    download: 0,
    trafficSamples: 0,
    unknownTraffic: 0,
    quota: 0,
  };
  const quotas = new Set();
  for (const row of rows) {
    if (row.kind === "tokens")
      result[row.origin === "local" ? "local" : "api"] += (row.input ?? 0) + (row.output ?? 0);
    if (row.kind === "traffic") {
      if (!row.counterReset && row.deltaUpload != null && row.deltaDownload != null) {
        result.upload += row.deltaUpload;
        result.download += row.deltaDownload;
        result.trafficSamples++;
      } else result.unknownTraffic++;
    }
    if (row.kind === "quota") quotas.add(row.sourceId);
  }
  result.quota = quotas.size;
  return result;
}

/** 只导出允许的统计字段；不透传扩展字段、凭据或内部文件信息。
 * @param {UsageRecord[]} rows
 */
export function exportUsage(rows) {
  const fields = /** @type {const} */ ([
    "sourceName",
    "kind",
    "origin",
    "model",
    "label",
    "checkedAt",
    "bucketStart",
    "sampleAt",
    "scope",
    "input",
    "output",
    "cached",
    "cacheWrite",
    "upload",
    "download",
    "total",
    "deltaUpload",
    "deltaDownload",
    "counterReset",
    "usedPercent",
    "used",
    "limit",
    "unit",
    "resetsAt",
    "expiresAt",
  ]);
  return rows.map((row) =>
    Object.fromEntries(
      fields.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]),
    ),
  );
}
