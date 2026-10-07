import { usageFormFromDraft } from "@/lib/usage-setup.mjs";
import { saveAndVerifyUsageSource } from "@/lib/usage-connect.mjs";
import { t } from "@/lib/i18n";
import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2, Activity } from "lucide-react";
import { toast } from "sonner";
import { desktop } from "@/lib/desktop";
import { useAppStore } from "@/lib/store";
import { type UsageState, type UsageRecord, type LocalUsageStatus, usageBytes } from "@/lib/usage";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { UsageInsights } from "./usage-insights";
import { LocalUsagePanel } from "./local-usage-panel";

const names: Record<string, string> = {
  "3x-ui": "3x-ui 面板",
  subscription: "机场订阅",
  "openai-api": "OpenAI API",
  "anthropic-api": "Anthropic API",
  oauth: "订阅账号",
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
function amount(row: UsageRecord) {
  if (row.kind === "traffic") return `↑ ${usageBytes(row.upload)} / ↓ ${usageBytes(row.download)}`;
  if (row.kind === "tokens")
    return `输入 ${(row.input ?? 0).toLocaleString()} / 输出 ${(row.output ?? 0).toLocaleString()}`;
  return row.usedPercent == null ? "未提供百分比" : `${row.usedPercent.toFixed(1)}% 已用`;
}
export function UsageWorkspace() {
  const [data, setData] = useState<UsageState>({ sources: [], records: [] });
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localStatus, setLocalStatus] = useState<LocalUsageStatus | null>(null);
  const [localHistoryRequest, setLocalHistoryRequest] = useState(0);
  const [form, setForm] = useState(() => usageFormFromDraft(null));
  const setup = useAppStore((s) => s.usageSetupDraft);
  const [connection, setConnection] = useState<{
    id: string;
    name: string;
    verified: boolean;
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!setup) return;
    setForm(usageFormFromDraft(setup));
    setAdding(true);
    setConnection(null);
    useAppStore.getState().clearUsageSetup();
  }, [setup]);
  const servers = useAppStore((s) => s.servers);
  const load = useCallback(async () => {
    const api = desktop()?.usage;
    if (api) {
      const [usage, status] = await Promise.all([api.list(), api.localStatus()]);
      setData(usage);
      setLocalStatus(status);
      setError("");
    }
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(errorText(e)));
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load().catch((e) => setError(errorText(e)));
    }, 10000);
    return () => clearInterval(timer);
  }, [load]);
  const latest = new Map<string, UsageRecord>();
  for (const row of data.records) latest.set(row.sourceId + ":" + row.key, row);
  async function refresh(id?: string) {
    setBusy(true);
    try {
      const api = desktop()?.usage;
      if (!api) return;
      if (id) {
        if (id.startsWith("oauth:")) await desktop()!.aiAccounts.refresh(id.slice(6));
        else await api.refresh(id);
      } else {
        if (localStatus?.enabled && !localStatus.paused) await api.refreshLocal();
        const result = await api.refreshAll();
        if (result.failures.length) toast.error(result.failures.join("；"));
      }
      await load();
      if (id)
        setConnection((previous) =>
          previous?.id === id ? { ...previous, verified: true, error: "" } : previous,
        );
    } catch (e) {
      setError(errorText(e));
      if (id)
        setConnection((previous) =>
          previous?.id === id ? { ...previous, verified: false, error: errorText(e) } : previous,
        );
      await load();
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (!desktop())
    return (
      <div className="p-8">
        <h2 className="text-xl font-semibold">用量记录</h2>
        <p className="mt-3 text-sm text-muted">
          请在桌面端配置采集来源。凭据保存在本机加密密钥库中，网页预览不读取账号。
        </p>
      </div>
    );
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">流量与 AI 用量</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            按来源、日期与模型查看用量，随时展开每一条记录。API 和订阅每 5 分钟更新，本机日志约每 10
            秒检查。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw className={busy ? "animate-spin" : ""} />
            刷新全部
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setAdding(!adding);
              setForm(usageFormFromDraft(null));
            }}
          >
            <Plus />
            {t("连接用量来源")}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-crit">
          {error}
        </p>
      )}
      {connection && (
        <div
          role="status"
          className="rounded-xl border border-line bg-card p-4 text-sm"
          data-usage-connection={connection.verified ? "connected" : "saved"}
        >
          <strong>
            {connection.verified ? t("已连接并完成首次采集") : t("来源已保存，连接尚未成功")}
          </strong>
          <p className="mt-1 break-words text-muted">
            {connection.name}
            {connection.error ? `：${connection.error}` : ""}
          </p>
          {!connection.verified && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              disabled={busy}
              onClick={() => void refresh(connection.id)}
            >
              {t("重试连接")}
            </Button>
          )}
        </div>
      )}
      {adding && (
        <form
          className="usage-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const result = await saveAndVerifyUsageSource(desktop()!.usage, form);
              setConnection({
                id: result.source.id,
                name: result.source.name,
                verified: result.verified,
                error: result.error,
              });
              setAdding(false);
              setForm(usageFormFromDraft(null));
              await load();
              if (result.verified) toast.success(t("已连接并完成首次采集"));
              else toast.error(t("来源已保存，可重试连接"));
            } catch (err) {
              toast.error(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3 className="font-semibold">{t("连接用量来源")}</h3>
          <p className="text-sm text-muted">
            {t("选择来源，填写连接信息。保存后会验证一次，凭据加密保存在本机。")}
          </p>
          {form.nodeId && (
            <p className="rounded-md bg-canvas p-3 text-sm">
              {t("关联节点")}:{" "}
              {servers
                .flatMap((server) =>
                  (server.nodes ?? []).map((node) => ({
                    id: `${server.id}:${node.id}`,
                    name: `${server.name} / ${node.name}`,
                  })),
                )
                .find((node) => node.id === form.nodeId)?.name ?? t("节点已移除")}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              来源名称
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              类型
              <Select
                aria-label="来源类型"
                value={form.type}
                onValueChange={(value) => {
                  const next = usageFormFromDraft({ type: value, name: form.name });
                  if (["3x-ui", "subscription"].includes(next.type)) next.nodeId = form.nodeId;
                  setForm(next);
                }}
                options={Object.entries(names)
                  .filter(([key]) => key !== "oauth")
                  .map(([value, label]) => ({ value, label }))}
              />
            </label>
            {["3x-ui", "subscription"].includes(form.type) && (
              <label className="sm:col-span-2">
                {form.type === "3x-ui" ? "面板根地址（含自定义路径）" : "机场订阅地址"}
                <input
                  type={form.type === "subscription" ? "password" : "url"}
                  required
                  placeholder="https://…"
                  value={form.url}
                  autoComplete="off"
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                />
              </label>
            )}
            {form.type === "3x-ui" && (
              <>
                <label>
                  面板用户名
                  <input
                    required
                    value={form.username}
                    autoComplete="off"
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                  />
                </label>
                <label>
                  面板密码
                  <input
                    type="password"
                    required
                    value={form.password}
                    autoComplete="new-password"
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                </label>
                <details className="sm:col-span-2 rounded-md border border-line p-3">
                  <summary className="cursor-pointer text-sm">{t("高级筛选（可选）")}</summary>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <label>
                      入站 ID（可选）
                      <input
                        value={form.inboundId}
                        onChange={(e) => setForm({ ...form, inboundId: e.target.value })}
                      />
                    </label>
                    <label>
                      客户端 Email（可选，精确匹配）
                      <input
                        value={form.clientEmail}
                        onChange={(e) => setForm({ ...form, clientEmail: e.target.value })}
                      />
                    </label>
                  </div>
                </details>
              </>
            )}
            {form.type.endsWith("-api") && (
              <label className="sm:col-span-2">
                组织 Admin Key
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                />
                <span className="text-xs text-muted">
                  读取该组织最近 30 天全部 API Key 的用量；普通推理 Key
                  往往没有权限。同一组织只添加一次，避免重复汇总。第三方中转暂不支持。
                </span>
              </label>
            )}
            {["3x-ui", "subscription"].includes(form.type) && (
              <label className="sm:col-span-2">
                关联节点（可选，仅标记归属，不代表该节点独占用量）
                <Select
                  aria-label="关联节点"
                  value={form.nodeId}
                  onValueChange={(value) => setForm({ ...form, nodeId: value })}
                  options={[
                    { value: "", label: "不关联" },
                    ...servers.flatMap((s) =>
                      (s.nodes ?? []).map((n) => ({
                        value: s.id + ":" + n.id,
                        label: `${s.name} / ${n.name}`,
                      })),
                    ),
                  ]}
                />
              </label>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? t("正在保存并验证…") : t("保存并验证连接")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setForm(usageFormFromDraft(null));
              }}
            >
              取消
            </Button>
          </div>
        </form>
      )}
      <LocalUsagePanel
        status={localStatus}
        onChange={load}
        onViewHistory={() => setLocalHistoryRequest((value) => value + 1)}
      />
      <UsageInsights data={data} localHistoryRequest={localHistoryRequest} />
      <details className="rounded-xl border border-line bg-card p-4 text-sm leading-relaxed">
        <summary className="cursor-pointer font-semibold">订阅额度与账号授权</summary>
        <strong>ChatGPT / Codex · Claude 订阅账号</strong>
        <p className="mt-1 text-muted">
          在「AI 订阅」中授权账号，刷新额度时自动记录历史。Codex 额度不代表 ChatGPT
          网页全部用量；Claude 若只返回使用百分比，就保留额度快照，不换算成 Token。订阅与 API
          账单分开统计。
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => useAppStore.getState().setView("ai")}
        >
          管理 AI 账号 →
        </Button>
      </details>
      <h3 className="font-semibold">已连接的采集来源</h3>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.sources
          .filter((source) => !source.type.startsWith("local-"))
          .map((source) => {
            const rows = [...latest.values()].filter((r) => r.sourceId === source.id);
            return (
              <section className="rounded-xl border border-line bg-card p-5" key={source.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{source.name}</h3>
                    <p className="mt-1 text-xs text-muted">
                      {names[source.type]} ·{" "}
                      {source.error
                        ? t("连接需要处理")
                        : source.checkedAt
                          ? t("已连接")
                          : t("已保存，尚未连接")}{" "}
                      ·{" "}
                      {source.checkedAt ? new Date(source.checkedAt).toLocaleString() : "尚未采集"}
                    </p>
                    {source.nodeId && (
                      <p className="mt-1 text-xs text-muted">
                        关联：
                        {servers
                          .flatMap((s) =>
                            (s.nodes ?? []).map((n) => ({ id: s.id + ":" + n.id, name: n.name })),
                          )
                          .find((n) => n.id === source.nodeId)?.name ?? "节点已移除"}
                      </p>
                    )}
                  </div>
                  <div className="flex">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={"刷新 " + source.name}
                      disabled={busy}
                      onClick={() => void refresh(source.id)}
                    >
                      <RefreshCw />
                    </Button>
                    {source.type !== "oauth" && (
                      <Button
                        size="icon-sm"
                        variant="danger-ghost"
                        aria-label={"移除 " + source.name}
                        onClick={async () => {
                          if (window.confirm("移除采集来源？已记录历史会保留。"))
                            try {
                              await desktop()!.usage.remove(source.id);
                              await load();
                            } catch (e) {
                              toast.error(errorText(e));
                            }
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </div>
                {source.error && (
                  <p className="mt-3 text-sm text-crit">
                    采集失败，以下保留上次数据：{source.error}
                  </p>
                )}
                <div className="mt-4 space-y-3">
                  {rows.slice(-4).map((row) => (
                    <div key={row.key} className="text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="truncate text-muted">
                          {row.kind === "tokens" ? row.bucketStart?.slice(0, 10) : row.label}
                        </span>
                        <span className="text-right tabular-nums">{amount(row)}</span>
                      </div>
                      {row.kind === "traffic" && (
                        <p className="mt-1 text-xs text-muted">
                          额度：{row.total === 0 ? "不限额" : usageBytes(row.total)} · 到期：
                          {row.expiresAt ? new Date(row.expiresAt).toLocaleDateString() : "未提供"}
                          {row.counterReset ? " · 累计计数重置，未跨周期计算增量" : ""}
                        </p>
                      )}
                      {row.kind === "quota" && (
                        <p className="mt-1 text-xs text-muted">
                          范围：{row.scope} · 重置：
                          {row.resetsAt ? new Date(row.resetsAt).toLocaleString() : "未提供"}
                        </p>
                      )}
                    </div>
                  ))}
                  {!rows.length && (
                    <p className="text-sm text-muted">尚无有效用量记录，点击刷新开始采集。</p>
                  )}
                </div>
              </section>
            );
          })}
      </div>
      {!data.sources.length && (
        <div className="rounded-xl border border-dashed border-line p-8 text-center">
          <Activity className="mx-auto mb-3 size-8 text-muted" />
          <h3 className="font-semibold">添加第一个用量来源</h3>
          <p className="mt-2 text-sm text-muted">3x-ui、机场和 API 的记录会集中在这里。</p>
        </div>
      )}
    </div>
  );
}
