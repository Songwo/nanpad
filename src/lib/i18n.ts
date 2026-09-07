import { EN } from "./i18n-en.ts";

export type LocaleChoice = "system" | "zh" | "en";
export type Locale = "zh" | "en";

/**
 * Chinese is the key.
 *
 * Keying the dictionary on the source string rather than on invented ids means
 * a missing translation degrades to readable Chinese instead of `settings.title`,
 * and adding a string to the UI never requires touching a key file first — the
 * only cost is that changing the Chinese wording orphans its translation, which
 * `npm run i18n:check` reports.
 */
let current: Locale = "zh";
const listeners = new Set<() => void>();

export function setLocale(locale: Locale) {
  if (current === locale) return;
  current = locale;
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLocale(): Locale {
  return current;
}

export function intlLocale(): string {
  return current === "zh" ? "zh-CN" : "en-US";
}

/**
 * Translate, with positional interpolation.
 *
 *   t("已添加 {0}", name)
 *
 * Placeholders are numbered rather than named so a translation can reorder them
 * — English and Chinese do not agree on where a count goes.
 */
export function t(zh: string, ...args: Array<string | number>): string {
  const key = zh.replace(/\r\n/g, "\n");
  const raw = current === "en" ? (EN[key] ?? zh) : zh;
  if (args.length === 0) return raw;
  return raw.replace(/\{(\d+)\}/g, (match: string, i: string) => {
    const value = args[Number(i)];
    return value === undefined ? match : String(value);
  });
}

/** Resolve "system" against the OS/browser language. */
export function resolveLocale(choice: LocaleChoice): Locale {
  if (choice !== "system") return choice;
  if (typeof navigator === "undefined") return "zh";
  return /^zh\b/i.test(navigator.language) ? "zh" : "en";
}
