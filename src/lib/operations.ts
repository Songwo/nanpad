import type { AssetKind, Snapshot } from "./types.ts";
import { t } from "./i18n.ts";

export interface AssetRef {
  kind: AssetKind;
  id: string;
}
export interface AssetLink {
  from: AssetRef;
  to: AssetRef;
}
export interface AssetEntry extends AssetRef {
  label: string;
}

export function assetEntries(s: Snapshot): AssetEntry[] {
  return [
    ...s.servers.map((x) => ({ kind: "server" as const, id: x.id, label: x.name })),
    ...s.domains.map((x) => ({ kind: "domain" as const, id: x.id, label: x.name })),
    ...s.mailboxes.map((x) => ({ kind: "mail" as const, id: x.id, label: x.address })),
    ...s.aiAssets.map((x) => ({ kind: "ai" as const, id: x.id, label: x.name })),
    ...s.secrets.map((x) => ({ kind: "secret" as const, id: x.id, label: x.name })),
    ...s.certs.map((x) => ({ kind: "cert" as const, id: x.id, label: x.cn })),
  ];
}

export function refKey(ref: AssetRef): string {
  return JSON.stringify([ref.kind, ref.id]);
}

export function normalizeLinks(value: unknown, snapshot: Snapshot): AssetLink[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(assetEntries(snapshot).map(refKey));
  const seen = new Set<string>();
  return value
    .filter((link): link is AssetLink => {
      if (!link || !link.from || !link.to) return false;
      const from = refKey(link.from),
        to = refKey(link.to);
      const key = [from, to].sort().join("\n");
      if (from === to || !known.has(from) || !known.has(to) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ from, to }) => ({
      from: { kind: from.kind, id: from.id },
      to: { kind: to.kind, id: to.id },
    }));
}

export interface CalendarItem {
  id: string;
  date: string;
  title: string;
  detail: string;
}

// 无到期日的告警放在导出当天；固定 UID 便于日历再次导入时识别同一事项。
export function calendarItems(s: Snapshot, now = new Date()): CalendarItem[] {
  const today = now.toISOString().slice(0, 10);
  const out: CalendarItem[] = [];
  const add = (kind: string, id: string, title: string, date: string, detail: string) => {
    if (!Number.isFinite(Date.parse(date))) return;
    out.push({ id: `${kind}:${id}`, date: date.slice(0, 10), title, detail });
  };
  for (const x of s.servers)
    if (x.status !== "online") add("server", x.id, x.name, today, t("主机异常"));
  for (const x of s.mailboxes)
    if (x.status !== "online") add("mail", x.id, x.address, today, t("投递异常"));
  for (const x of s.secrets)
    if (x.status !== "online") add("secret", x.id, x.name, today, t("建议轮换"));
  for (const [kind, entries] of [
    ["domain", s.domains],
    ["cert", s.certs],
    ["ai", s.aiAssets],
  ] as const) {
    for (const x of entries) {
      const date = "renewsAt" in x ? x.renewsAt : x.expiresAt;
      const due = Date.parse(date) <= now.getTime() + 21 * 86_400_000;
      if (x.status !== "online" || due)
        add(
          kind,
          x.id,
          "cn" in x ? x.cn : x.name,
          Number.isFinite(Date.parse(date)) ? date : today,
          t("需要留意"),
        );
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const escapeIcs = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let part = "",
    bytes = 0;
  for (const c of line) {
    const size = encoder.encode(c).length;
    if (bytes + size > 75) {
      lines.push(part);
      part = " ";
      bytes = 1;
    }
    part += c;
    bytes += size;
  }
  lines.push(part);
  return lines.join("\r\n");
}

export function createCalendar(items: CalendarItem[], now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nanpad//Asset reminders//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const item of items) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !Number.isFinite(Date.parse(item.date))) continue;
    const end = new Date(`${item.date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${encodeURIComponent(item.id)}@nanpad.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${item.date.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replace(/-/g, "")}`,
      `SUMMARY:${escapeIcs(item.title)}`,
      `DESCRIPTION:${escapeIcs(item.detail)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  return [...lines, "END:VCALENDAR"].map(foldLine).join("\r\n") + "\r\n";
}
