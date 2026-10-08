export const AUTOMATIC_PROBE_TTL_MS = 90_000;

/** 自动检查复用最近一次结果（含失败），手动刷新仍立即检查。
 * @param {{probedAt?: string}} asset
 */
export function shouldRefreshProbe(
  asset,
  { force = true, now = Date.now(), minAgeMs = AUTOMATIC_PROBE_TTL_MS } = {},
) {
  if (force) return true;
  const previous = Date.parse(asset?.probedAt ?? "");
  if (!Number.isFinite(previous) || previous > now) return true;
  return now - previous >= minAgeMs;
}
