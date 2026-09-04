/**
 * 司南 — the Han-dynasty lodestone compass: a square plate with a needle that
 * always finds its bearing. The mark is that needle, north half lit.
 */
export function LogoMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--color-ink)" />
      <circle
        cx="16"
        cy="16"
        r="9.5"
        fill="none"
        stroke="var(--color-card)"
        strokeOpacity="0.24"
        strokeWidth="1.2"
      />
      <path d="M16 5.6 19.4 16 16 26.4 12.6 16Z" fill="var(--color-card)" opacity="0.34" />
      <path d="M16 5.6 19.4 16 12.6 16Z" fill="var(--color-card)" />
      <circle cx="16" cy="16" r="1.7" fill="var(--color-ink)" />
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
