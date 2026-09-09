import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  AlertTriangle,
  Check,
  Search,
  SquareTerminal,
  X,
  LayoutGrid,
  Table2,
  Network,
} from "lucide-react";
import { AssetWorkspace } from "./asset-workspace";
import { AssetOrganizer } from "./asset-organizer";
import { MailWorkspace } from "./mail-workspace";
import { useSettings } from "@/lib/settings";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { AiCard, CertCard, DomainCard, MailCard, SecretCard, ServerCard } from "./asset-card";
import { AgentView } from "./agent-view";
import { LogoMark } from "./logo";
import { GroupHeading, TagBar } from "./tag-bar";
import { RefreshAllButton } from "./refresh-button";
import { useAlerts } from "./right-rail";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { CountUp, TimeAgo } from "./ui/time-ago";
import { isDesktop } from "@/lib/desktop";
import { useLive } from "@/lib/live";
import type { ProbeKind } from "@/lib/probes";
import {
  attentionOf,
  chipClass,
  dotClass,
  healthScore,
  KIND_LABEL,
  STATUS_LABEL,
} from "@/lib/status";
import { useAppStore } from "@/lib/store";
import { groupByTag, matchesTags, tagIndex, tagsOf } from "@/lib/tags";
import type { AssetKind, Status, Taggable, ViewId } from "@/lib/types";
import { cn, formatUsd } from "@/lib/utils";
import { t, getLocale } from "@/lib/i18n";

export function MainView() {
  const view = useAppStore((s) => s.view);
  const filter = useAppStore((s) => s.filter);
  // Re-keying replays the entrance, so switching views reads as a change of
  // place rather than a silent content swap.
  return (
    <div
      key={`${view}:${filter}`}
      className={cn("view-in", view === "agent" && "flex min-h-[calc(100dvh-13rem)] flex-col")}
    >
      <ViewBody />
    </div>
  );
}

function ViewBody() {
  const view = useAppStore((s) => s.view);
  const layout = useSettings((s) => s.assetLayout);
  const hydrated = useAppStore((s) => s.hydrated);
  if (view === "mail") return <MailWorkspace />;
  if (hydrated && view !== "agent" && view !== "terminal" && layout !== "cards")
    return <AssetWorkspace />;
  switch (view) {
    case "overview":
      return <Overview />;
    case "servers":
      return <ServersView />;
    case "domains":
      return <DomainsView />;
    case "ai":
      return <AiView />;
    case "vault":
      return <VaultView />;
    case "certs":
      return <CertsView />;
    case "tags":
      return <TagsView />;
    case "agent":
      return <AgentView />;
    case "terminal":
      return <TerminalView />;
  }
}

export function TopTabs() {
  const view = useAppStore((s) => s.view);
  // Everything in this header narrows a list; the agent has no list.
  if (view === "agent") return null;
  return <ListHeader />;
}

function ListHeader() {
  const locale = getLocale();
  const view = useAppStore((s) => s.view);
  const filter = useAppStore((s) => s.filter);
  const setFilter = useAppStore((s) => s.setFilter);
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const setCommandOpen = useAppStore((s) => s.setCommandOpen);
  const title = TITLE[view];
  const layout = useSettings((s) => s.assetLayout);
  const setLayout = useSettings((s) => s.setAssetLayout);
  const hydrated = useAppStore((s) => s.hydrated);
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
  }, [filter, view, locale]);

  return (
    <div className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div ref={bar} className="relative flex h-14 items-stretch">
        <Tab active={filter === "all"} onClick={() => setFilter("all")}>
          {t(title.all)}
        </Tab>
        <Tab active={filter === "attention"} onClick={() => setFilter("attention")}>
          {t(title.attention)}
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
      <div className="flex items-center gap-2 px-4 pb-2 pt-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("筛选当前列表")}
            className="h-9 bg-card pl-9"
          />
        </div>
        <RefreshAllButton kind={PROBE_KIND[view]} />
        <Button
          variant="outline"
          size="sm"
          className="xl:hidden"
          onClick={() => setCommandOpen(true)}
        >
          ⌘K
        </Button>
      </div>
      {view !== "terminal" && view !== "mail" && (
        <div className="layout-switch" role="group" aria-label={t("显示方式")}>
          {(
            [
              { mode: "cards", label: "卡片视图", Icon: LayoutGrid },
              { mode: "table", label: "表格视图", Icon: Table2 },
              { mode: "graph", label: "关系图", Icon: Network },
            ] as const
          ).map(({ mode, label, Icon }) => (
            <button
              key={mode}
              type="button"
              aria-label={t(label)}
              title={t(label)}
              aria-pressed={(hydrated ? layout : "cards") === mode}
              onClick={() => setLayout(mode)}
            >
              <Icon className="size-4" />
            </button>
          ))}
          <AssetOrganizer />
        </div>
      )}
      <TagBar />
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
      <span data-label className={cn("inline-flex items-center px-1 py-4", active && "font-bold")}>
        {children}
      </span>
    </button>
  );
}

/** Which live probe the refresh button in this view should run. */
const PROBE_KIND: Record<ViewId, ProbeKind | null> = {
  overview: "server",
  servers: "server",
  domains: "domain",
  mail: null,
  ai: null,
  vault: null,
  certs: "cert",
  tags: null,
  agent: null,
  terminal: "server",
};

const BADGE_KEY: Record<ViewId, keyof ReturnType<typeof attentionOf>> = {
  overview: "total",
  servers: "servers",
  domains: "domains",
  mail: "mail",
  ai: "ai",
  vault: "vault",
  certs: "certs",
  tags: "total",
  agent: "total",
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
  tags: { all: "全部分组", attention: "需处理" },
  agent: { all: "问答", attention: "需处理" },
  terminal: { all: "会话", attention: "离线主机" },
};

function TipBanner() {
  return (
    <div className="mx-4 mt-3 rounded-xl bg-banner px-4 py-3 text-meta text-ink shadow-card">
      <p className="mb-1.5 text-2xs font-semibold tracking-wide text-muted">{t("重点提示")}</p>
      <ul className="space-y-1">
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 size-3.5 shrink-0 text-ok" strokeWidth={2.4} />

          {t("黄色 = 到期 / 高负载 / 用量；红色 = 离线或不足 7 天。")}
        </li>
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 size-3.5 shrink-0 text-ok" strokeWidth={2.4} />

          {t("点开白色卡片放大详情；服务器可开玻璃 SSH 终端")}
          {isDesktop() ? t("（真实连接）。") : t("（浏览器内模拟）。")}
        </li>
      </ul>
    </div>
  );
}

/** Nothing recorded yet — say what this thing is and what to do first. */
function FirstRun() {
  const openComposer = useAppStore((s) => s.openComposer);
  return (
    <div className="stagger-in mx-4 mb-24 mt-6 space-y-4">
      <section className="rounded-2xl bg-card p-6 shadow-card">
        <LogoMark className="size-10" />
        <h2 className="mt-4 text-xl font-semibold tracking-tight">{t("开始记录你的资产")}</h2>
        <p className="mt-2 max-w-prose text-meta leading-relaxed text-muted">
          {t(
            "司南把服务器、域名、邮箱、AI 订阅、密钥和证书收在一块盘面上，替你盯住到期和异常。\r\n          录入之后，主机指标通过 SSH 实时采集，域名走 WHOIS，证书直接握手读取——都是真实数据。",
          )}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => openComposer("server")}>{t("添加第一台主机")}</Button>
          <Button variant="outline" onClick={() => openComposer("domain")}>
            {t("添加域名")}
          </Button>
          <Button variant="outline" onClick={() => openComposer("cert")}>
            {t("添加证书")}
          </Button>
        </div>
      </section>

      <section className="rounded-xl bg-banner px-5 py-4 text-meta leading-relaxed text-muted">
        <p className="mb-2 text-2xs font-semibold tracking-wide text-muted">
          {t("几件值得先知道的事")}
        </p>
        <ul className="space-y-1.5">
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-ok" strokeWidth={2.4} />

            {t("SSH 密码和私钥存在本机加密的密钥库里，第一次保存时会让你设一个主密码。")}
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-ok" strokeWidth={2.4} />

            {t("资产写在本机的数据文件中，随时可以导出成 JSON；凭据不会跟着导出。")}
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-ok" strokeWidth={2.4} />

            {t("⌘K 全局搜索，⌘N 新建，点开卡片看详情，主机可以直接开真实 SSH 会话。")}
          </li>
        </ul>
      </section>
    </div>
  );
}

function Overview() {
  const servers = useAppStore((s) => s.servers);
  const aiAssets = useAppStore((s) => s.aiAssets);
  const activity = useAppStore((s) => s.activity);
  const filter = useAppStore((s) => s.filter);
  const empty = useAppStore(
    (s) =>
      s.servers.length +
        s.domains.length +
        s.mailboxes.length +
        s.aiAssets.length +
        s.secrets.length +
        s.certs.length ===
      0,
  );
  const score = useAppStore(healthScore);
  const att = useAppStore(useShallow(attentionOf));
  const alerts = useAlerts();
  const spend = aiAssets.reduce((a, x) => a + x.monthlyUsd, 0);
  const online = servers.filter((s) => s.status === "online").length;

  const spendSeries = [
    { m: t("4月"), v: Math.round(spend * 0.72) },
    { m: t("5月"), v: Math.round(spend * 0.8) },
    { m: t("6月"), v: Math.round(spend * 0.86) },
    { m: t("7月"), v: Math.round(spend * 0.9) },
    { m: t("8月"), v: Math.round(spend * 0.96) },
    { m: t("9月"), v: spend },
  ];

  if (empty) return <FirstRun />;

  if (filter === "attention") {
    return (
      <div>
        <TipBanner />
        <section className="stagger-in mx-4 mt-4 space-y-2 pb-24">
          {alerts.length === 0 ? (
            <Empty text={t("目前没有需要处理的项目。")} />
          ) : (
            alerts.map((a) => (
              <AlertRow key={a.id} title={a.title} detail={a.detail} status={a.status} />
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
          label={t("健康分")}
          value={<CountUp value={score} />}
          hint={score >= 80 ? t("运转良好") : t("有事项待处理")}
          tone={score >= 80 ? "online" : score >= 60 ? "warning" : "offline"}
        />
        <Stat
          label={t("主机在线")}
          value={
            <>
              <CountUp value={online} />/{servers.length}
            </>
          }
          hint={t("{0} 台异常", att.servers)}
          tone={att.servers ? "warning" : "online"}
        />
        <Stat
          label={t("AI 月费")}
          value={<CountUp value={spend} format={formatUsd} />}
          hint={t("{0} 个订阅", aiAssets.length)}
          tone="online"
        />
        <Stat
          label={t("待处理")}
          value={<CountUp value={att.total} />}
          hint={t("证书 / 域名 / 负载")}
          tone={att.total ? "warning" : "online"}
        />
      </section>

      <section className="mx-4 mt-4 rounded-xl bg-card p-4 shadow-card">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-semibold tracking-tight">{t("AI 支出趋势")}</h2>
          <span className="text-2xs text-subtle">{t("近 6 个月 · 美元")}</span>
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
                formatter={(v) => [formatUsd(Number(v)), t("支出")]}
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
          <h2 className="mb-2 px-1 text-meta font-medium text-muted">{t("需要留意")}</h2>
          <div className="space-y-2">
            {alerts.slice(0, 4).map((a) => (
              <AlertRow key={a.id} title={a.title} detail={a.detail} status={a.status} />
            ))}
          </div>
        </section>
      )}

      <section className="mx-4 mt-4 rounded-xl bg-card p-4 shadow-card xl:hidden">
        <h2 className="mb-3 font-semibold tracking-tight">{t("最近动态")}</h2>
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
        <h2 className="mb-2 px-1 text-meta font-medium text-muted">{t("主机")}</h2>
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

function AlertRow({ title, detail, status }: { title: string; detail: string; status: Status }) {
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
        {t(STATUS_LABEL[status])}
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

const GRID = "grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3";

/**
 * One list, two layouts.
 *
 * Flat is a plain grid. Grouped splits into one section per tag — an asset with
 * three tags shows up in all three, because tags are labels rather than
 * folders, and anything untagged collects in a trailing section.
 */
function AssetList<T extends { id: string } & Partial<Taggable>>({
  items,
  empty,
  render,
}: {
  items: T[];
  empty: string;
  render: (item: T) => ReactNode;
}) {
  const grouped = useAppStore((s) => s.groupByTag);

  if (items.length === 0) {
    return (
      <div className="mx-4 mt-4">
        <Empty text={empty} />
      </div>
    );
  }

  if (!grouped) {
    return <div className={cn("stagger-in mx-4 mt-4 pb-24", GRID)}>{items.map(render)}</div>;
  }

  return (
    <div className="mx-4 mt-4 space-y-6 pb-24">
      {groupByTag(items).map((group) => (
        <section key={group.tag} className={cn("stagger-in", GRID)}>
          <GroupHeading label={group.label} count={group.items.length} />
          {group.items.map(render)}
        </section>
      ))}
    </div>
  );
}

/** Shared narrowing: attention tab, tag selection, then the text filter. */
function useListFilter<T extends { status: Status } & Partial<Taggable>>(
  list: T[],
  text: (item: T) => Array<string | number | undefined>,
): T[] {
  const filter = useAppStore((s) => s.filter);
  const query = useAppStore((s) => s.query);
  const tagFilter = useAppStore((s) => s.tagFilter);
  return list.filter((item) => {
    if (filter === "attention" && item.status === "online") return false;
    if (!matchesTags(item, tagFilter)) return false;
    return match(query, ...text(item));
  });
}

function ServersView() {
  const list = useAppStore((s) => s.servers);
  const items = useListFilter(list, (s) => [
    s.name,
    s.label,
    s.host,
    s.os,
    s.region,
    tagsOf(s).join(" "),
  ]);
  return (
    <AssetList
      items={items}
      empty={t("没有匹配的服务器。点左下角「添加资产」录入一台。")}
      render={(s) => <ServerCard key={s.id} data={s} />}
    />
  );
}

function DomainsView() {
  const list = useAppStore((s) => s.domains);
  const items = useListFilter(list, (s) => [s.name, s.registrar, s.dns, tagsOf(s).join(" ")]);
  return (
    <AssetList
      items={items}
      empty={t("没有匹配的域名。")}
      render={(s) => <DomainCard key={s.id} data={s} />}
    />
  );
}

function AiView() {
  const list = useAppStore((s) => s.aiAssets);
  const spend = list.reduce((a, x) => a + x.monthlyUsd, 0);
  const missingPrice = list.filter((item) => item.monthlyUsdKnown === false).length;
  const items = useListFilter(list, (s) => [s.name, s.provider, s.plan, tagsOf(s).join(" ")]);
  return (
    <div>
      <div className="mx-4 mt-3 rounded-xl bg-card px-4 py-3 shadow-card">
        <p className="text-2xs text-muted">{t("本月订阅合计")}</p>
        <p className="text-xl font-semibold tabular-nums">
          <CountUp value={spend} format={formatUsd} />
        </p>
        {missingPrice > 0 && (
          <p className="mt-1 text-2xs text-muted">{t("另有 {0} 个订阅未提供月费", missingPrice)}</p>
        )}
      </div>
      <AssetList
        items={items}
        empty={t("没有匹配的 AI 订阅。")}
        render={(s) => <AiCard key={s.id} data={s} />}
      />
    </div>
  );
}

function VaultView() {
  const list = useAppStore((s) => s.secrets);
  const items = useListFilter(list, (s) => [s.name, s.kind, s.hint, tagsOf(s).join(" ")]);
  return (
    <AssetList
      items={items}
      empty={t("没有匹配的密钥。")}
      render={(s) => <SecretCard key={s.id} data={s} />}
    />
  );
}

function CertsView() {
  const list = useAppStore((s) => s.certs);
  const items = useListFilter(list, (s) => [s.cn, s.issuer, s.sans.join(" "), tagsOf(s).join(" ")]);
  return (
    <AssetList
      items={items}
      empty={t("没有匹配的证书。")}
      render={(s) => <CertCard key={s.id} data={s} />}
    />
  );
}

/**
 * The cross-kind lens on tags.
 *
 * Every other view is one collection; this one is one *label* across all six,
 * which is the whole reason tags are shared rather than per-kind. With nothing
 * selected it lists the tags themselves with a per-kind breakdown; pick one and
 * it turns into that tag's assets, sectioned by kind.
 */
function TagsView() {
  const servers = useAppStore((s) => s.servers);
  const domains = useAppStore((s) => s.domains);
  const mailboxes = useAppStore((s) => s.mailboxes);
  const aiAssets = useAppStore((s) => s.aiAssets);
  const secrets = useAppStore((s) => s.secrets);
  const certs = useAppStore((s) => s.certs);
  const selected = useAppStore((s) => s.tagFilter);
  const query = useAppStore((s) => s.query);
  const filter = useAppStore((s) => s.filter);
  const toggleTag = useAppStore((s) => s.toggleTag);
  const clearTags = useAppStore((s) => s.clearTags);

  // On the 需处理 tab this becomes "which groups have something wrong in them",
  // which is the question worth asking of a group.
  const scope = useMemo(() => {
    const only = <T extends { status: Status }>(items: T[]) =>
      filter === "attention" ? items.filter((x) => x.status !== "online") : items;
    return {
      servers: only(servers),
      domains: only(domains),
      mailboxes: only(mailboxes),
      aiAssets: only(aiAssets),
      secrets: only(secrets),
      certs: only(certs),
    };
  }, [filter, servers, domains, mailboxes, aiAssets, secrets, certs]);

  // Derived in a memo, not in a selector: a selector runs on every store read
  // and a fresh array never compares equal.
  const index = useMemo(() => tagIndex(scope), [scope]);

  if (index.length === 0) {
    return (
      <div className="mx-4 mt-4">
        <Empty
          text={
            filter === "attention"
              ? t("没有哪个分组里有待处理的资产。")
              : t("还没有任何标签。在资产的「标签」字段里填几个，就能跨类别分组了。")
          }
        />
      </div>
    );
  }

  if (selected.length === 0) {
    const visible = index.filter((entry) => match(query, entry.tag));
    return visible.length === 0 ? (
      <div className="mx-4 mt-4">
        <Empty text={t("没有匹配的标签。")} />
      </div>
    ) : (
      <div className={cn("stagger-in mx-4 mt-4 pb-24", GRID)}>
        {visible.map((entry) => (
          <button
            key={entry.tag}
            type="button"
            className="card-tap rounded-xl bg-card p-4 text-left shadow-card"
            onClick={() => toggleTag(entry.tag)}
          >
            <div className="flex items-baseline gap-2">
              <h3 className="truncate text-lg font-semibold tracking-tight">{entry.tag}</h3>
              <span className="ml-auto text-2xl font-semibold tabular-nums">{entry.total}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {entry.byKind.map(({ kind, count }) => (
                <span key={kind} className="chip chip-mute">
                  {t(KIND_LABEL[kind])} {count}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    );
  }

  const keep = <T extends { tags?: string[] }>(items: T[]) =>
    items.filter((x) => matchesTags(x, selected));

  const sections: Array<{ kind: AssetKind; items: ReactNode[] }> = (
    [
      { kind: "server", items: keep(scope.servers).map((s) => <ServerCard key={s.id} data={s} />) },
      { kind: "domain", items: keep(scope.domains).map((s) => <DomainCard key={s.id} data={s} />) },
      { kind: "mail", items: keep(scope.mailboxes).map((s) => <MailCard key={s.id} data={s} />) },
      { kind: "ai", items: keep(scope.aiAssets).map((s) => <AiCard key={s.id} data={s} />) },
      { kind: "secret", items: keep(scope.secrets).map((s) => <SecretCard key={s.id} data={s} />) },
      { kind: "cert", items: keep(scope.certs).map((s) => <CertCard key={s.id} data={s} />) },
    ] as Array<{ kind: AssetKind; items: ReactNode[] }>
  ).filter((section) => section.items.length > 0);

  if (sections.length === 0) {
    return (
      <div className="mx-4 mt-4">
        <Empty text={t("没有同时带上这些标签的资产。")} />
      </div>
    );
  }

  return (
    <div className="mx-4 mt-4 space-y-6 pb-24">
      {/* Which group you are inside, and the way back out. The shared tag
          strip cannot do this job here: it counts one collection, and this
          view spans all six. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs text-subtle">{t("当前分组")}</span>
        {selected.map((tag) => (
          <button
            key={tag}
            type="button"
            className="tag-chip tag-chip-on"
            title={t("从筛选中移除")}
            onClick={() => toggleTag(tag)}
          >
            {tag}
            <X className="size-3" />
          </button>
        ))}
        <button type="button" className="tag-chip tag-chip-clear" onClick={clearTags}>
          {t("返回全部分组")}
        </button>
      </div>

      {sections.map((section) => (
        <section key={section.kind} className={cn("stagger-in", GRID)}>
          <GroupHeading label={t(KIND_LABEL[section.kind])} count={section.items.length} />
          {section.items}
        </section>
      ))}
    </div>
  );
}

function TerminalView() {
  const list = useAppStore((s) => s.servers);
  const openSsh = useAppStore((s) => s.openSsh);
  const cpuMap = useLive((s) => s.cpu);
  const items = useListFilter(list, (s) => [s.name, s.host, tagsOf(s).join(" ")]);

  return (
    <div className="mx-4 mt-4 pb-24">
      <p className="mb-3 px-1 text-meta text-muted">
        {isDesktop()
          ? t("选择一台主机，打开真实 SSH 会话。需要先在密钥库中保存该主机的凭据。")
          : t(
              "选择一台在线主机，打开玻璃效果 SSH 会话。浏览器里的会话是模拟的，桌面版才会真正连出网络。",
            )}
      </p>
      {items.length === 0 ? (
        <Empty text={t("没有匹配的主机。")} />
      ) : (
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
                {tagsOf(s)
                  .slice(0, 2)
                  .map((t) => (
                    <span key={t} className="chip chip-mute">
                      {t}
                    </span>
                  ))}
                <span className="text-2xs tabular-nums text-subtle">CPU {cpu}%</span>
                <SquareTerminal className="size-4 text-muted" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
