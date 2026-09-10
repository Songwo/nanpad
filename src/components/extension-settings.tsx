import { useEffect, useRef, useState } from "react";
import { Copy, Link2, Loader2, Puzzle, Unplug } from "lucide-react";
import { toast } from "sonner";
import { desktop } from "@/lib/desktop";
import { t } from "@/lib/i18n";
import { useVault } from "@/lib/vault-state";
import { Button } from "./ui/button";

export function ExtensionSettings() {
  const bridge = desktop()?.extension;
  const unlocked = useVault((s) => s.unlocked);
  const [status, setStatus] = useState<Awaited<ReturnType<NonNullable<typeof bridge>["status"]>>>();
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    let revision = 0;
    const invalidate = () => {
      generation.current++;
    };
    const refresh = () => {
      const current = ++revision;
      void bridge
        .status()
        .then((value) => {
          if (active && current === revision) {
            setStatus(value);
            if (!value.pairingPending) setPairing(undefined);
          }
        })
        .catch(() => {
          if (active) setError(t("插件连接状态读取失败"));
        });
    };
    const off = bridge.onChanged(refresh);
    const offVault = desktop()!.onVaultChanged(() => {
      invalidate();
      setPairing(undefined);
    });
    refresh();
    return () => {
      active = false;
      invalidate();
      off();
      offVault();
    };
  }, [bridge]);

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setTimeout(
      () => setPairing(undefined),
      Math.max(0, pairing.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [pairing]);

  async function pair() {
    if (!bridge) return;
    setBusy(true);
    setError("");
    try {
      if (!(await useVault.getState().require(t("配对浏览器插件需要先解锁密钥库。")))) return;
      const current = generation.current;
      const value = await bridge.beginPairing();
      if (current === generation.current && useVault.getState().unlocked) setPairing(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("插件配对失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <Puzzle className="size-5 text-muted" />
        <h3 className="text-lg font-semibold">{t("浏览器插件")}</h3>
      </div>
      {!bridge ? (
        <p className="text-meta text-muted">{t("仅桌面版可用")}</p>
      ) : (
        <>
          <dl className="divide-y divide-line text-meta">
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-muted">{t("本机连接")}</dt>
              <dd>{status?.running ? t("已就绪") : status ? t("连接不可用") : t("加载中")}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-muted">{t("已配对浏览器")}</dt>
              <dd>{status?.pairedClients ?? 0}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-muted">{t("待确认账号")}</dt>
              <dd>{status?.pendingCount ?? 0}</dd>
            </div>
          </dl>
          {(error || status?.error) && (
            <p role="alert" className="text-meta text-down">
              {error || status?.error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void pair()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
              {t("生成配对码")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || (!status?.pairedClients && !pairing)}
              onClick={() => {
                void bridge
                  .revoke()
                  .then(() => setPairing(undefined))
                  .catch(() => setError(t("断开插件失败")));
              }}
            >
              <Unplug className="size-4" />
              {t("断开全部插件")}
            </Button>
          </div>
          {pairing && unlocked && (
            <div className="space-y-2 border-t border-line pt-4">
              <div className="flex items-center justify-between gap-2 text-meta">
                <label htmlFor="extension-pairing-code">{t("配对码")}</label>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("复制配对码")}
                  title={t("复制配对码")}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(pairing.code)
                      .then(() => toast.success(t("已复制")))
                      .catch(() => setError(t("复制失败")));
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <textarea
                id="extension-pairing-code"
                readOnly
                value={pairing.code}
                spellCheck={false}
                className="w-full resize-none rounded-md border border-line bg-canvas px-3 py-2 font-mono text-meta text-ink"
                rows={3}
              />
              <p className="text-meta text-muted">
                {t(
                  "有效期至 {0}，使用一次后失效",
                  new Date(pairing.expiresAt).toLocaleTimeString(),
                )}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
