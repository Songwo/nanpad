import { desktop } from "./desktop";
import {
  readZoomPercent,
  validateZoomPercent,
  zoomCommandForKey,
  stepZoomPercent,
  type ZoomPercent,
} from "../../electron/services/display.mjs";
export { ZOOM_PERCENTS, type ZoomPercent } from "../../electron/services/display.mjs";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { resolveLocale, setLocale, type LocaleChoice } from "./i18n";

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

interface SettingsState {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  documentListCollapsed: boolean;
  setDocumentListCollapsed: (collapsed: boolean) => void;
  toolsExpanded: boolean;
  setToolsExpanded: (expanded: boolean) => void;
  zoomPercent: ZoomPercent;
  zoomReady: boolean;
  setZoomPercent: (value: ZoomPercent) => Promise<void>;
  assetLayout: "cards" | "table" | "graph";
  setAssetLayout: (layout: "cards" | "table" | "graph") => void;
  language: LocaleChoice;
  setLanguage: (language: LocaleChoice) => void;
  theme: ThemeChoice;
  /** What `theme` currently resolves to — "system" follows the OS. */
  resolved: ResolvedTheme;
  setTheme: (theme: ThemeChoice) => void;
  setResolved: (resolved: ResolvedTheme) => void;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === "system" ? systemTheme() : choice;
}

/**
 * Machine-local preferences.
 *
 * Deliberately not in `assets.json`: the asset file is the thing you export,
 * import on another machine and keep in sync, and a theme choice has no
 * business travelling with it.
 */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      documentListCollapsed: false,
      setDocumentListCollapsed: (documentListCollapsed) => set({ documentListCollapsed }),
      toolsExpanded: false,
      setToolsExpanded: (toolsExpanded) => set({ toolsExpanded }),
      zoomPercent: 100,
      zoomReady: false,
      setZoomPercent: async (value) => {
        const zoomPercent = validateZoomPercent(value);
        const bridge = desktop();
        if (bridge) {
          const state = await bridge.display.set(zoomPercent);
          set({ zoomPercent: state.zoomPercent });
        } else {
          set({ zoomPercent });
        }
      },
      assetLayout: "cards",
      setAssetLayout: (assetLayout) => set({ assetLayout }),
      language: "system",
      setLanguage: (language) => {
        setLocale(resolveLocale(language));
        set({ language });
      },
      theme: "system",
      resolved: "light",
      setTheme: (theme) => set({ theme, resolved: resolveTheme(theme) }),
      setResolved: (resolved) => set({ resolved }),
    }),
    {
      name: "sinan-settings-v1",
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? { getItem: () => null, setItem: () => {}, removeItem: () => {} }
          : window.localStorage,
      ),
      partialize: (s) =>
        ({
          theme: s.theme,
          language: s.language,
          assetLayout: s.assetLayout,
          zoomPercent: s.zoomPercent,
          toolsExpanded: s.toolsExpanded,
          sidebarCollapsed: s.sidebarCollapsed,
          documentListCollapsed: s.documentListCollapsed,
        }) as SettingsState,
      merge: (persisted, current) => {
        const saved = persisted as Partial<SettingsState> | undefined;
        return {
          ...current,
          ...saved,
          zoomPercent: readZoomPercent(saved?.zoomPercent),
          zoomReady: false,
          toolsExpanded: saved?.toolsExpanded === true,
          sidebarCollapsed: saved?.sidebarCollapsed === true,
          documentListCollapsed: saved?.documentListCollapsed === true,
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setResolved(resolveTheme(state.theme));
      },
    },
  ),
);

/**
 * Keep `<html data-theme>` in step with the choice and, for "system", with the
 * OS switching underneath us.
 *
 * The attribute is always a concrete "light"/"dark" so the stylesheet needs one
 * override block rather than one per source of truth.
 */
export function startThemeSync(): () => void {
  if (typeof window === "undefined") return () => {};

  const apply = () => {
    const resolved = resolveTheme(useSettings.getState().theme);
    document.documentElement.dataset.theme = resolved;
    // Native form controls, scrollbars and the window background follow this.
    document.documentElement.style.colorScheme = resolved;
    if (useSettings.getState().resolved !== resolved) {
      useSettings.getState().setResolved(resolved);
    }
  };

  apply();
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", apply);
  const unsubscribe = useSettings.subscribe(apply);

  return () => {
    media.removeEventListener("change", apply);
    unsubscribe();
  };
}

export function startLocaleSync(): () => void {
  const apply = () => {
    setLocale(resolveLocale(useSettings.getState().language));
    document.documentElement.lang =
      resolveLocale(useSettings.getState().language) === "zh" ? "zh-CN" : "en";
  };
  apply();
  const unsubscribe = useSettings.subscribe(apply);
  window.addEventListener("languagechange", apply);
  return () => {
    unsubscribe();
    window.removeEventListener("languagechange", apply);
  };
}

/** 桌面以主进程偏好为准；网页预览采用布局缩放，避免 transform 栅格拉伸。 */
export function startDisplaySync(onError: (message: string) => void): () => void {
  const bridge = desktop();
  if (bridge) {
    let disposed = false;
    let changed = false;
    const off = bridge.display.onChanged((state) => {
      changed = true;
      useSettings.setState({ zoomPercent: readZoomPercent(state.zoomPercent), zoomReady: true });
    });
    const offError = bridge.display.onError((event) => onError(event.message));
    void bridge.display
      .get()
      .then((state) => {
        if (!disposed && !changed)
          useSettings.setState({
            zoomPercent: readZoomPercent(state.zoomPercent),
            zoomReady: true,
          });
      })
      .catch((error: unknown) => {
        if (!disposed) {
          useSettings.setState({ zoomReady: true });
          onError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      disposed = true;
      off();
      offError();
    };
  }
  const apply = () => {
    const factor = useSettings.getState().zoomPercent / 100;
    document.documentElement.style.zoom = String(factor);
    document.documentElement.style.setProperty("--app-zoom", String(factor));
    document.documentElement.style.setProperty("--app-viewport-height", `calc(100dvh / ${factor})`);
  };
  apply();
  useSettings.setState({ zoomReady: true });
  const off = useSettings.subscribe(apply);
  const onKey = (event: KeyboardEvent) => {
    const command = zoomCommandForKey({
      key: event.key,
      control: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
    });
    if (!command) return;
    event.preventDefault();
    void useSettings
      .getState()
      .setZoomPercent(stepZoomPercent(useSettings.getState().zoomPercent, command));
  };
  window.addEventListener("keydown", onKey);
  return () => {
    off();
    window.removeEventListener("keydown", onKey);
    document.documentElement.style.removeProperty("zoom");
    document.documentElement.style.removeProperty("--app-zoom");
    document.documentElement.style.removeProperty("--app-viewport-height");
  };
}
