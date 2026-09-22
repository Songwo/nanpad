import {
  FileText,
  ChartNoAxesCombined,
  Bot,
  Globe,
  House,
  KeyRound,
  Mail,
  Server,
  MessagesSquare,
  Shield,
  SquareTerminal,
  Tags,
  Radio,
  Lock,
  Unlock,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import { useShallow } from "zustand/react/shallow";
import { isDesktop } from "@/lib/desktop";
import { usePresence } from "@/lib/motion";
import { useAppStore } from "@/lib/store";
import { attentionOf } from "@/lib/status";
import type { AssetKind, ViewId } from "@/lib/types";
import { cn, downloadJson } from "@/lib/utils";
import { useVault } from "@/lib/vault-state";
import { t } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { toast } from "sonner";
import { safeImageDataUrl } from "../../electron/services/image-data.mjs";

export interface NavGroup {
  title: string;
  items: {
    id: ViewId;
    label: string;
    icon: LucideIcon;
    badgeKey?: keyof ReturnType<typeof attentionOf>;
    kind?: AssetKind;
    countKey?: "servers" | "domains" | "mailboxes" | "aiAssets" | "secrets" | "certs" | "nodes";
  }[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "工作空间",
    items: [
      { id: "overview", label: "资产总览", icon: House, badgeKey: "total" },
      { id: "docs", label: "文档资产", icon: FileText },
      { id: "usage", label: "用量记录", icon: ChartNoAxesCombined },
      { id: "nodes", label: "自建节点", icon: Radio, countKey: "nodes" },
    ],
  },
  {
    title: "基础设施",
    items: [
      {
        id: "servers",
        label: "服务器",
        icon: Server,
        badgeKey: "servers",
        kind: "server",
        countKey: "servers",
      },
      {
        id: "domains",
        label: "域名",
        icon: Globe,
        badgeKey: "domains",
        kind: "domain",
        countKey: "domains",
      },
      {
        id: "certs",
        label: "安全证书",
        icon: Shield,
        badgeKey: "certs",
        kind: "cert",
        countKey: "certs",
      },
    ],
  },
  {
    title: "智能与通信",
    items: [
      { id: "ai", label: "AI 订阅", icon: Bot, badgeKey: "ai", kind: "ai", countKey: "aiAssets" },
      {
        id: "mail",
        label: "邮箱",
        icon: Mail,
        badgeKey: "mail",
        kind: "mail",
        countKey: "mailboxes",
      },
    ],
  },
  {
    title: "安全与整理",
    items: [
      {
        id: "vault",
        label: "密钥库",
        icon: KeyRound,
        badgeKey: "vault",
        kind: "secret",
        countKey: "secrets",
      },
      { id: "tags", label: "标签", icon: Tags },
    ],
  },
  {
    title: "工具",
    items: [
      { id: "agent", label: "AI 助手", icon: MessagesSquare },
      { id: "terminal", label: "终端", icon: SquareTerminal },
    ],
  },
];

// 扁平导出给快捷键或其他模块使用
export const NAV = NAV_GROUPS.flatMap((g) => g.items);

export function Sidebar({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const servers = useAppStore((s) => s.servers);
  const domains = useAppStore((s) => s.domains);
  const mailboxes = useAppStore((s) => s.mailboxes);
  const aiAssets = useAppStore((s) => s.aiAssets);
  const secrets = useAppStore((s) => s.secrets);
  const certs = useAppStore((s) => s.certs);
  const counts = useAppStore(useShallow(attentionOf));

  const totalNodesCount = useMemo(() => {
    return servers.reduce((acc, s) => acc + (s.nodes?.length || 0), 0);
  }, [servers]);

  const assetCounts = useMemo(
    () => ({
      servers: servers.length,
      domains: domains.length,
      mailboxes: mailboxes.length,
      aiAssets: aiAssets.length,
      secrets: secrets.length,
      certs: certs.length,
      nodes: totalNodesCount,
    }),
    [
      servers.length,
      domains.length,
      mailboxes.length,
      aiAssets.length,
      secrets.length,
      certs.length,
      totalNodesCount,
    ],
  );

  return (
    <aside
      className={cn(
        "flex h-full w-60 shrink-0 flex-col border-r border-line bg-sidebar select-none transition-colors duration-200",
        className,
      )}
      {...rest}
    >
      {/* 5 大分组分层导航栏 */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="space-y-0.5">
            <div className="px-3 py-1.5 text-xs font-medium text-muted">{t(group.title)}</div>
            {group.items.map((item) => {
              const active = view === item.id;
              const Icon = item.icon;
              const attentionCount = item.badgeKey ? counts[item.badgeKey] : 0;
              const totalCount = item.countKey ? assetCounts[item.countKey] : 0;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  data-active={active}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150",
                    active
                      ? "bg-line font-semibold text-ink"
                      : "text-muted hover:bg-surface hover:text-ink font-medium",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{t(item.label)}</span>
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {attentionCount > 0 && (
                      <span className="inline-flex items-center justify-center rounded bg-crit px-1 py-0.5 font-mono text-[10px] font-bold text-white leading-none">
                        {attentionCount}
                      </span>
                    )}
                    {item.id === "vault" ? (
                      <span className="rounded bg-ok/10 text-ok px-1 py-0.5 font-mono text-[10px] font-medium leading-none">
                        AES-GCM
                      </span>
                    ) : item.id === "nodes" && totalCount > 0 ? (
                      <span className="rounded bg-ok/10 text-ok px-1 py-0.5 font-mono text-[10px] font-medium leading-none">
                        {totalCount}
                      </span>
                    ) : totalCount > 0 ? (
                      <span className="font-mono text-[10.5px] text-muted/80">{totalCount}</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* 底部账户空间与安全沙箱卡片 */}
      <div className="mt-auto border-t border-line/60 p-2.5">
        <ProfileMenu />
      </div>
    </aside>
  );
}

function ProfileMenu() {
  const resetDemo = useAppStore((s) => s.resetDemo);
  const log = useAppStore((s) => s.log);
  const importSnapshot = useAppStore((s) => s.importSnapshot);
  const vaultUnlocked = useVault((s) => s.unlocked);
  const lockVault = useVault((s) => s.lock);
  const name = useProfile((s) => s.profile?.name) || "Nanpad Owner";
  const avatarDataUrl = useProfile((s) => s.profile?.avatarDataUrl);
  const avatar = useMemo(() => safeImageDataUrl(avatarDataUrl), [avatarDataUrl]);
  const [open, setOpen] = useState(false);
  const { mounted, shown } = usePresence(open, 150);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function item(label: string, onClick: () => void, tone?: "danger") {
    return (
      <button
        type="button"
        className={cn(
          "block w-full px-3 py-2 text-left text-xs transition-colors duration-150 ease-out hover:bg-line cursor-pointer",
          tone === "danger" ? "text-crit font-medium" : "text-ink",
        )}
        onClick={() => {
          setOpen(false);
          onClick();
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      ref={root}
      className="relative flex items-center gap-2.5 rounded-xl border border-line bg-card/60 p-2 transition-colors duration-150 hover:bg-card shadow-xs"
    >
      <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-ink text-xs font-semibold text-card">
        {avatar ? (
          <img src={avatar} alt={t("个人头像")} className="size-full object-cover" />
        ) : (
          Array.from(name)[0]
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold leading-tight text-ink">{name}</div>
        <div className="flex items-center gap-1 text-[10.5px] text-muted">
          {vaultUnlocked ? (
            <span className="flex items-center gap-1 text-ok font-medium">
              <Unlock className="size-2.5" />
              <span>{t("金库已挂载")}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-muted">
              <Lock className="size-2.5" />
              <span>{t("金库已锁定")}</span>
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        aria-label={t("更多操作")}
        aria-expanded={open}
        className="flex size-7 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-line hover:text-ink cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        ···
      </button>

      {mounted && (
        <div
          className="anim-panel absolute bottom-14 left-0 right-0 z-30 overflow-hidden rounded-xl border border-line bg-card py-1 shadow-float"
          data-shown={shown}
        >
          <div className="border-b border-line px-3 py-1.5 text-[11px] font-semibold text-muted">
            {t("安全沙箱与资产配置")}
          </div>
          {item(t("导出 JSON 快照"), () => {
            const s = useAppStore.getState();
            downloadJson("nanpad-assets.json", {
              links: s.links,
              servers: s.servers,
              domains: s.domains,
              mailboxes: s.mailboxes,
              aiAssets: s.aiAssets,
              secrets: s.secrets,
              certs: s.certs,
            });
            log(t("已导出资产快照"));
          })}
          {item(t("导入 JSON 快照"), () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json";
            input.onchange = async () => {
              const file = input.files?.[0];
              if (!file) return;
              try {
                importSnapshot(JSON.parse(await file.text()));
                log(t("已导入资产快照"));
              } catch (error) {
                toast.error(error instanceof Error ? error.message : String(error));
              }
            };
            input.click();
          })}
          {item(t("系统设置…"), () => useAppStore.getState().setSettingsOpen(true))}
          {vaultUnlocked && item(t("立即锁定密钥库"), () => void lockVault())}
          <div className="my-1 border-t border-line" />
          {item(isDesktop() ? t("清空全部数据") : t("重置演示数据"), () => resetDemo(), "danger")}
        </div>
      )}
    </div>
  );
}
