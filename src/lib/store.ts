import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SEED_ACTIVITY, SEED_SNAPSHOT } from "./seed";
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

const emptyUi = {
  view: "overview" as ViewId,
  filter: "all" as const,
  query: "",
  expanded: null,
  sshServerId: null,
  commandOpen: false,
  composerOpen: false,
  composerKind: "server" as AssetKind,
  editingId: null,
  mobileNav: false,
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...SEED_SNAPSHOT,
      ...emptyUi,
      activity: SEED_ACTIVITY,
      hydrated: false,

      setView: (view) => set({ view, mobileNav: false, query: "" }),
      setFilter: (filter) => set({ filter }),
      setQuery: (query) => set({ query }),
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
          ...SEED_SNAPSHOT,
          activity: SEED_ACTIVITY,
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
      name: "nexus-assets-v1",
      skipHydration: true,
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
