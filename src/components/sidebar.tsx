import {
  Bot,
  Globe,
  House,
  KeyRound,
  Mail,
  Server,
  Shield,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { useShallow } from "zustand/react/shallow";
import { LogoWord } from "./logo";
import { Button } from "./ui/button";
import { isDesktop } from "@/lib/desktop";
import { usePresence } from "@/lib/motion";
import { useAppStore } from "@/lib/store";
import { attentionOf } from "@/lib/status";
import type { AssetKind, ViewId } from "@/lib/types";
import { cn, downloadJson } from "@/lib/utils";
import { useVault } from "@/lib/vault-state";

export const NAV: {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  badge?: keyof ReturnType<typeof attentionOf>;
  kind?: AssetKind;
}[] = [
  { id: "overview", label: "总览", icon: House },
  { id: "servers", label: "服务器", icon: Server, badge: "servers", kind: "server" },
  { id: "domains", label: "域名", icon: Globe, badge: "domains", kind: "domain" },
  { id: "mail", label: "邮箱", icon: Mail, badge: "mail", kind: "mail" },
  { id: "ai", label: "AI 订阅", icon: Bot, badge: "ai", kind: "ai" },
  { id: "vault", label: "密钥", icon: KeyRound, badge: "vault", kind: "secret" },
  { id: "certs", label: "证书", icon: Shield, badge: "certs", kind: "cert" },
  { id: "terminal", label: "终端", icon: SquareTerminal },
];

export function Sidebar({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const openComposer = useAppStore((s) => s.openComposer);
  const counts = useAppStore(useShallow(attentionOf));
  const kind = NAV.find((n) => n.id === view)?.kind ?? "server";

  return (
    <aside
      className={cn(
        "flex h-full w-sidebar shrink-0 flex-col border-r border-line bg-sidebar px-3 py-3",
        className,
      )}
      {...rest}
    >
      {/* Doubles as the window drag strip in the desktop build. */}
      <div className="drag-strip px-3 pb-4 pt-2">
        <LogoWord />
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          const n = item.badge ? counts[item.badge] : 0;
          return (
            <button
              key={item.id}
              type="button"
              className="nav-item"
              data-active={active}
              onClick={() => setView(item.id)}
            >
              <Icon className="size-6 shrink-0" strokeWidth={active ? 2.4 : 1.8} />
              <span className="flex-1 text-left">{item.label}</span>
              {n > 0 ? (
                <span className="grid size-5 place-items-center rounded-full bg-crit text-2xs font-semibold tabular-nums text-card">
                  {n}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto space-y-3 px-1 pb-2 pt-4">
        <Button
          size="lg"
          className="w-full text-base font-semibold"
          onClick={() => openComposer(kind)}
        >
          添加资产
        </Button>
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
          "block w-full px-3 py-2 text-left text-meta transition-colors duration-150 ease-out hover:bg-line",
          tone === "danger" && "text-crit",
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
      className="relative flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors duration-150 ease-out hover:bg-line"
    >
      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-meta font-semibold text-card">
        林
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-semibold leading-tight">林深</div>
        <div className="truncate text-2xs text-muted">@sinan.local</div>
      </div>
      <button
        type="button"
        aria-label="更多操作"
        aria-expanded={open}
        className="flex size-8 items-center justify-center rounded-full text-muted transition-colors duration-150 ease-out hover:bg-card hover:text-ink"
        onClick={() => setOpen((v) => !v)}
      >
        ···
      </button>
      {mounted && (
        <div
          className="anim-panel absolute bottom-14 right-0 z-30 w-44 overflow-hidden rounded-lg bg-card py-1 shadow-float"
          data-shown={shown}
        >
          {item("导出 JSON", () => {
            const s = useAppStore.getState();
            downloadJson("sinan-assets.json", {
              servers: s.servers,
              domains: s.domains,
              mailboxes: s.mailboxes,
              aiAssets: s.aiAssets,
              secrets: s.secrets,
              certs: s.certs,
            });
            log("已导出资产快照");
          })}
          {item("导入 JSON", () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json";
            input.onchange = async () => {
              const file = input.files?.[0];
              if (!file) return;
              importSnapshot(JSON.parse(await file.text()));
              log("已导入资产快照");
            };
            input.click();
          })}
          {vaultUnlocked && item("锁定密钥库", () => void lockVault())}
          {item(isDesktop() ? "清空全部数据" : "重置演示数据", () => resetDemo(), "danger")}
        </div>
      )}
    </div>
  );
}
