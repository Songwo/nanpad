import { useEffect, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { AlertTriangle, Check, Search, SquareTerminal } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import {
  AiCard,
  CertCard,
  DomainCard,
  MailCard,
  SecretCard,
  ServerCard,
} from "./asset-card";
import { useAlerts } from "./right-rail";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { CountUp, TimeAgo } from "./ui/time-ago";
import { useLive } from "@/lib/live";
import { attentionOf, chipClass, dotClass, healthScore, STATUS_LABEL } from "@/lib/status";
import { useAppStore } from "@/lib/store";
import type { Status, ViewId } from "@/lib/types";
import { cn, formatUsd } from "@/lib/utils";

export function MainView() {
  const view = useAppStore((s) => s.view);
  const filter = useAppStore((s) => s.filter);
  // Re-keying replays the entrance, so switching views reads as a change of
  // place rather than a silent content swap.
  return (
    <div key={`${view}:${filter}`} className="view-in">
      <ViewBody />
    </div>
  );
}

function ViewBody() {
  const view = useAppStore((s) => s.view);
  switch (view) {
    case "overview":
      return <Overview />;
    case "servers":
      return <ServersView />;
    case "domains":
      return <DomainsView />;
    case "mail":
      return <MailView />;
    case "ai":
      return <AiView />;
    case "vault":
      return <VaultView />;
    case "certs":
      return <CertsView />;
    case "terminal":
      return <TerminalView />;
  }
}

export function TopTabs() {
  const view = useAppStore((s) => s.view);
  const filter = useAppStore((s) => s.filter);
  const setFilter = useAppStore((s) => s.setFilter);
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const setCommandOpen = useAppStore((s) => s.setCommandOpen);
  const title = TITLE[view];
  const counts = useAppStore(useShallow(attentionOf));
  // The badge counts what *this* tab would filter to, not the whole estate.
  const pending = counts[BADGE_KEY[view]];
  const bar = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null);

  // The underline is one element that slides between labels; measuring the
  // label (not the flex-1 button) keeps it hugging the text like the tab it
  // belongs to.
  useEffect(() => {
    const root = bar.current;
    if (!root) return;
    const measure = () => {
      const label = root.querySelector<HTMLElement>('[data-active="true"] [data-label]');
      if (!label) return;
      const r = label.getBoundingClientRect();
      const p = root.getBoundingClientRect();
      setIndicator({ x: r.left - p.left, w: r.width });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [filter, view]);

  return (
    <div className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div ref={bar} className="relative flex h-14 items-stretch">
        <Tab active={filter === "all"} onClick={() => setFilter("all")}>
          {title.all}
        </Tab>
        <Tab active={filter === "attention"} onClick={() => setFilter("attention")}>
          {title.attention}
          {pending > 0 && (
            <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-crit px-1.5 text-2xs font-semibold tabular-nums text-card">
              {pending}
            </span>
          )}
        </Tab>
        <span
          className="tab-indicator"
          style={{
            width: indicator?.w ?? 0,
            transform: `translateX(${indicator?.x ?? 0}px)`,
            opacity: indicator ? 1 : 0,
          }}
        />
      </div>
      <div className="flex items-center gap-2 px-4 py-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="筛选当前列表"
            className="h-9 bg-card pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="xl:hidden"
          onClick={() => setCommandOpen(true)}
        >
          ⌘K
        </Button>
      </div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="relative flex flex-1 items-center justify-center text-body font-medium text-muted transition-colors duration-150 ease-out hover:bg-line/70 data-[active=true]:text-ink"
      data-active={active}
      onClick={onClick}
    >
      <span
        data-label
        className={cn("inline-flex items-center px-1 py-4", active && "font-bold")}
      >
        {children}
      </span>
    </button>
  );
}

const BADGE_KEY: Record<ViewId, keyof ReturnType<typeof attentionOf>> = {
  overview: "total",
  servers: "servers",
  domains: "domains",
  mail: "mail",
  ai: "ai",
  vault: "vault",
  certs: "certs",
  terminal: "servers",
};

const TITLE: Record<string, { all: string; attention: string }> = {
  overview: { all: "为你准备", attention: "需处理" },
  servers: { all: "全部主机", attention: "异常" },
  domains: { all: "全部域名", attention: "即将到期" },
  mail: { all: "全部邮箱", attention: "需处理" },
  ai: { all: "全部订阅", attention: "用量告警" },
  vault: { all: "全部密钥", attention: "待轮换" },
  certs: { all: "全部证书", attention: "即将到期" },
  terminal: { all: "会话", attention: "离线主机" },
};

function TipBanner() {
  return (
    <div className="mx-4 mt-3 rounded-xl bg-banner px-4 py-3 text-meta text-ink shadow-card">
      <p className="mb-1.5 text-2xs font-semibold tracking-wide text-muted">重点提示</p>
      <ul className="space-y-1">
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 size-3.5 shrink-0 text-ok" strokeWidth={2.4} />
          黄闪 = 到期 / 高负载 / 用量；红闪 = 离线或不足 7 天。
        </li>
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 size-3.5 shrink-0 text-ok" strokeWidth={2.4} />
          点开白色卡片放大详情；服务器可开玻璃 SSH 终端（本机模拟）。
        </li>
      </ul>
    </div>
  );
}

function Overview() {
  const servers = useAppStore((s) => s.servers);
  const aiAssets = useAppStore((s) => s.aiAssets);
  const activity = useAppStore((s) => s.activity);
  const filter = useAppStore((s) => s.filter);
  const score = useAppStore(healthScore);
  const att = useAppStore(useShallow(attentionOf));
  const alerts = useAlerts();
  const spend = aiAssets.reduce((a, x) => a + x.monthlyUsd, 0);
  const online = servers.filter((s) => s.status === "online").length;

  const spendSeries = [
    { m: "4月", v: Math.round(spend * 0.72) },
    { m: "5月", v: Math.round(spend * 0.8) },
    { m: "6月", v: Math.round(spend * 0.86) },
    { m: "7月", v: Math.round(spend * 0.9) },
    { m: "8月", v: Math.round(spend * 0.96) },
    { m: "9月", v: spend },
  ];

  if (filter === "attention") {
    return (
      <div>
        <TipBanner />
        <section className="stagger-in mx-4 mt-4 space-y-2 pb-24">
          {alerts.length === 0 ? (
            <Empty text="目前没有需要处理的项目。" />
          ) : (
            alerts.map((a) => (
              <AlertRow
                key={a.id}
                title={a.title}
                detail={a.detail}
                status={a.status}
              />
            ))
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <TipBanner />

      <section className="stagger-in mx-4 mt-4 grid grid-cols-2 gap-3 @2xl:grid-cols-4">
        <Stat
          label="健康分"
          value={<CountUp value={score} />}
          hint={score >= 80 ? "运转良好" : "有事项待处理"}
          tone={score >= 80 ? "online" : score >= 60 ? "warning" : "offline"}
        />
        <Stat
          label="主机在线"
          value={
            <>
              <CountUp value={online} />/{servers.length}
            </>
          }
          hint={`${att.servers} 台异常`}
          tone={att.servers ? "warning" : "online"}
        />
        <Stat
          label="AI 月费"
          value={<CountUp value={spend} format={formatUsd} />}
          hint={`${aiAssets.length} 个订阅`}
          tone="online"
        />
        <Stat
          label="待处理"
          value={<CountUp value={att.total} />}
          hint="证书 / 域名 / 负载"
          tone={att.total ? "warning" : "online"}
        />
      </section>

      <section className="mx-4 mt-4 rounded-xl bg-card p-4 shadow-card">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-semibold tracking-tight">AI 支出趋势</h2>
          <span className="text-2xs text-subtle">近 6 个月 · 美元</span>
        </div>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spendSeries} margin={{ top: 4, right: 14, bottom: 0, left: 14 }}>
              <defs>
                <linearGradient id="spend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-ink)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--color-ink)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="m"
                tick={{ fontSize: 11, fill: "var(--color-subtle)" }}
                axisLine={false}
                tickLine={false}
                dy={4}
                interval={0}
                padding={{ left: 6, right: 6 }}
              />
              <Tooltip
                cursor={{ stroke: "var(--color-line-strong)", strokeWidth: 1 }}
                contentStyle={{
                  border: "none",
                  borderRadius: 8,
                  fontSize: 12,
                  boxShadow: "var(--shadow-card)",
                }}
                formatter={(v) => [formatUsd(Number(v)), "支出"]}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke="var(--color-ink)"
                strokeWidth={1.8}
                fill="url(#spend)"
                animationDuration={700}
                activeDot={{ r: 3.5, fill: "var(--color-ink)", strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Below xl the rail is gone, so the same two panels ride along here. */}
      {alerts.length > 0 && (
        <section className="mx-4 mt-4 xl:hidden">
          <h2 className="mb-2 px-1 text-meta font-medium text-muted">需要留意</h2>
          <div className="space-y-2">
            {alerts.slice(0, 4).map((a) => (
              <AlertRow key={a.id} title={a.title} detail={a.detail} status={a.status} />
            ))}
          </div>
        </section>
      )}

      <section className="mx-4 mt-4 rounded-xl bg-card p-4 shadow-card xl:hidden">
        <h2 className="mb-3 font-semibold tracking-tight">最近动态</h2>
        <ul className="space-y-3">
          {activity.slice(0, 6).map((a) => (
            <li key={a.id} className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink/40" />
              <div className="min-w-0">
                <p className="text-meta leading-snug">{a.text}</p>
                <TimeAgo iso={a.at} className="text-2xs text-subtle" />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-4 mt-5">
        <h2 className="mb-2 px-1 text-meta font-medium text-muted">主机</h2>
        <div className="stagger-in grid gap-3 @2xl:grid-cols-2">
          {servers.slice(0, 4).map((s) => (
            <ServerCard key={s.id} data={s} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint: string;
  tone: Status;
}) {
  return (
    <div className="rounded-xl bg-card p-4 shadow-card">
      <div className="flex items-center gap-2 text-2xs font-medium text-muted">
        <span className={dotClass(tone)} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="mt-1 text-2xs text-subtle">{hint}</div>
    </div>
  );
}

function AlertRow({
  title,
  detail,
  status,
}: {
  title: string;
  detail: string;
  status: Status;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-card px-4 py-3 shadow-card">
      <AlertTriangle
        className={cn("size-4 shrink-0", status === "offline" ? "text-crit" : "text-warn")}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-2xs text-muted">{detail}</p>
      </div>
      <span className={chipClass(status)}>
        <span className={dotClass(status)} />
        {STATUS_LABEL[status]}
      </span>
    </div>
  );
}

function match(q: string, ...parts: Array<string | number | undefined>) {
  if (!q.trim()) return true;
  const n = q.toLowerCase();
  return parts.some((p) =>
    String(p ?? "")
      .toLowerCase()
      .includes(n),
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl bg-card px-6 py-16 text-center shadow-card">
      <p className="text-meta text-muted">{text}</p>
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return (
    <div className="stagger-in mx-4 mt-4 grid gap-3 pb-24 @lg:grid-cols-2 @4xl:grid-cols-3">
      {children}
    </div>
  );
}

function ServersView() {
  const list = useAppStore((s) => s.servers);
  const filter = useAppStore((s) => s.filter);
  const query = useAppStore((s) => s.query);
  const items = list.filter((s) => {
    if (filter === "attention" && s.status === "online") return false;
    return match(query, s.name, s.label, s.host, s.os, s.region, s.tags.join(" "));
  });
  return items.length === 0 ? (
    <div className="mx-4 mt-4">
      <Empty text="没有匹配的服务器。点左下角「添加资产」录入一台。" />
    </div>
  ) : (
    <Grid>
      {items.map((s) => (
        <ServerCard key={s.id} data={s} />
      ))}
    </Grid>
  );
}

function DomainsView() {
  const list = useAppStore((s) => s.domains);
  const filter = useAppStore((s) => s.filter);
  const query = useAppStore((s) => s.query);
  const items = list.filter((s) => {
    if (filter === "attention" && s.status === "online") return false;
    return match(query, s.name, s.registrar, s.dns);
  });
  return items.length === 0 ? (
    <div className="mx-4 mt-4">
      <Empty text="没有匹配的域名。" />
    </div>
  ) : (
    <Grid>
      {items.map((s) => (
        <DomainCard key={s.id} data={s} />
      ))}
    </Grid>
  );
}

function MailView() {
  const list = useAppStore((s) => s.mailboxes);
  const filter = useAppStore((s) => s.filter);
  const query = useAppStore((s) => s.query);
  const items = list.filter((s) => {
    if (filter === "attention" && s.status === "online") return false;
    return match(query, s.address, s.domain, s.forwardTo);
  });
  return items.length === 0 ? (
    <div className="mx-4 mt-4">
      <Empty text="没有匹配的邮箱。" />
    </div>
  ) : (
    <Grid>
      {items.map((s) => (
        <MailCard key={s.id} data={s} />
      ))}
    </Grid>
  );
}

function AiView() {
  const list = useAppStore((s) => s.aiAssets);
  const filter = useAppStore((s) => s.filter);
  const query = useAppStore((s) => s.query);
  const spend = list.reduce((a, x) => a + x.monthlyUsd, 0);
  const items = list.filter((s) => {
    if (filter === "attention" && s.status === "online") return false;
    return match(query, s.name, s.provider, s.plan);
  });
  return (
    <div>
      <div className="mx-4 mt-3 rounded-xl bg-card px-4 py-3 shadow-card">
        <p className="text-2xs text-muted">本月订阅合计</p>
        <p className="text-xl font-semibold tabular-nums">
          <CountUp value={spend} format={formatUsd} />
        </p>
      </div>
      {items.length === 0 ? (
        <div className="mx-4 mt-4">
          <Empty text="没有匹配的 AI 订阅。" />
        </div>
      ) : (
        <Grid>
          {items.map((s) => (
            <AiCard key={s.id} data={s} />
          ))}
        </Grid>
      )}
    </div>
  );
}

function VaultView() {
  const list = useAppStore((s) => s.secrets);
  const filter = useAppStore((s) => s.filter);
  const query = useAppStore((s) => s.query);
  const items = list.filter((s) => {
    if (filter === "attention" && s.status === "online") return false;
    return match(query, s.name, s.kind, s.hint);
  });
  return items.length === 0 ? (
    <div className="mx-4 mt-4">
      <Empty text="没有匹配的密钥。" />
    </div>
  ) : (
    <Grid>
      {items.map((s) => (
        <SecretCard key={s.id} data={s} />
      ))}
    </Grid>
  );
}

function CertsView() {
  const list = useAppStore((s) => s.certs);
  const filter = useAppStore((s) => s.filter);
  const query = useAppStore((s) => s.query);
  const items = list.filter((s) => {
    if (filter === "attention" && s.status === "online") return false;
    return match(query, s.cn, s.issuer, s.sans.join(" "));
  });
  return items.length === 0 ? (
    <div className="mx-4 mt-4">
      <Empty text="没有匹配的证书。" />
    </div>
  ) : (
    <Grid>
      {items.map((s) => (
        <CertCard key={s.id} data={s} />
      ))}
    </Grid>
  );
}

function TerminalView() {
  const servers = useAppStore((s) => s.servers);
  const filter = useAppStore((s) => s.filter);
  const query = useAppStore((s) => s.query);
  const openSsh = useAppStore((s) => s.openSsh);
  const cpuMap = useLive((s) => s.cpu);
  const items = servers.filter((s) => {
    if (filter === "attention" && s.status === "online") return false;
    return match(query, s.name, s.host);
  });
  return (
    <div className="mx-4 mt-4 pb-24">
      <p className="mb-3 px-1 text-meta text-muted">
        选择一台在线主机，打开玻璃效果 SSH 会话。会话在浏览器内模拟，便于演练操作。
      </p>
      <div className="stagger-in grid gap-2">
        {items.map((s) => {
          const cpu = cpuMap[s.id] ?? s.cpu;
          return (
            <button
              key={s.id}
              type="button"
              disabled={s.status === "offline"}
              onClick={() => openSsh(s.id)}
              className="row-tap flex items-center gap-3 rounded-xl bg-card px-4 py-3 text-left shadow-card disabled:opacity-40 disabled:shadow-card"
            >
              <span className={dotClass(s.status)} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold tracking-tight">{s.name}</p>
                <p className="font-mono text-2xs text-muted">
                  {s.username}@{s.host}:{s.port}
                </p>
              </div>
              <span className="text-2xs tabular-nums text-subtle">CPU {cpu}%</span>
              <SquareTerminal className="size-4 text-muted" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
