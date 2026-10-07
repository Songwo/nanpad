import { phoneExpiry } from "../../electron/services/phone-numbers.mjs";

/** @typedef {"all" | "attention" | "expired" | "active" | "unknown"} PhoneFilter */
/**
 * @template {{number: string, label: string, provider: string, notes: string, expiresAt: string}} T
 * @param {T[]} records
 * @param {string} query
 * @param {PhoneFilter} filter
 * @param {Date} [now]
 * @returns {T[]}
 */
export function visiblePhoneNumbers(records, query, filter, now = new Date()) {
  const needle = query.trim().toLocaleLowerCase();
  const numberNeedle = needle.replace(/[\s()+.-]/g, "");
  return records
    .map((record) => ({ record, status: phoneExpiry(record.expiresAt, now).status }))
    .filter(({ record, status }) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "attention"
          ? ["expired", "today", "soon"].includes(status)
          : status === filter);
      if (!matchesFilter) return false;
      if (!needle) return true;
      const text = [record.number, record.label, record.provider, record.notes]
        .join(" ")
        .toLocaleLowerCase();
      const matchesQuery =
        !needle ||
        text.includes(needle) ||
        (numberNeedle && record.number.replace(/[\s()+.-]/g, "").includes(numberNeedle));
      return matchesFilter && Boolean(matchesQuery);
    })
    .sort((a, b) => {
      const first = a.status === "unknown" ? "9999-99-99" : a.record.expiresAt;
      const second = b.status === "unknown" ? "9999-99-99" : b.record.expiresAt;
      return (
        first.localeCompare(second) ||
        a.record.label.localeCompare(b.record.label) ||
        a.record.number.localeCompare(b.record.number)
      );
    })
    .map(({ record }) => record);
}

/** @template T @param {T[]} records @param {number} requestedPage */
export function phonePage(records, requestedPage) {
  const totalPages = Math.max(1, Math.ceil(records.length / 50));
  const page = Math.max(
    1,
    Math.min(totalPages, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1),
  );
  return {
    items: records.slice((page - 1) * 50, page * 50),
    page,
    totalPages,
    total: records.length,
  };
}
