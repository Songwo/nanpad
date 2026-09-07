import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { t, intlLocale } from "./i18n.ts";

/**
 * tailwind-merge only knows stock Tailwind scales. Our `@theme` adds custom
 * colours (`text-card`), type steps (`text-meta`) and shadows (`shadow-card`),
 * and without this map it files `text-card` under *font-size* — so `text-body`
 * later in the list silently deletes the colour. That is how the sidebar CTA
 * ended up black-on-black. Teach it the tokens instead.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        "canvas",
        "sidebar",
        "card",
        "ink",
        "muted",
        "subtle",
        "line",
        "line-strong",
        "banner",
        "ok",
        "warn",
        "crit",
        "glass",
        "glass-border",
        "term",
      ],
      text: ["2xs", "meta", "body"],
      radius: ["xs", "sm", "md", "lg", "xl", "2xl"],
      shadow: ["card", "card-hover", "float"],
      ease: ["out-soft", "out"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function formatUsd(n: number): string {
  return new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
}

export function daysUntil(iso: string): number {
  const t = new Date(iso).getTime();
  return Math.ceil((t - Date.now()) / 86_400_000);
}

export function formatDate(iso: string): string {
  if (!Number.isFinite(new Date(iso).getTime())) return "-";
  return new Intl.DateTimeFormat(intlLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return t("刚刚");
  if (min < 60) return t("{0} 分钟前", min);
  const hr = Math.round(min / 60);
  if (hr < 24) return t("{0} 小时前", hr);
  const d = Math.round(hr / 24);
  if (d < 30) return t("{0} 天前", d);
  return formatDate(iso);
}

export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

export function downloadJson(filename: string, data: unknown) {
  downloadText(filename, JSON.stringify(data, null, 2), "application/json");
}

export function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
