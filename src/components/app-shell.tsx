import { Bot, Globe, House, Menu, Server, SquareTerminal } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { Toaster, toast } from "sonner";
import { CommandPalette } from "./command-palette";
import { Composer } from "./composer";
import { ExpandLayer } from "./expand-layer";
import { LogoMark } from "./logo";
import { RightRail } from "./right-rail";
import { NAV, Sidebar } from "./sidebar";
import { Settings } from "./settings";
import { SshTerminal } from "./ssh-terminal";
import { Button } from "./ui/button";
import { TitleBar } from "./title-bar";
import { VaultGate } from "./vault-gate";
import { Onboarding } from "./onboarding";
import { MainView, TopTabs } from "./views";
import { desktop, isDesktop } from "@/lib/desktop";
import { useLive } from "@/lib/live";
import { usePresence } from "@/lib/motion";
import { refreshAll } from "@/lib/probes";
import { migrateSecretValues } from "@/lib/vault-migrate";
import { useAppStore } from "@/lib/store";
import type { ViewId } from "@/lib/types";
import { cn } from "@/lib/utils";
import { startThemeSync, startLocaleSync, useSettings } from "@/lib/settings";
import { useVault } from "@/lib/vault-state";
import { t, subscribeLocale, getLocale } from "@/lib/i18n";

export function AppShell() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => "zh" as const);
  useEffect(() => startLocaleSync(), []);
  useEffect(() => {
    const bridge = desktop();
    if (bridge) void bridge.preferences.set({ locale }).catch((err) => toast(String(err.message)));
  }, [locale]);
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    const off = bridge.onAttention((asset) =>
      useAppStore
        .getState()
        .setExpanded({ ...asset, origin: { x: window.innerWidth / 2, y: 50, w: 100, h: 50 } }),
    );
    const offVault = bridge.onVaultChanged(() => {
      void useVault.getState().refresh();
    });
    const offMetricError = bridge.metrics.onError((event) =>
      toast(t("指标记录失败：{0}", event.error)),
    );
    return () => {
      off();
      offVault();
      offMetricError();
    };
  }, []);
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const setHydrated = useAppStore((s) => s.setHydrated);
  const hydrated = useAppStore((s) => s.hydrated);
  const assetLayout = useSettings((s) => s.assetLayout);
  const wideWorkspace =
    hydrated && assetLayout !== "cards" && view !== "agent" && view !== "terminal";
  const setCommandOpen = useAppStore((s) => s.setCommandOpen);
  const openComposer = useAppStore((s) => s.openComposer);
  const vaultUnlocked = useVault((s) => s.unlocked);

  useEffect(() => {
    void Promise.resolve(useAppStore.persist.rehydrate()).then(() => setHydrated(true));
  }, [setHydrated]);

  // Web preview only: the numbers have nothing behind them, so they drift
  // instead of sitting frozen. The desktop build reads the real thing below.
  useEffect(() => {
    if (isDesktop()) return;
    const tick = () => {
      const servers = useAppStore.getState().servers;
      for (const s of servers) {
        if (s.status === "offline") continue;
        const prevC = useLive.getState().cpu[s.id] ?? s.cpu;
        const prevM = useLive.getState().memory[s.id] ?? s.memory;
        const cpu = clamp(prevC + (Math.random() - 0.48) * 5, 3, 98);
        const memory = clamp(prevM + (Math.random() - 0.5) * 2.4, 8, 96);
        useLive.getState().set(s.id, Math.round(cpu), Math.round(memory));
      }
    };
    tick();
    const t = window.setInterval(tick, 2400);
    return () => window.clearInterval(t);
  }, []);

  // Stamps `<html data-theme>` and keeps following the OS while the choice is
  // "跟随系统". Returns its own teardown.
  useEffect(() => startThemeSync(), []);

  useEffect(() => {
    void useVault.getState().refresh();
  }, []);

  // Anything still holding a plaintext secret body moves into the vault the
  // first time it is open.
  useEffect(() => {
    if (!isDesktop() || !vaultUnlocked) return;
    void migrateSecretValues();
  }, [vaultUnlocked]);

  // Real metric sweeps, but never before the vault is open: probing needs the
  // stored credentials, and a password prompt on launch would be rude.
  useEffect(() => {
    if (!isDesktop() || !vaultUnlocked) return;
    let cancelled = false;
    const sweep = () => {
      if (!cancelled) void refreshAll("server");
    };
    sweep();
    const t = window.setInterval(sweep, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [vaultUnlocked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        const kind = NAV.find((n) => n.id === useAppStore.getState().view)?.kind ?? "server";
        openComposer(kind);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        useAppStore.getState().setSettingsOpen(true);
      }
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openComposer, setCommandOpen]);

  return (
    <div data-app-ready={hydrated} className="flex h-dvh min-h-0 flex-col bg-canvas text-ink">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar className="hidden md:flex" />
        <MobileDrawer />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 items-center gap-3 border-b border-line bg-sidebar px-3 md:hidden">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => useAppStore.getState().setMobileNav(true)}
              aria-label={t("打开菜单")}
            >
              <Menu className="size-5" />
            </Button>
            <LogoMark className="size-7" />
            <span className="font-bold tracking-wordmark">{t("司南")}</span>
          </header>

          {/* One scroll container for the two columns, so both sticky headers
            resolve against the same viewport. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-7xl items-start">
              <main className="@container min-w-0 flex-1 xl:border-r xl:border-line">
                <TopTabs />
                <MainView />
              </main>
              {!wideWorkspace && <RightRail className="hidden xl:block" />}
            </div>
          </div>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-around border-t border-line bg-sidebar/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={cn(
                "relative flex h-12 min-w-12 flex-col items-center justify-center gap-0.5 text-2xs transition-colors duration-150 ease-out",
                active ? "font-semibold text-ink" : "text-muted",
              )}
            >
              <Icon
                className="size-5 transition-transform duration-240 ease-out-soft"
                strokeWidth={active ? 2.4 : 1.8}
              />
              {t(item.label)}
              <span
                className={cn(
                  "absolute inset-x-3 bottom-0.5 h-0.5 rounded-full bg-ink transition-[opacity,transform] duration-240 ease-out-soft",
                  active ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0",
                )}
              />
            </button>
          );
        })}
      </nav>

      <ExpandLayer />
      <SshTerminal />
      <Settings />
      <Composer />
      <CommandPalette />
      <VaultGate />
      <Onboarding />
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: "!bg-card !text-ink !shadow-[var(--shadow-float)] !border-0 !rounded-lg",
        }}
      />
    </div>
  );
}

function MobileDrawer() {
  const open = useAppStore((s) => s.mobileNav);
  const setMobileNav = useAppStore((s) => s.setMobileNav);
  const { mounted, shown } = usePresence(open, 220);
  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        className="anim-scrim absolute inset-0 bg-ink/30"
        data-shown={shown}
        aria-label={t("关闭菜单")}
        onClick={() => setMobileNav(false)}
      />
      <Sidebar className="anim-drawer relative z-10 h-full shadow-float" data-shown={shown} />
    </div>
  );
}

const MOBILE_NAV: { id: ViewId; label: string; icon: typeof House }[] = [
  { id: "overview", label: "总览", icon: House },
  { id: "servers", label: "主机", icon: Server },
  { id: "domains", label: "域名", icon: Globe },
  { id: "ai", label: "AI", icon: Bot },
  { id: "terminal", label: "终端", icon: SquareTerminal },
];

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n));
}
