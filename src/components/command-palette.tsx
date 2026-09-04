import { Command } from "cmdk";
import {
  Bot,
  Globe,
  KeyRound,
  Mail,
  Plus,
  Server as ServerIcon,
  Shield,
  SquareTerminal,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, type ReactNode } from "react";
import { NAV } from "./sidebar";
import { usePresence } from "@/lib/motion";
import { useAppStore } from "@/lib/store";
import { KIND_LABEL } from "@/lib/status";
import { tagIndex, tagsOf } from "@/lib/tags";
import type { AssetKind } from "@/lib/types";

const KIND_ICON: Record<AssetKind, LucideIcon> = {
  server: ServerIcon,
  domain: Globe,
  mail: Mail,
  ai: Bot,
  secret: KeyRound,
  cert: Shield,
};

interface Entry {
  id: string;
  /** What cmdk filters against — never rendered. */
  search: string;
  icon: LucideIcon;
  label: string;
  meta?: string;
  hint?: string;
  run: () => void;
}

interface Section {
  heading: string;
  entries: Entry[];
}

export function CommandPalette() {
  const open = useAppStore((s) => s.commandOpen);
  const setOpen = useAppStore((s) => s.setCommandOpen);
  const { mounted, shown } = usePresence(open, 160);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useAppStore.getState().commandOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  if (!mounted) return null;
  return <Palette shown={shown} onClose={() => setOpen(false)} />;
}

function Palette({ shown, onClose }: { shown: boolean; onClose: () => void }) {
  const setView = useAppStore((s) => s.setView);
  const focusTag = useAppStore((s) => s.focusTag);
  const openSsh = useAppStore((s) => s.openSsh);
  const openComposer = useAppStore((s) => s.openComposer);
  const setExpanded = useAppStore((s) => s.setExpanded);
  const servers = useAppStore((s) => s.servers);
  const domains = useAppStore((s) => s.domains);
  const mailboxes = useAppStore((s) => s.mailboxes);
  const aiAssets = useAppStore((s) => s.aiAssets);
  const secrets = useAppStore((s) => s.secrets);
  const certs = useAppStore((s) => s.certs);

  /**
   * Sections are built from data and empty ones are dropped — a heading with
   * nothing under it (which is what an empty estate used to show) reads as a
   * broken list rather than an empty one.
   */
  const sections = useMemo<Section[]>(() => {
    /** Open an asset's detail sheet from the middle of the screen. */
    const reveal = (kind: AssetKind, id: string, view: Parameters<typeof setView>[0]) => () => {
      setView(view);
      const w = Math.min(560, window.innerWidth - 48);
      setExpanded({
        kind,
        id,
        origin: {
          x: (window.innerWidth - w) / 2,
          y: window.innerHeight * 0.32,
          w,
          h: 180,
        },
      });
      onClose();
    };

    const asset = (
      kind: AssetKind,
      id: string,
      label: string,
      meta: string,
      tags: string[],
      view: Parameters<typeof setView>[0],
    ): Entry => ({
      id: `${kind}:${id}`,
      search: `${label} ${meta} ${tags.join(" ")} ${KIND_LABEL[kind]}`,
      icon: KIND_ICON[kind],
      label,
      meta,
      run: reveal(kind, id, view),
    });

    const out: Section[] = [];

    const pages: Entry[] = NAV.map((n) => ({
      id: `page:${n.id}`,
      search: `${n.label} 页面`,
      icon: n.icon,
      label: n.label,
      run: () => {
        setView(n.id);
        onClose();
      },
    }));
    out.push({ heading: "页面", entries: pages });

    const sshEntries: Entry[] = servers.map((s) => ({
      id: `ssh:${s.id}`,
      search: `ssh ${s.name} ${s.host} ${s.username} ${tagsOf(s).join(" ")}`,
      icon: SquareTerminal,
      label: `连接 ${s.name}`,
      meta: `${s.username}@${s.host}`,
      hint: s.status === "offline" ? "离线" : undefined,
      run: () => {
        if (s.status !== "offline") openSsh(s.id);
        else setView("servers");
        onClose();
      },
    }));
    if (sshEntries.length) out.push({ heading: "SSH 会话", entries: sshEntries });

    const assets: Entry[] = [
      ...servers.map((s) => asset("server", s.id, s.name, s.host, tagsOf(s), "servers")),
      ...domains.map((s) => asset("domain", s.id, s.name, s.registrar, tagsOf(s), "domains")),
      ...mailboxes.map((s) => asset("mail", s.id, s.address, s.domain, tagsOf(s), "mail")),
      ...aiAssets.map((s) => asset("ai", s.id, s.name, s.provider, tagsOf(s), "ai")),
      ...secrets.map((s) => asset("secret", s.id, s.name, s.hint, tagsOf(s), "vault")),
      ...certs.map((s) => asset("cert", s.id, s.cn, s.issuer, tagsOf(s), "certs")),
    ];
    if (assets.length) out.push({ heading: "资产", entries: assets });

    const tags = tagIndex({ servers, domains, mailboxes, aiAssets, secrets, certs });
    if (tags.length) {
      out.push({
        heading: "分组",
        entries: tags.map((t) => ({
          id: `tag:${t.tag}`,
          search: `标签 分组 ${t.tag}`,
          icon: Tag,
          label: t.tag,
          meta: `${t.total} 项资产`,
          run: () => {
            focusTag(t.tag);
            onClose();
          },
        })),
      });
    }

    out.push({
      heading: "新建",
      entries: (Object.keys(KIND_LABEL) as AssetKind[]).map((kind) => ({
        id: `new:${kind}`,
        search: `新建 添加 ${KIND_LABEL[kind]}`,
        icon: Plus,
        label: `添加${KIND_LABEL[kind]}`,
        run: () => {
          openComposer(kind);
          onClose();
        },
      })),
    });

    return out;
  }, [
    servers,
    domains,
    mailboxes,
    aiAssets,
    secrets,
    certs,
    setView,
    setExpanded,
    openSsh,
    openComposer,
    focusTag,
    onClose,
  ]);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="anim-scrim absolute inset-0 bg-ink/30"
        data-shown={shown}
        aria-label="关闭搜索"
        onClick={onClose}
      />
      <Command
        className="anim-panel relative mx-auto mt-[12vh] flex max-h-[70vh] w-[min(600px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl bg-card shadow-float"
        data-shown={shown}
        loop
      >
        <Command.Input
          autoFocus
          placeholder="搜索资产、标签、页面，或直接连 SSH…"
          className="h-13 w-full shrink-0 border-b border-line bg-transparent px-4 text-body outline-none placeholder:text-subtle"
        />
        <Command.List className="min-h-0 flex-1 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-10 text-center text-meta text-muted">
            没有匹配项
          </Command.Empty>
          {sections.map((section) => (
            <Command.Group key={section.heading} heading={section.heading} className="cmd-group">
              {section.entries.map((entry) => (
                <Item key={entry.id} value={entry.search} onSelect={entry.run}>
                  <entry.icon className="size-4 shrink-0 text-subtle" strokeWidth={1.9} />
                  <span className="truncate">{entry.label}</span>
                  {entry.meta && (
                    <span className="truncate font-mono text-2xs text-subtle">{entry.meta}</span>
                  )}
                  {entry.hint && <span className="ml-auto chip chip-mute">{entry.hint}</span>}
                </Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
        <footer className="flex shrink-0 items-center gap-4 border-t border-line px-4 py-2 text-2xs text-subtle">
          <span>
            <Key>↑</Key>
            <Key>↓</Key> 选择
          </span>
          <span>
            <Key>↵</Key> 打开
          </span>
          <span>
            <Key>esc</Key> 关闭
          </span>
        </footer>
      </Command>
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="mr-1 inline-grid h-4 min-w-4 place-items-center rounded-xs bg-line px-1 font-mono text-2xs text-muted">
      {children}
    </kbd>
  );
}

function Item({
  value,
  children,
  onSelect,
}: {
  value: string;
  children: ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-10 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-meta transition-colors duration-150 ease-out data-[selected=true]:bg-line"
    >
      {children}
    </Command.Item>
  );
}
