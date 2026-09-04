import type { Taggable } from "./types";

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
    groups.push({ tag: UNTAGGED, label: UNTAGGED_LABEL, items: loose });
  }
  return groups;
}
