import { t } from "@/lib/i18n";
import { BRAND_MARK } from "@/lib/brand-mark.mjs";

/** 两片岛形纸页在留白中形成连接，小尺寸和单色主题下仍可辨认。 */
export function LogoMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" aria-hidden="true">
      <path d={BRAND_MARK.upper} fill="currentColor" />
      <path d={BRAND_MARK.lower} fill="currentColor" fillOpacity="0.55" />
    </svg>
  );
}

export function LogoWord() {
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      <div className="leading-tight">
        <div className="text-lg font-bold tracking-wordmark">{t("知屿")}</div>
        <div className="text-2xs text-muted">{t("个人知识与资产空间")}</div>
      </div>
    </div>
  );
}
