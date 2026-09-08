import type { MouseEvent } from "react";
import {
  CircleAlert,
  Copy,
  Globe,
  KeyRound,
  Loader2,
  Mail,
  Server,
  Shield,
  SquareTerminal,
} from "lucide-react";
import { toast } from "sonner";
import { CardTag } from "./tag-bar";
import { AssetImage } from "./image-picker";
import { TimeAgo } from "./ui/time-ago";
import { isDesktop } from "@/lib/desktop";
import { useLive } from "@/lib/live";
import { useProbeState } from "@/lib/probes";
import { tagsOf } from "@/lib/tags";
import { barTone, chipClass, dotClass, STATUS_LABEL } from "@/lib/status";
import { useAppStore } from "@/lib/store";
import type {
  AiAsset,
  AssetKind,
  Certificate,
  Domain,
  Mailbox,
  Secret,
  Server as ServerT,
} from "@/lib/types";
import { cn, copyText, daysUntil, formatDate, formatUsd } from "@/lib/utils";
import { t } from "@/lib/i18n";

export function openFromEvent(e: MouseEvent<HTMLElement>, kind: AssetKind, id: string) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  useAppStore.getState().setExpanded({
    kind,
    id,
    origin: { x: r.left, y: r.top, w: r.width, h: r.height },
  });
}

export function ServerCard({ data, compact = true }: { data: ServerT; compact?: boolean }) {
  const liveCpu = useLive((s) => s.cpu[data.id]);
  const liveMem = useLive((s) => s.memory[data.id]);
  const cpu = liveCpu ?? data.cpu;
  const mem = liveMem ?? data.memory;
  const status = data.status;

  return (
    <article
      className={cn(
        "group relative bg-card p-4 text-left",
        compact ? "card-tap cursor-pointer rounded-xl shadow-card" : "rounded-2xl",
      )}
      data-asset-id={compact ? data.id : undefined}
      onClick={compact ? (e) => openFromEvent(e, "server", data.id) : undefined}
    >
      <header className="flex items-start gap-3">
        <AssetImage
          value={data.imageDataUrl}
          fallback={
            <div className="grid size-10 shrink-0 place-items-center rounded-md bg-line text-ink">
              <Server className="size-4.5" strokeWidth={1.8} />
            </div>
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold tracking-tight">{data.name}</h3>
            <span
              key={status}
              className={cn(chipClass(status), "status-feedback")}
              data-status={status}
            >
              <span className={dotClass(status)} />
              {t(STATUS_LABEL[status])}
            </span>
          </div>
          <p className="mt-0.5 truncate text-meta text-muted">
            {data.label} · {data.os}
          </p>
        </div>
      </header>

      <p className="mt-3 font-mono text-meta text-ink">
        {data.username}@{data.host}
        <span className="text-subtle">:{data.port}</span>
      </p>
      <p className="mt-0.5 text-2xs text-subtle">{data.region}</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Metric label="CPU" value={cpu} />
        <Metric label={t("内存")} value={mem} />
        <Metric label={t("磁盘")} value={data.disk} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {data.tags.map((t) => (
          <CardTag key={t} tag={t} />
        ))}
        <span className="ml-auto text-2xs tabular-nums text-subtle">
          {t("运行 {0}", data.uptime)} · <TimeAgo iso={data.lastSeen} />
        </span>
      </div>

      <ProbeNote id={data.id} error={data.probeError} at={data.probedAt} />

      {!compact && (
        <div className="mt-5 space-y-4 border-t border-line pt-4">
          {(data.kernel || data.loadavg) && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-2xs">
              {data.kernel && (
                <div>
                  <dt className="text-subtle">{t("内核")}</dt>
                  <dd className="font-mono text-ink">{data.kernel}</dd>
                </div>
              )}
              {data.loadavg && (
                <div>
                  <dt className="text-subtle">{t("负载")}</dt>
                  <dd className="font-mono text-ink">{data.loadavg}</dd>
                </div>
              )}
            </dl>
          )}
          <p className="text-meta leading-relaxed text-muted">{data.notes}</p>
          <div className="flex flex-wrap gap-2">
            <CopyBtn text={`${data.username}@${data.host} -p ${data.port}`} label={t("复制 SSH")} />
            <CopyBtn text={data.host} label={t("复制 IP")} />
            {status !== "offline" && (
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3 text-meta font-medium text-card"
                onClick={(e) => {
                  e.stopPropagation();
                  useAppStore.getState().openSsh(data.id);
                }}
              >
                <SquareTerminal className="size-3.5" />

                {t("玻璃终端")}
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * What the last live probe reported. Only the desktop build ever sets these, so
 * the strip simply does not render in the web preview.
 */
function ProbeNote({ id, error, at }: { id: string; error?: string; at?: string }) {
  const busy = useProbeState((s) => Boolean(s.busy[id]));
  if (busy) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted">
        <Loader2 className="size-3.5 animate-spin" />

        {t("正在采集…")}
      </p>
    );
  }
  if (!error && !at) return null;
  if (error) {
    return (
      <p className="mt-3 flex items-start gap-1.5 text-2xs leading-relaxed text-crit">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0">{error}</span>
      </p>
    );
  }
  return (
    <p className="mt-3 text-2xs text-subtle">
      {t("实时采集于")} <TimeAgo iso={at!} />
    </p>
  );
}

/** Clickable tags. Selecting one narrows the list to it. */
function TagRow({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <CardTag key={t} tag={t} />
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  const tone = barTone(value);
  return (
    <div>
      <div className="mb-1 flex justify-between text-2xs text-muted">
        <span>{label}</span>
        <span className="tabular-nums text-ink">{Math.round(value)}%</span>
      </div>
      <div className={cn("metric-bar", tone === "ok" ? "" : tone)}>
        <span style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

export function DomainCard({ data, compact = true }: { data: Domain; compact?: boolean }) {
  const d = daysUntil(data.expiresAt);
  return (
    <article
      className={cn(
        "bg-card p-4 text-left",
        compact ? "card-tap cursor-pointer rounded-xl shadow-card" : "rounded-2xl",
      )}
      data-asset-id={compact ? data.id : undefined}
      onClick={compact ? (e) => openFromEvent(e, "domain", data.id) : undefined}
    >
      <header className="flex items-start gap-3">
        <AssetImage
          value={data.imageDataUrl}
          fallback={
            <div className="grid size-10 shrink-0 place-items-center rounded-md bg-line">
              <Globe className="size-4.5" />
            </div>
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold tracking-tight">{data.name}</h3>
          </div>
          <p className="mt-0.5 text-meta text-muted">
            {data.registrar} · DNS {data.dns}
          </p>
        </div>
        <span
          key={data.status}
          className={cn(chipClass(data.status), "status-feedback")}
          data-status={data.status}
        >
          <span className={dotClass(data.status)} />
          {d <= 0 ? t("已过期") : t("{0} 天", d)}
        </span>
      </header>
      <p className="mt-3 text-meta text-muted">
        {t("到期 {0}", formatDate(data.expiresAt))}
        {data.autoRenew ? t(" · 自动续费") : t(" · 未开自动续费")}
      </p>
      <TagRow tags={tagsOf(data)} />
      <ProbeNote id={data.id} error={data.probeError} at={data.probedAt} />

      {!compact && (
        <div className="mt-4 space-y-2 border-t border-line pt-4 text-meta text-muted">
          <p>Nameservers</p>
          <ul className="font-mono text-2xs text-ink">
            {data.nameservers.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p>{data.notes}</p>
          <CopyBtn text={data.name} label={t("复制域名")} />
        </div>
      )}
    </article>
  );
}

export function MailCard({ data, compact = true }: { data: Mailbox; compact?: boolean }) {
  const pct = data.quotaMb ? Math.round((data.usedMb / data.quotaMb) * 100) : 0;
  const kindLabel =
    data.kind === "mailbox" ? t("邮箱") : data.kind === "alias" ? t("别名") : t("转发");
  return (
    <article
      className={cn(
        "bg-card p-4 text-left",
        compact ? "card-tap cursor-pointer rounded-xl shadow-card" : "rounded-2xl",
      )}
      data-asset-id={compact ? data.id : undefined}
      onClick={compact ? (e) => openFromEvent(e, "mail", data.id) : undefined}
    >
      <header className="flex items-start gap-3">
        <AssetImage
          value={data.imageDataUrl}
          fallback={
            <div className="grid size-10 shrink-0 place-items-center rounded-md bg-line">
              <Mail className="size-4.5" />
            </div>
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold tracking-tight">{data.address}</h3>
          </div>
          <p className="mt-0.5 text-meta text-muted">
            {kindLabel}
            {data.forwardTo ? ` → ${data.forwardTo}` : ""}
          </p>
        </div>
        <span
          key={data.status}
          className={cn(chipClass(data.status), "status-feedback")}
          data-status={data.status}
        >
          <span className={dotClass(data.status)} />
          {t(STATUS_LABEL[data.status])}
        </span>
      </header>
      {data.quotaMb > 0 && (
        <div className="mt-4">
          <Metric label={t("容量")} value={pct} />
          <p className="mt-1 text-2xs text-subtle tabular-nums">
            {data.usedMb} / {data.quotaMb} MB
          </p>
        </div>
      )}
      <TagRow tags={tagsOf(data)} />
      {!compact && <p className="mt-4 text-meta text-muted">{data.notes}</p>}
    </article>
  );
}

export function AiCard({ data, compact = true }: { data: AiAsset; compact?: boolean }) {
  return (
    <article
      className={cn(
        "bg-card p-4 text-left",
        compact ? "card-tap cursor-pointer rounded-xl shadow-card" : "rounded-2xl",
      )}
      data-asset-id={compact ? data.id : undefined}
      onClick={compact ? (e) => openFromEvent(e, "ai", data.id) : undefined}
    >
      <header className="flex items-start gap-3">
        <AssetImage
          value={data.imageDataUrl}
          fallback={
            <div className="grid size-10 shrink-0 place-items-center rounded-md bg-ink text-2xs font-semibold text-card">
              {data.provider.slice(0, 2)}
            </div>
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold tracking-tight">{data.name}</h3>
          </div>
          <p className="mt-0.5 text-meta text-muted">
            {data.provider} · {data.plan || t("未提供")}
          </p>
        </div>
        <span className="shrink-0 text-right text-body font-semibold tabular-nums">
          {data.monthlyUsdKnown === false ? (
            <span className="text-2xs font-normal text-muted">{t("月费未记录")}</span>
          ) : (
            formatUsd(data.monthlyUsd)
          )}
          {data.monthlyUsdKnown !== false && (
            <span className="text-2xs font-normal text-subtle"> {t("/月")}</span>
          )}
        </span>
      </header>
      <div className="mt-4">
        {data.oauthAccountId && !data.usageAvailable ? (
          <p className="break-words text-meta text-muted">
            {data.usageSummary ? `${t("剩余")}: ${data.usageSummary}` : t("暂无可读取额度")}
          </p>
        ) : (
          <Metric
            label={t(data.oauthAccountId ? "最高额度用量" : "本月用量")}
            value={data.usagePct}
          />
        )}
        {data.usageScope && (
          <p className="mt-2 text-2xs text-muted">
            {t("额度来源")}:{" "}
            {(
              {
                codex: "Codex",
                claude: "Claude OAuth",
                "grok-cli": "Grok CLI",
                "code-assist": "Gemini Code Assist",
              } as Record<string, string>
            )[data.usageScope] || data.usageScope}
          </p>
        )}
        {data.usageStale && (
          <p className="mt-1 text-2xs text-warn">{t("更新失败，保留上次数据")}</p>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-2xs text-subtle">
        <span className="min-w-0 truncate">
          {data.oauthAccountId ? t(data.oauthDisconnected ? "授权已断开" : "已授权") : data.keyHint}
        </span>
        <span
          key={data.status}
          className={cn(chipClass(data.status), "status-feedback")}
          data-status={data.status}
        >
          <span className={dotClass(data.status)} />
          {data.oauthAccountId ? (
            data.subscriptionExpiresAt ? (
              `${t("订阅到期")}: ${formatDate(data.subscriptionExpiresAt)}`
            ) : (
              t(
                data.oauthDisconnected
                  ? "授权已断开"
                  : data.usageStale
                    ? "需刷新"
                    : data.usageAvailable || data.usageSummary
                      ? "额度已同步"
                      : "额度待查询",
              )
            )
          ) : data.renewsAt ? (
            <>
              {daysUntil(data.renewsAt)} {t("天后续费")}
            </>
          ) : (
            t("未提供")
          )}
        </span>
      </div>
      <TagRow tags={tagsOf(data)} />
      {!compact && <p className="mt-4 text-meta text-muted">{data.notes}</p>}
    </article>
  );
}

export function SecretCard({ data, compact = true }: { data: Secret; compact?: boolean }) {
  const kindLabel =
    data.kind === "api"
      ? "API"
      : data.kind === "ssh"
        ? "SSH"
        : data.kind === "token"
          ? "Token"
          : t("密码");
  return (
    <article
      className={cn(
        "bg-card p-4 text-left",
        compact ? "card-tap cursor-pointer rounded-xl shadow-card" : "rounded-2xl",
      )}
      data-asset-id={compact ? data.id : undefined}
      onClick={compact ? (e) => openFromEvent(e, "secret", data.id) : undefined}
    >
      <header className="flex items-start gap-3">
        <AssetImage
          value={data.imageDataUrl}
          fallback={
            <div className="grid size-10 shrink-0 place-items-center rounded-md bg-line">
              <KeyRound className="size-4.5" />
            </div>
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold tracking-tight">{data.name}</h3>
          </div>
          <p className="mt-0.5 font-mono text-meta text-muted">{data.hint}</p>
        </div>
        <span className="chip chip-mute">{kindLabel}</span>
      </header>
      <p className="mt-3 text-2xs text-subtle">
        {t("上次轮换")} {formatDate(data.lastRotated)}
      </p>
      <TagRow tags={tagsOf(data)} />
      {!compact && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <p className="text-meta text-muted">{data.notes}</p>
          {/* Desktop keeps the value in the vault; the detail sheet's account
              panel reveals it there. This is the web preview's stand-in. */}
          {!isDesktop() && data.value ? <SecretReveal value={data.value} /> : null}
        </div>
      )}
    </article>
  );
}

function SecretReveal({ value }: { value: string }) {
  return (
    <button
      type="button"
      className="w-full rounded-md bg-canvas px-3 py-2 text-left font-mono text-2xs text-muted hover:text-ink"
      onClick={(e) => {
        e.stopPropagation();
        copyText(value);
        toast(t("已复制到剪贴板"));
      }}
    >
      {t("点击复制完整值 · {0}…", value.slice(0, 18))}
    </button>
  );
}

export function CertCard({ data, compact = true }: { data: Certificate; compact?: boolean }) {
  const d = daysUntil(data.expiresAt);
  return (
    <article
      className={cn(
        "bg-card p-4 text-left",
        compact ? "card-tap cursor-pointer rounded-xl shadow-card" : "rounded-2xl",
      )}
      data-asset-id={compact ? data.id : undefined}
      onClick={compact ? (e) => openFromEvent(e, "cert", data.id) : undefined}
    >
      <header className="flex items-start gap-3">
        <AssetImage
          value={data.imageDataUrl}
          fallback={
            <div className="grid size-10 shrink-0 place-items-center rounded-md bg-line">
              <Shield className="size-4.5" />
            </div>
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold tracking-tight">{data.cn}</h3>
          </div>
          <p className="mt-0.5 text-meta text-muted">{data.issuer}</p>
        </div>
        <span
          key={data.status}
          className={cn(chipClass(data.status), "status-feedback")}
          data-status={data.status}
        >
          <span className={dotClass(data.status)} />
          {d <= 0 ? t("已过期") : t("{0} 天", d)}
        </span>
      </header>
      <p className="mt-3 text-meta text-muted">
        {t("到期 {0}", formatDate(data.expiresAt))}
        {data.protocol ? ` · ${data.protocol}` : ""}
      </p>
      {data.trusted === false && (
        <p className="mt-1 text-2xs text-crit">
          {t("证书链不受信任")}
          {data.untrustedReason ? t("：{0}", data.untrustedReason) : ""}
        </p>
      )}
      <TagRow tags={tagsOf(data)} />
      <ProbeNote id={data.id} error={data.probeError} at={data.probedAt} />
      {!compact && (
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <p className="text-2xs text-subtle">SAN</p>
          <p className="font-mono text-meta">{data.sans.join(" · ")}</p>
          <p className="text-meta text-muted">{data.notes}</p>
        </div>
      )}
    </article>
  );
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  return (
    <button
      type="button"
      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-line px-3 text-meta font-medium text-ink hover:bg-line-strong"
      onClick={(e) => {
        e.stopPropagation();
        copyText(text);
        toast(t("已复制"));
      }}
    >
      <Copy className="size-3.5" />
      {label}
    </button>
  );
}
