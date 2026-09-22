import { Coins, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { calculateEstateValuation, formatCurrencyUsd } from "@/lib/valuation";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";

export function PortfolioValuationCard() {
  const servers = useAppStore((s) => s.servers);
  const domains = useAppStore((s) => s.domains);
  const mailboxes = useAppStore((s) => s.mailboxes);
  const aiAssets = useAppStore((s) => s.aiAssets);
  const secrets = useAppStore((s) => s.secrets);
  const certs = useAppStore((s) => s.certs);

  const { totalUsd, categories } = calculateEstateValuation({
    servers,
    domains,
    mailboxes,
    aiAssets,
    secrets,
    certs,
  });

  return (
    <div className="asset-card-valuable rounded-2xl border border-line bg-card p-5 relative overflow-hidden transition-all hover:border-line-focus shadow-sm">
      {/* Background Subtle Gradient Glow */}
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-amber-500/5 blur-3xl" />
      <div className="pointer-events-none absolute -left-16 -bottom-16 size-48 rounded-full bg-sky-500/5 blur-3xl" />

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-muted">
            <Coins className="size-3.5 text-amber-400" />
            <span>{t("全域个人数字资产总估值")}</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.2 text-[10px] text-amber-400 font-mono">
              <Sparkles className="size-2.5" />
              {t("高净值数字组合")}
            </span>
          </div>

          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-extrabold tracking-tight text-ink">
              {formatCurrencyUsd(totalUsd)}
            </span>
            <span className="text-xs font-medium text-emerald-400 flex items-center gap-1">
              <TrendingUp className="size-3" />
              {t("年化算力与资产底蕴")}
            </span>
          </div>
          <p className="text-xs text-muted mt-0.5">
            {t("基于受保护的计算实例、顶级域名、企业级证书与 AI 算力预算综合测算")}
          </p>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <div className="rounded-xl border border-line bg-surface-subtle/80 px-3 py-2 text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted">{t("安全保护资产")}</div>
            <div className="font-mono text-sm font-semibold text-ink">
              {servers.length + domains.length + mailboxes.length + aiAssets.length + secrets.length + certs.length}{" "}
              <span className="text-xs font-normal text-muted">{t("项")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Multi-segment Proportional Progress Bar */}
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-line/60 flex">
        {categories.map((cat) => (
          <div
            key={cat.key}
            style={{
              width: `${cat.pct}%`,
              backgroundColor: cat.color,
            }}
            className="h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full"
            title={`${cat.label}: ${formatCurrencyUsd(cat.usd)} (${cat.pct}%)`}
          />
        ))}
      </div>

      {/* Breakdown Pills */}
      <div className="mt-3.5 flex flex-wrap items-center gap-2 text-xs">
        {categories.map((cat) => (
          <div
            key={cat.key}
            className="flex items-center gap-1.5 rounded-lg border border-line/70 bg-surface-subtle/60 px-2.5 py-1 text-[11px]"
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: cat.color }}
            />
            <span className="text-muted">{t(cat.label)}</span>
            <span className="font-mono font-medium text-ink">
              {formatCurrencyUsd(cat.usd)}
            </span>
            <span className="text-subtle font-mono text-[10px]">({cat.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
