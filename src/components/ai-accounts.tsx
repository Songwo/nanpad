import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Trash2, Lock } from "lucide-react";
import { desktop } from "@/lib/desktop";
import type { AiAccount, AiProvider } from "@/lib/ai-accounts";
import { useVault } from "@/lib/vault-state";
import { t } from "@/lib/i18n";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/input";

const PROVIDERS = {
  openai: "OpenAI / ChatGPT",
  claude: "Anthropic / Claude",
  grok: "xAI / Grok",
  gemini: "Google / Gemini",
};
const date = (value: string | null) => (value ? new Date(value).toLocaleString() : t("未提供"));
const labels: Record<string, string> = {
  primary_window: "主要额度",
  secondary_window: "次要额度",
  five_hour: "5 小时",
  seven_day: "7 天",
  seven_day_sonnet: "Sonnet / 7 天",
  weekly: "本周",
};
export function AiAccountsPanel() {
  const api = desktop()?.aiAccounts;
  const unlocked = useVault((s) => s.unlocked);
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [accounts, setAccounts] = useState<AiAccount[]>([]);
  const [session, setSession] = useState<{ id: string; mode: string } | null>(null);
  const currentSession = useRef<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const task = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!api || !unlocked) {
      setAccounts([]);
      return;
    }
    let alive = true;
    void api
      .list()
      .then((rows) => {
        if (alive) setAccounts(rows);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [api, unlocked]);
  useEffect(
    () => () => {
      if (currentSession.current) void api?.cancel(currentSession.current);
    },
    [api],
  );
  useEffect(() => {
    if (!api || !session) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      void api
        .status(session.id)
        .then(async (result) => {
          if (stopped || ["pending", "exchanging"].includes(result.status)) return;
          stopped = true;
          window.clearInterval(timer);
          currentSession.current = null;
          setSession(null);
          setCode("");
          if (result.status === "connected") {
            setAccounts(await api.list());
            setNotice(t("账号已连接"));
          } else setError(result.error || t("授权已取消或超时，请重试。"));
        })
        .catch((err: Error) => {
          if (!stopped) setError(err.message);
        });
    }, 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [api, session]);
  if (!api) return null;
  return (
    <section className="border-t border-line pt-4">
      <h4 className="mb-3 font-semibold">{t("AI 服务账号")}</h4>
      {!unlocked ? (
        <Button
          variant="outline"
          onClick={() => void useVault.getState().require(t("登录 AI 账号需要先解锁密钥库。"))}
        >
          <Lock className="size-4" />
          {t("解锁密钥库")}
        </Button>
      ) : (
        <>
          <Field label={t("授权服务商")}>
            <select
              aria-label={t("授权服务商")}
              className="h-10 w-full rounded-md border border-line bg-card px-3 text-meta"
              value={provider}
              disabled={busy || Boolean(session)}
              onChange={(e) => setProvider(e.target.value as AiProvider)}
            >
              {Object.entries(PROVIDERS).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <div className="my-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || Boolean(session)}
              onClick={() =>
                void task(async () => {
                  const value = await api.start(provider);
                  currentSession.current = value.id;
                  setSession(value);
                })
              }
            >
              <ExternalLink className="size-4" />
              {t("网页登录授权")}
            </Button>
            {session && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void task(async () => {
                    await api.cancel(session.id);
                    currentSession.current = null;
                    setSession(null);
                    setCode("");
                  })
                }
              >
                {t("取消")}
              </Button>
            )}
          </div>
          {session && (
            <p role="status" className="mb-3 text-meta text-muted">
              {t(
                session.mode === "code"
                  ? "请粘贴授权页返回的完整 code#state。"
                  : "等待浏览器授权返回…",
              )}
            </p>
          )}
          {session?.mode === "code" && (
            <form
              className="mb-4 space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void task(async () => {
                  await api.finish(session.id, code);
                  setCode("");
                });
              }}
            >
              <Input
                aria-label={t("授权码")}
                type="password"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button size="sm" disabled={busy || !code.trim()}>
                {t("完成授权")}
              </Button>
            </form>
          )}
          <ul className="divide-y divide-line">
            {accounts.map((account) => (
              <li key={account.id} className="space-y-2 py-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <strong className="block break-words text-meta">
                      {PROVIDERS[account.provider]}
                    </strong>
                    <span className="block break-all text-meta text-muted">
                      {account.email || account.accountId}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t("刷新用量")}
                    aria-label={t("刷新用量")}
                    disabled={busy}
                    onClick={() =>
                      void task(async () => {
                        const updated = await api.refresh(account.id);
                        setAccounts((rows) =>
                          rows.map((row) => (row.id === updated.id ? updated : row)),
                        );
                      })
                    }
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t("断开账号")}
                    aria-label={t("断开账号")}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(t("删除本机授权令牌？服务器授权需要在服务商账号中撤销。")))
                        void task(async () => {
                          await api.remove(account.id);
                          setAccounts(await api.list());
                        });
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <dl className="space-y-1 text-2xs text-muted">
                  <div>
                    {t("套餐")}: {account.plan || t("未提供")}
                  </div>
                  <div>
                    {t("令牌有效期")}: {date(account.tokenExpiresAt)}
                  </div>
                  <div>
                    {t("订阅到期")}: {date(account.subscriptionExpiresAt)}
                  </div>
                  <div>
                    {t("自动刷新令牌")}: {t(account.refreshable ? "支持" : "不支持")}
                  </div>
                </dl>
                {!account.usage?.windows.length && (
                  <p className="text-2xs text-muted">{t("暂无额度数据，点击刷新用量。")}</p>
                )}
                {account.usage?.windows.map((item, i) => (
                  <div key={`${item.label}:${i}`} className="space-y-1">
                    <div className="flex justify-between gap-2 text-2xs">
                      <span className="break-words">{t(labels[item.label] ?? item.label)}</span>
                      <span>{item.usedPercent}%</span>
                    </div>
                    <progress
                      aria-label={item.label}
                      value={Math.max(0, Math.min(100, item.usedPercent))}
                      max={100}
                      className="h-2 w-full accent-ink"
                    />
                    <p className="text-2xs text-subtle">
                      {t("额度重置")}: {date(item.resetsAt)}
                    </p>
                  </div>
                ))}
                {account.usage && (
                  <p className="text-2xs text-subtle">
                    {t("查询时间")}: {date(account.usage.checkedAt)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {notice && (
        <p role="status" className="mt-3 text-meta text-ok">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 break-words text-meta text-crit">
          {error}
        </p>
      )}
    </section>
  );
}
