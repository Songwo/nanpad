import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Download, Trash2, Activity } from "lucide-react";
import { toast } from "sonner";
import { desktop } from "@/lib/desktop";
import { useAppStore } from "@/lib/store";
import { type UsageState, type UsageRecord, usageBytes } from "@/lib/usage";
import { Button } from "./ui/button";
import { downloadJson } from "@/lib/utils";

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
  const [sourceId, setSourceId] = useState("all");
  const [kind, setKind] = useState("all");
  const [period, setPeriod] = useState("30");
  const [form, setForm] = useState<Record<string, string>>({
    name: "",
    type: "3x-ui",
    url: "",
    username: "",
    password: "",
    apiKey: "",
    inboundId: "",
    clientEmail: "",
    nodeId: "",
  });
  const servers = useAppStore((s) => s.servers);
  const load = useCallback(async () => {
    const api = desktop()?.usage;
    if (api) {
      setData(await api.list());
      setError("");
    }
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(errorText(e)));
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load().catch((e) => setError(errorText(e)));
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);
  const records = useMemo(
    () =>
      data.records
        .filter(
          (r) =>
            (sourceId === "all" || r.sourceId === sourceId) &&
            (kind === "all" || r.kind === kind) &&
            (period === "all" ||
              Date.parse(r.bucketStart ?? r.checkedAt) >= Date.now() - Number(period) * 86400000),
        )
        .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)),
    [data, sourceId, kind, period],
  );
  const totals = records
    .filter((r) => r.kind === "tokens")
    .reduce((a, r) => ({ input: a.input + (r.input ?? 0), output: a.output + (r.output ?? 0) }), {
      input: 0,
      output: 0,
    });
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
        const result = await api.refreshAll();
        if (result.failures.length) toast.error(result.failures.join("；"));
      }
      await load();
    } catch (e) {
      setError(errorText(e));
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
            保留每次流量和订阅额度快照，API 按日期更新真实 Token。应用打开且密钥库解锁时每 5
            分钟采集；首次开启前的流量无法补算。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw className={busy ? "animate-spin" : ""} />
            刷新全部
          </Button>
          <Button onClick={() => setAdding(!adding)}>
            <Plus />
            添加来源
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-crit">
          {error}
        </p>
      )}
      {adding && (
        <form
          className="usage-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await desktop()!.usage.add(form);
              setAdding(false);
              setForm({
                name: "",
                type: "3x-ui",
                url: "",
                username: "",
                password: "",
                apiKey: "",
                inboundId: "",
                clientEmail: "",
                nodeId: "",
              });
              await load();
              toast.success("来源已保存，请刷新采集");
            } catch (err) {
              toast.error(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3 className="font-semibold">连接用量来源</h3>
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
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {Object.entries(names)
                  .filter(([key]) => key !== "oauth")
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
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
                <select
                  value={form.nodeId}
                  onChange={(e) => setForm({ ...form, nodeId: e.target.value })}
                >
                  <option value="">不关联</option>
                  {servers.flatMap((s) =>
                    (s.nodes ?? []).map((n) => (
                      <option key={s.id + ":" + n.id} value={s.id + ":" + n.id}>
                        {s.name} / {n.name}
                      </option>
                    )),
                  )}
                </select>
              </label>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              保存来源
            </Button>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
              取消
            </Button>
          </div>
        </form>
      )}
      <div className="rounded-xl border border-line bg-card p-4 text-sm leading-relaxed">
        <strong>ChatGPT / Codex · Claude 订阅账号</strong>
        <p className="mt-1 text-muted">
          在「AI 订阅」中授权账号，刷新额度时自动记录历史。Codex 额度不代表 ChatGPT
          网页全部用量；Claude 若只返回使用百分比，就保留额度快照，不换算成 Token。订阅与 API
          账单分开统计。
        </p>
        <button
          type="button"
          className="mt-2 underline underline-offset-4"
          onClick={() => useAppStore.getState().setView("ai")}
        >
          管理 AI 账号 →
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.sources.map((source) => {
          const rows = [...latest.values()].filter((r) => r.sourceId === source.id);
          return (
            <section className="rounded-xl border border-line bg-card p-5" key={source.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{source.name}</h3>
                  <p className="mt-1 text-xs text-muted">
                    {names[source.type]} ·{" "}
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
                <p className="mt-3 text-sm text-crit">采集失败，以下保留上次数据：{source.error}</p>
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
      <section className="rounded-xl border border-line bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <h3 className="font-semibold">历史明细 · {records.length}</h3>
          <div className="flex flex-wrap gap-2 text-sm">
            <select
              aria-label="来源筛选"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
            >
              <option value="all">全部来源</option>
              {[
                ...new Map(
                  [
                    ...data.sources,
                    ...data.records.map((r) => ({ id: r.sourceId, name: r.sourceName })),
                  ].map((s) => [s.id, s]),
                ).values(),
              ].map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select aria-label="用量类型" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">全部类型</option>
              <option value="traffic">流量</option>
              <option value="tokens">Token</option>
              <option value="quota">订阅额度</option>
            </select>
            <select
              aria-label="时间范围"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="7">7 天</option>
              <option value="30">30 天</option>
              <option value="all">全部历史</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadJson("用量历史.json", records)}
            >
              <Download />
              导出
            </Button>
          </div>
        </div>
        <p className="px-4 pt-4 text-sm text-muted">
          当前筛选 API Token：输入 {totals.input.toLocaleString()} · 输出{" "}
          {totals.output.toLocaleString()}。流量累计快照与百分比不相加。
        </p>
        <div className="overflow-x-auto p-4">
          <table className="w-full min-w-max text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="pb-3 pr-6">时间 / 统计日</th>
                <th className="pb-3 pr-6">来源 / 范围</th>
                <th className="pb-3 pr-6">使用量</th>
                <th className="pb-3">补充信息</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 200).map((row, i) => (
                <tr key={row.sourceId + row.key + i} className="border-t border-line">
                  <td className="py-3 pr-6 tabular-nums">
                    {row.bucketStart?.slice(0, 10) ?? new Date(row.checkedAt).toLocaleString()}
                  </td>
                  <td className="pr-6">
                    {row.sourceName}
                    <span className="block text-xs text-muted">{row.label}</span>
                  </td>
                  <td className="pr-6 tabular-nums">{amount(row)}</td>
                  <td className="text-xs text-muted">
                    {row.kind === "tokens"
                      ? `缓存读取 ${row.cached ?? 0} · 缓存写入 ${row.cacheWrite ?? 0}（已计入输入）`
                      : row.kind === "traffic"
                        ? row.counterReset
                          ? "计数器重置"
                          : `较上次 ↑ ${usageBytes(row.deltaUpload)} / ↓ ${usageBytes(row.deltaDownload)}`
                        : `额度快照 · ${row.scope}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!records.length && <p className="py-8 text-center text-muted">当前筛选没有记录</p>}
          {records.length > 200 && (
            <p className="mt-3 text-xs text-muted">仅展示最近 200 条，导出包含当前筛选全部记录。</p>
          )}
        </div>
      </section>
    </div>
  );
}
