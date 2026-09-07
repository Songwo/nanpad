import type { AssetKind, Taggable } from "./types.ts";
import { t } from "./i18n.ts";

/** Tolerates records written before tags existed. */
export function tagsOf(asset: Partial<Taggable> | null | undefined): string[] {
  return Array.isArray(asset?.tags) ? asset.tags : [];
}

/** Split a composer field: Chinese and Latin commas, plus spaces around them. */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,，;；\n]/)) {
    const tag = part.trim();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

export interface TagCount {
  tag: string;
  count: number;
}

/**
 * Every tag in a list with how many items carry it.
 *
 * Sorted by count first so the groups that actually organise the estate rise to
 * the front, then alphabetically so the tail stays stable as counts change.
 */
export function tagCounts(items: Array<Partial<Taggable>>): TagCount[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of tagsOf(item)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));
}

/** AND, not OR: selecting two tags asks for the intersection. */
export function matchesTags(asset: Partial<Taggable>, selected: string[]): boolean {
  if (selected.length === 0) return true;
  const own = tagsOf(asset);
  return selected.every((t) => own.includes(t));
}

export const UNTAGGED = "__untagged__";
export const UNTAGGED_LABEL = "未分组";

export interface TagGroup<T> {
  tag: string;
  label: string;
  items: T[];
}

/**
 * Bucket a list by tag for the grouped layout.
 *
 * An item with three tags appears in three sections — tags are labels, not
 * folders, and hiding a host from two of its groups would defeat the point.
 * Anything untagged collects in one trailing section.
 */
export function groupByTag<T extends Partial<Taggable>>(items: T[]): TagGroup<T>[] {
  const buckets = new Map<string, T[]>();
  const loose: T[] = [];

  for (const item of items) {
    const own = tagsOf(item);
    if (own.length === 0) {
      loose.push(item);
      continue;
    }
    for (const tag of own) {
      const bucket = buckets.get(tag);
      if (bucket) bucket.push(item);
      else buckets.set(tag, [item]);
    }
  }

  const groups: TagGroup<T>[] = [...buckets.entries()]
    .map(([tag, list]) => ({ tag, label: tag, items: list }))
    .sort((a, b) => b.items.length - a.items.length || a.tag.localeCompare(b.tag, "zh-CN"));

  if (loose.length) {
    groups.push({ tag: UNTAGGED, label: t(UNTAGGED_LABEL), items: loose });
  }
  return groups;
}

export interface TagIndexEntry {
  tag: string;
  total: number;
  byKind: Array<{ kind: AssetKind; count: number }>;
}

/**
 * Every tag across every collection, with a per-kind breakdown.
 *
 * This is what makes tags worth having: `生产` is not a server label or a
 * domain label, it is the thing that ties one project's host, domain and
 * certificate together, and only a cross-kind index can show that.
 */
export function tagIndex(snapshot: {
  servers: Array<Partial<Taggable>>;
  domains: Array<Partial<Taggable>>;
  mailboxes: Array<Partial<Taggable>>;
  aiAssets: Array<Partial<Taggable>>;
  secrets: Array<Partial<Taggable>>;
  certs: Array<Partial<Taggable>>;
}): TagIndexEntry[] {
  const collections: Array<[AssetKind, Array<Partial<Taggable>>]> = [
    ["server", snapshot.servers],
    ["domain", snapshot.domains],
    ["mail", snapshot.mailboxes],
    ["ai", snapshot.aiAssets],
    ["secret", snapshot.secrets],
    ["cert", snapshot.certs],
  ];

  const index = new Map<string, Map<AssetKind, number>>();
  for (const [kind, items] of collections) {
    for (const item of items) {
      for (const tag of tagsOf(item)) {
        let perKind = index.get(tag);
        if (!perKind) index.set(tag, (perKind = new Map()));
        perKind.set(kind, (perKind.get(kind) ?? 0) + 1);
      }
    }
  }

  return [...index.entries()]
    .map(([tag, perKind]) => {
      const byKind = [...perKind.entries()].map(([kind, count]) => ({ kind, count }));
      return { tag, total: byKind.reduce((a, x) => a + x.count, 0), byKind };
    })
    .sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag, "zh-CN"));
}
