import { subscriptionCost } from "@/lib/subscription-cost";
import { useMemo } from "react";
import {
  ArrowUpRight,
  Plus,
  Server,
  Globe,
  Radio,
  Bot,
  ShieldCheck,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useShallow } from "zustand/react/shallow";
import { attentionOf, STATUS_LABEL, chipClass } from "@/lib/status";
import { t } from "@/lib/i18n";
import type { ViewId } from "@/lib/types";
import { Button } from "./ui/button";
import { TimeAgo } from "./ui/time-ago";

export function Overview() {
  const servers = useAppStore((s) => s.servers);
  const domains = useAppStore((s) => s.domains);
  const aiAssets = useAppStore((s) => s.aiAssets);
  const activity = useAppStore((s) => s.activity);
  const counts = useAppStore(useShallow(attentionOf));
  const setView = useAppStore((s) => s.setView);
  const openComposer = useAppStore((s) => s.openComposer);
  const nodes = useMemo(() => servers.flatMap((server) => server.nodes ?? []), [servers]);
  const monthly = useMemo(() => subscriptionCost(aiAssets), [aiAssets]);
  const stats: {
    label: string;
    value: number | string;
    detail: string;
    icon: LucideIcon;
    view: ViewId;
  }[] = [
    {
      label: "服务器",
      value: servers.length,
      detail: t("{0} 台状态正常", servers.filter((s) => s.status === "online").length),
      icon: Server,
      view: "servers",
    },
    {
      label: "域名",
      value: domains.length,
      detail: t("{0} 项需要留意", counts.domains),
      icon: Globe,
      view: "domains",
    },
    {
      label: "自建节点",
      value: nodes.length,
      detail: nodes.length ? t("查看节点配置") : t("尚未添加节点"),
      icon: Radio,
      view: "nodes",
    },
    {
      label: "AI 月度订阅",
      value:
        monthly.known === 0 && monthly.missing > 0
          ? t("月费未填写")
          : "$" + monthly.total.toFixed(2),
      detail: monthly.missing
        ? t("另有 {0} 个订阅未提供月费", monthly.missing)
        : t("{0} 项订阅", aiAssets.length),
      icon: Bot,
      view: "ai",
    },
  ];
  return (
    <div className="overview-layout">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{t("你的数字工作空间")}</h2>
          <p className="mt-2 text-sm text-muted">{t("集中管理资产，快速找到需要处理的事项。")}</p>
        </div>
        <Button onClick={() => openComposer("server")}>
          <Plus className="size-4" />
          {t(
            servers.length + domains.length + aiAssets.length === 0 ? "添加第一台主机" : "添加资产",
          )}
        </Button>
      </section>
      <section className="overview-stats" aria-label={t("资产摘要")}>
        {stats.map(({ label, value, detail, icon: Icon, view }) => (
          <button type="button" key={view} className="summary-tile" onClick={() => setView(view)}>
            <span className="flex items-center justify-between gap-3 text-sm text-muted">
              <span>{t(label)}</span>
              <Icon className="size-4" />
            </span>
            <strong className="mt-4 block text-3xl font-semibold tabular-nums tracking-tight">
              {value}
            </strong>
            <span className="mt-2 block text-sm text-muted">{detail}</span>
          </button>
        ))}
      </section>
      {counts.total > 0 && (
        <section className="workspace-panel" aria-label={t("待处理事项")}>
          <div className="panel-heading">
            <h2>{t("待处理事项")}</h2>
            <span className="text-sm text-muted">{t("点击分类查看异常资产")}</span>
          </div>
          <div className="flex flex-wrap gap-2 p-4">
            {(
              [
                ["servers", "服务器", counts.servers],
                ["domains", "域名", counts.domains],
                ["mail", "邮箱", counts.mail],
                ["ai", "AI 订阅", counts.ai],
                ["vault", "密钥库", counts.vault],
                ["certs", "安全证书", counts.certs],
              ] as const
            )
              .filter(([, , count]) => count > 0)
              .map(([view, label, count]) => (
                <Button key={view} variant="outline" onClick={() => setView(view)}>
                  {t(label)} · {t("{0} 项需要留意", count)} <ArrowUpRight className="size-4" />
                </Button>
              ))}
          </div>
        </section>
      )}
      <div className="overview-columns">
        <section className="workspace-panel">
          <div className="panel-heading">
            <h2>{t("服务器")}</h2>
            <button
              type="button"
              className="text-sm text-muted hover:text-ink"
              onClick={() => setView("servers")}
            >
              {t("查看全部")} <ArrowUpRight className="inline size-4" />
            </button>
          </div>
          {servers.length ? (
            <div className="divide-y divide-line">
              {servers.slice(0, 5).map((server) => (
                <button
                  type="button"
                  key={server.id}
                  className="asset-summary-row"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    useAppStore.getState().setExpanded({
                      kind: "server",
                      id: server.id,
                      origin: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
                    });
                  }}
                >
                  <span className="asset-summary-icon">
                    <Server className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{server.name}</span>
                    <span className="mt-1 block truncate text-sm text-muted">{server.host}</span>
                  </span>
                  <span className={chipClass(server.status)}>{t(STATUS_LABEL[server.status])}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="workspace-empty">
              <Server className="mx-auto mb-3 size-6" />
              <p>{t("尚未添加服务器")}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => openComposer("server")}
              >
                {t("添加服务器")}
              </Button>
            </div>
          )}
        </section>
        <section className="workspace-panel">
          <div className="panel-heading">
            <h2>{t("常用操作")}</h2>
            <span className="text-sm text-muted">{t("{0} 项需要留意", counts.total)}</span>
          </div>
          <div className="space-y-1 p-2">
            {(
              [
                { view: "nodes", label: "管理自建节点", detail: "配置节点与导出订阅", icon: Radio },
                {
                  view: "terminal",
                  label: "打开终端",
                  detail: "连接服务器并管理会话",
                  icon: SquareTerminal,
                },
                {
                  view: "vault",
                  label: "管理密钥",
                  detail: "查看凭据与安全状态",
                  icon: ShieldCheck,
                },
                { view: "ai", label: "查看 AI 订阅", detail: "管理订阅与月度开支", icon: Bot },
              ] as const
            ).map(({ view, label, detail, icon: Icon }) => (
              <button
                type="button"
                key={view}
                onClick={() => setView(view)}
                className="quick-action"
              >
                <Icon className="size-5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t(label)}</span>
                  <span className="mt-1 block text-sm text-muted">{t(detail)}</span>
                </span>
                <ArrowUpRight className="size-4 text-muted" />
              </button>
            ))}
          </div>
        </section>
      </div>
      <section className="workspace-panel">
        <div className="panel-heading">
          <h2>{t("最近动态")}</h2>
        </div>
        {activity.length ? (
          <ul className="divide-y divide-line">
            {activity.slice(0, 5).map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-2 px-5 py-4"
              >
                <p className="min-w-0 text-sm break-words">{item.text}</p>
                <TimeAgo iso={item.at} className="shrink-0 text-xs text-muted" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-muted">{t("暂无动态，添加资产后会在这里记录。")}</p>
        )}
      </section>
    </div>
  );
}
