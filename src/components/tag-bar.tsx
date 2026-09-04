import { LayoutGrid, Rows3, X } from "lucide-react";
import type { ReactNode } from "react";
import { useAppStore } from "@/lib/store";
import { tagCounts } from "@/lib/tags";
import type { Taggable } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The collection the current view lists, before any filtering.
 *
 * Chips are counted against this rather than the filtered result, so the strip
 * does not collapse out from under the pointer while you narrow things down.
 */
function useViewCollection(): Array<Partial<Taggable>> {
  const view = useAppStore((s) => s.view);
  const servers = useAppStore((s) => s.servers);
  const domains = useAppStore((s) => s.domains);
  const mailboxes = useAppStore((s) => s.mailboxes);
  const aiAssets = useAppStore((s) => s.aiAssets);
  const secrets = useAppStore((s) => s.secrets);
  const certs = useAppStore((s) => s.certs);

  switch (view) {
    case "servers":
    case "terminal":
      return servers;
    case "domains":
      return domains;
    case "mail":
      return mailboxes;
    case "ai":
      return aiAssets;
    case "vault":
      return secrets;
    case "certs":
      return certs;
    // The overview is a dashboard and the tags view sources its own list;
    // neither has a single collection for the strip to count.
    case "overview":
    case "tags":
      return [];
  }
}

/**
 * The grouping strip under the search field.
 *
 * It lists the tags actually present in the *unfiltered* list for this view, so
 * the set of chips does not collapse out from under the pointer as you narrow
 * things down. Selecting more than one tag intersects them.
 */
export function TagBar() {
  const items = useViewCollection();
  const selected = useAppStore((s) => s.tagFilter);
  const toggleTag = useAppStore((s) => s.toggleTag);
  const clearTags = useAppStore((s) => s.clearTags);
  const grouped = useAppStore((s) => s.groupByTag);
  const setGroupByTag = useAppStore((s) => s.setGroupByTag);

  const counts = tagCounts(items);
  if (counts.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-4 pb-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {counts.map(({ tag, count }) => {
          const on = selected.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              className={cn("tag-chip", on && "tag-chip-on")}
              aria-pressed={on}
              onClick={() => toggleTag(tag)}
            >
              {tag}
              <span className="tabular-nums opacity-55">{count}</span>
            </button>
          );
        })}
        {selected.length > 0 && (
          <button type="button" className="tag-chip tag-chip-clear" onClick={clearTags}>
            <X className="size-3" />
            清除
          </button>
        )}
      </div>

      <button
        type="button"
        className="tag-toggle shrink-0"
        aria-pressed={grouped}
        data-on={grouped}
        title={grouped ? "改为平铺" : "按标签分组"}
        onClick={() => setGroupByTag(!grouped)}
      >
        {grouped ? <Rows3 className="size-3.5" /> : <LayoutGrid className="size-3.5" />}
        {grouped ? "分组" : "平铺"}
      </button>
    </div>
  );
}

/** A tag chip on a card. Clicking it narrows the list to that tag. */
export function CardTag({ tag }: { tag: string }) {
  const selected = useAppStore((s) => s.tagFilter);
  const toggleTag = useAppStore((s) => s.toggleTag);
  return (
    <button
      type="button"
      className={cn("chip chip-mute tag-inline", selected.includes(tag) && "tag-inline-on")}
      onClick={(e) => {
        // The card itself opens the detail sheet; the tag only filters.
        e.stopPropagation();
        toggleTag(tag);
      }}
    >
      {tag}
    </button>
  );
}

/** Section heading for the grouped layout. */
export function GroupHeading({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children?: ReactNode;
}) {
  return (
    <div className="col-span-full flex items-center gap-2 px-1 pt-1">
      <h3 className="text-meta font-semibold tracking-tight">{label}</h3>
      <span className="text-2xs tabular-nums text-subtle">{count}</span>
      <span className="ml-2 h-px flex-1 bg-line" />
      {children}
    </div>
  );
}
