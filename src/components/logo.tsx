import { t } from "@/lib/i18n";
import { BRAND_MARK } from "@/lib/brand-mark.mjs";

/** 界面与桌面使用相同的品牌配色，浅深主题均保留彩色标记。 */
export function LogoMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" aria-hidden="true">
      <rect x="1" y="1" width="62" height="62" rx="16" fill={BRAND_MARK.plate} />
      <rect x="1.5" y="1.5" width="61" height="61" rx="15.5" stroke={BRAND_MARK.edge} />
      <g transform="translate(6 6) scale(.8125)">
        <path d={BRAND_MARK.upper} fill={BRAND_MARK.paper} />
        <path d={BRAND_MARK.lower} fill={BRAND_MARK.jade} />
      </g>
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
