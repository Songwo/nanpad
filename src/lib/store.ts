import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { desktop, isDesktop } from "./desktop";
import { EMPTY_SNAPSHOT, SEED_ACTIVITY, SEED_SNAPSHOT } from "./seed";
import type {
  ActivityItem,
  AiAsset,
  AssetKind,
  Certificate,
  Domain,
  Mailbox,
  Secret,
  Server,
  Snapshot,
  ViewId,
} from "./types";
import { uid } from "./utils";

export interface ExpandState {
  kind: AssetKind;
  id: string;
  origin: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export interface AppState extends Snapshot {
  view: ViewId;
  filter: "all" | "attention";
  query: string;
  /** Tags the current list is narrowed to. Every selected tag must match. */
  tagFilter: string[];
  /** Break the list into one section per tag instead of one flat grid. */
  groupByTag: boolean;
  activity: ActivityItem[];
  expanded: ExpandState | null;
  sshServerId: string | null;
  commandOpen: boolean;
  composerOpen: boolean;
  composerKind: AssetKind;
  editingId: string | null;
  mobileNav: boolean;
  hydrated: boolean;

  setView: (v: ViewId) => void;
  setFilter: (f: "all" | "attention") => void;
  setQuery: (q: string) => void;
  toggleTag: (tag: string) => void;
  /** Jump to the cross-kind view for one tag. */
  focusTag: (tag: string) => void;
  clearTags: () => void;
  setGroupByTag: (v: boolean) => void;
  setExpanded: (e: ExpandState | null) => void;
  openSsh: (serverId: string) => void;
  closeSsh: () => void;
  setCommandOpen: (v: boolean) => void;
  openComposer: (kind: AssetKind, editingId?: string | null) => void;
  closeComposer: () => void;
  setMobileNav: (v: boolean) => void;
  setHydrated: (v: boolean) => void;

  upsertServer: (s: Server) => void;
  upsertDomain: (s: Domain) => void;
  upsertMail: (s: Mailbox) => void;
  upsertAi: (s: AiAsset) => void;
  upsertSecret: (s: Secret) => void;
  upsertCert: (s: Certificate) => void;
  remove: (kind: AssetKind, id: string) => void;
  patchServerMetrics: (id: string, patch: Partial<Pick<Server, "cpu" | "memory" | "status" | "lastSeen">>) => void;
  log: (text: string, kind?: ActivityItem["kind"]) => void;
  resetDemo: () => void;
  importSnapshot: (snap: Snapshot) => void;
}

/** Sample data is a web-preview thing; the desktop app starts with your assets only. */
const initialSnapshot = () => (isDesktop() ? EMPTY_SNAPSHOT : SEED_SNAPSHOT);
const initialActivity = () => (isDesktop() ? [] : SEED_ACTIVITY);

const emptyUi = {
  view: "overview" as ViewId,
  filter: "all" as const,
  query: "",
  tagFilter: [] as string[],
  groupByTag: false,
  expanded: null,
  sshServerId: null,
  commandOpen: false,
  composerOpen: false,
  composerKind: "server" as AssetKind,
  editingId: null,
  mobileNav: false,
};

/**
 * On the desktop the assets live in a real file under the user's app-data
 * directory, not in a browser origin that an update or a cache clear can wipe.
 * The shape is the same either way, so the store does not care which it got.
 */
const diskStorage: StateStorage = {
  getItem: async () => {
    const file = await desktop()?.store.load();
    return file ? JSON.stringify(file) : null;
  },
  setItem: async (_name, value) => {
    await desktop()?.store.save(JSON.parse(value));
  },
  removeItem: async () => {
    await desktop()?.store.save({} as never);
  },
};

/** SSR has neither a bridge nor a browser; hydration happens after mount. */
const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

// `createJSONStorage` calls this immediately, so it must be declared above the
// store — and must not touch `window` on the server render.
function pickStorage(): StateStorage {
  if (typeof window === "undefined") return noopStorage;
  return isDesktop() ? diskStorage : window.localStorage;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialSnapshot(),
      ...emptyUi,
      activity: initialActivity(),
      hydrated: false,

      // A tag selection belongs to the list you picked it in.
      setView: (view) => set({ view, mobileNav: false, query: "", tagFilter: [] }),
      setFilter: (filter) => set({ filter }),
      setQuery: (query) => set({ query }),
      toggleTag: (tag) =>
        set({
          tagFilter: get().tagFilter.includes(tag)
            ? get().tagFilter.filter((t) => t !== tag)
            : [...get().tagFilter, tag],
        }),
      clearTags: () => set({ tagFilter: [] }),
      // Sets both at once: `setView` clears the selection on its own, which is
      // right everywhere except here, where the tag *is* the destination.
      focusTag: (tag) =>
        set({ view: "tags", tagFilter: [tag], query: "", mobileNav: false, expanded: null }),
      setGroupByTag: (groupByTag) => set({ groupByTag }),
      setExpanded: (expanded) => set({ expanded }),
      openSsh: (sshServerId) => set({ sshServerId, expanded: null }),
      closeSsh: () => set({ sshServerId: null }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      openComposer: (composerKind, editingId = null) =>
        set({ composerOpen: true, composerKind, editingId, expanded: null }),
      closeComposer: () => set({ composerOpen: false, editingId: null }),
      setMobileNav: (mobileNav) => set({ mobileNav }),
      setHydrated: (hydrated) => set({ hydrated }),

      upsertServer: (s) =>
        set({
          servers: upsert(get().servers, s),
        }),
      upsertDomain: (s) => set({ domains: upsert(get().domains, s) }),
      upsertMail: (s) => set({ mailboxes: upsert(get().mailboxes, s) }),
      upsertAi: (s) => set({ aiAssets: upsert(get().aiAssets, s) }),
      upsertSecret: (s) => set({ secrets: upsert(get().secrets, s) }),
      upsertCert: (s) => set({ certs: upsert(get().certs, s) }),

      remove: (kind, id) => {
        const key = collectionKey(kind);
        set({
          [key]: (get()[key] as { id: string }[]).filter((x) => x.id !== id),
          expanded: null,
        } as Partial<AppState>);
        get().log(`已移除 ${id}`, kind);
      },

      patchServerMetrics: (id, patch) =>
        set({
          servers: get().servers.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        }),

      log: (text, kind = "system") =>
        set({
          activity: [
            {
              id: uid("act"),
              at: new Date().toISOString(),
              text,
              kind,
            },
            ...get().activity,
          ].slice(0, 40),
        }),

      resetDemo: () =>
        set({
          ...initialSnapshot(),
          activity: initialActivity(),
          ...emptyUi,
        }),

      importSnapshot: (snap) =>
        set({
          servers: snap.servers ?? [],
          domains: snap.domains ?? [],
          mailboxes: snap.mailboxes ?? [],
          aiAssets: snap.aiAssets ?? [],
          secrets: snap.secrets ?? [],
          certs: snap.certs ?? [],
        }),
    }),
    {
      name: "sinan-assets-v1",
      skipHydration: true,
      storage: createJSONStorage(pickStorage),
      // Records written before tags existed have no `tags` array, and every
      // reader treats it as required. Normalise once, on the way in.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...saved,
          servers: withTags(saved.servers),
          domains: withTags(saved.domains),
          mailboxes: withTags(saved.mailboxes),
          aiAssets: withTags(saved.aiAssets),
          secrets: withTags(saved.secrets),
          certs: withTags(saved.certs),
        };
      },
      partialize: (s) => ({
        servers: s.servers,
        domains: s.domains,
        mailboxes: s.mailboxes,
        aiAssets: s.aiAssets,
        secrets: s.secrets,
        certs: s.certs,
        activity: s.activity,
      }),
    },
  ),
);

function withTags<T extends { tags?: string[] }>(list: T[] | undefined): T[] {
  return (list ?? []).map((x) => (Array.isArray(x.tags) ? x : { ...x, tags: [] }));
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [item, ...list];
  const next = list.slice();
  next[i] = item;
  return next;
}

function collectionKey(
  kind: AssetKind,
): keyof Snapshot {
  switch (kind) {
    case "server":
      return "servers";
    case "domain":
      return "domains";
    case "mail":
      return "mailboxes";
    case "ai":
      return "aiAssets";
    case "secret":
      return "secrets";
    case "cert":
      return "certs";
  }
}

export function snapshotOf(s: Snapshot): Snapshot {
  return {
    servers: s.servers,
    domains: s.domains,
    mailboxes: s.mailboxes,
    aiAssets: s.aiAssets,
    secrets: s.secrets,
    certs: s.certs,
  };
}
