import { useEffect, useState } from "react";
import { Search, Sun, Moon, Settings2 } from "lucide-react";
import { WindowControls } from "./window-controls";
import { LogoMark } from "./logo";
import { desktop } from "@/lib/desktop";
import { useAppStore } from "@/lib/store";
import { useSettings } from "@/lib/settings";
import { t } from "@/lib/i18n";

export function TitleBar() {
  const bridge = desktop();
  const setCommandOpen = useAppStore((s) => s.setCommandOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const resolved = useSettings((s) => s.resolved);
  const setTheme = useSettings((s) => s.setTheme);
  const [platform, setPlatform] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void bridge?.win
      .state()
      .then((state) => {
        if (alive) setPlatform(state.platform);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bridge]);
  return (
    <header className="drag-strip app-titlebar" onDoubleClick={() => bridge?.win.toggleMaximize()}>
      <div className="flex min-w-0 items-center gap-3">
        {platform === "darwin" && <span className="w-16 shrink-0" />}
        <LogoMark className="size-6 shrink-0" />
        <span className="truncate text-sm font-semibold">
          {t("司南")} <span className="text-muted">Nanpad</span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="workspace-search"
          onClick={() => setCommandOpen(true)}
          aria-label={t("搜索资产")}
        >
          <Search className="size-4" />
          <span className="hidden sm:inline">{t("搜索资产")}</span>
          <kbd className="hidden sm:inline text-xs">{platform === "darwin" ? "⌘ K" : "Ctrl K"}</kbd>
        </button>
        <button
          type="button"
          className="chrome-action"
          aria-label={t("切换主题外观")}
          onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
        >
          {resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <button
          type="button"
          className="chrome-action"
          aria-label={t("系统设置…")}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="size-4" />
        </button>
        {bridge && <WindowControls />}
      </div>
    </header>
  );
}
