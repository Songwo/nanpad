/**
 * 司南 — the compass rose.
 *
 * Drawn rather than rasterised: it stays crisp at every size, the background is
 * transparent, and the needle inherits `currentColor`, so the mark reads on the
 * light sidebar and the dark one without shipping two files. The three coloured
 * specks on the dial are the app's own status palette — normal, 注意, 告警.
 */
export function LogoMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" aria-hidden>
      {/* Dial: one ring broken at north and south, where the needle passes. */}
      <path
        d="M38.67 13.67 A19.5 19.5 0 0 1 38.67 50.33"
        stroke="currentColor"
        strokeOpacity="0.9"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M25.33 50.33 A19.5 19.5 0 0 1 25.33 13.67"
        stroke="currentColor"
        strokeOpacity="0.9"
        strokeWidth="5"
        strokeLinecap="round"
      />

      {/* The east–west arms sit behind the needle and stay quiet. */}
      <path d="M11 32 32 28.7 53 32 32 35.3Z" fill="currentColor" fillOpacity="0.28" />

      {/* North–south needle, split down the middle so it reads as a solid. */}
      <path d="M32 4.5 32 59.5 27.5 32Z" fill="currentColor" />
      <path d="M32 4.5 36.5 32 32 59.5Z" fill="currentColor" fillOpacity="0.55" />

      <circle cx="32" cy="32" r="3.8" fill="currentColor" />

      <circle cx="45.79" cy="18.21" r="2.2" fill="var(--color-warn)" />
      <circle cx="18.21" cy="18.21" r="2.2" fill="var(--color-crit)" />
      <circle cx="45.79" cy="45.79" r="2.2" fill="var(--color-ok)" />
    </svg>
  );
}

export function LogoWord() {
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      <div className="leading-tight">
        <div className="text-lg font-bold tracking-wordmark">司南</div>
        <div className="text-2xs text-muted">个人数字资产指挥台</div>
      </div>
    </div>
  );
}
