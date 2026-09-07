import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { resolveLocale, setLocale, type LocaleChoice } from "./i18n";

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

interface SettingsState {
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
        ({ theme: s.theme, language: s.language, assetLayout: s.assetLayout }) as SettingsState,
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
