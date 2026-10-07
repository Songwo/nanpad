export const ACTIVITY_RETENTION_DAYS = 90;
export const ACTIVITY_LIMIT = 3000;
export const ACTIVITY_PAGE_SIZE = 20;

/** @typedef {{id: string, at: string, text: string, kind: string}} ActivityRecord */

/** 按本机日历日期分组，避免 UTC 午夜切错日期。 @param {Date | string} value */
export function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** @param {Date} now @param {number} offset */
function dayOffset(now, offset) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

/**
 * 保留今天及此前 89 个本地日期的真实记录，不改写旧日志内容。
 * @template {ActivityRecord} T
 * @param {T[]} records
 * @param {Date} [now]
 * @returns {T[]}
 */
export function retainActivity(records, now = new Date()) {
  const oldest = dayOffset(now, 1 - ACTIVITY_RETENTION_DAYS).getTime();
  const latest = now.getTime();
  const seen = new Set();
  const retained = (Array.isArray(records) ? records : [])
    .filter((entry) => {
      if (
        !entry ||
        typeof entry.id !== "string" ||
        typeof entry.text !== "string" ||
        typeof entry.kind !== "string"
      )
        return false;
      const at = typeof entry.at === "string" ? Date.parse(entry.at) : NaN;
      return Number.isFinite(at) && at >= oldest && at <= latest;
    })
    .sort((first, second) => Date.parse(second.at) - Date.parse(first.at))
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .slice(0, ACTIVITY_LIMIT);
  // 保留引用，避免纯界面切换触发整份资产快照重新写盘。
  return Array.isArray(records) &&
    retained.length === records.length &&
    retained.every((entry, index) => entry === records[index])
    ? records
    : retained;
}

/** @param {ActivityRecord[]} records @param {Date} [now] @param {string} [kind] */
export function activityDays(records, now = new Date(), kind = "all") {
  const days = Array.from({ length: 14 }, (_, index) => ({
    date: localDateKey(dayOffset(now, index - 13)),
    count: 0,
  }));
  const counts = new Map(days.map((day) => [day.date, day]));
  for (const entry of records) {
    if (kind !== "all" && entry.kind !== kind) continue;
    const bucket = counts.get(localDateKey(entry.at));
    if (bucket) bucket.count += 1;
  }
  return days;
}

/**
 * @template {ActivityRecord} T
 * @param {T[]} records
 * @param {{date?: string, kind?: string, page?: number}} [filters]
 */
export function activityPage(records, { date = "", kind = "all", page = 1 } = {}) {
  const matches = records.filter(
    (entry) =>
      (!date || localDateKey(entry.at) === date) && (kind === "all" || entry.kind === kind),
  );
  const totalPages = Math.max(1, Math.ceil(matches.length / ACTIVITY_PAGE_SIZE));
  const currentPage = Math.max(
    1,
    Math.min(totalPages, Number.isFinite(page) ? Math.trunc(page) : 1),
  );
  return {
    items: matches.slice((currentPage - 1) * ACTIVITY_PAGE_SIZE, currentPage * ACTIVITY_PAGE_SIZE),
    page: currentPage,
    totalPages,
    total: matches.length,
  };
}
