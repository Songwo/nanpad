import { Check, Copy, Eye, EyeOff, KeyRound, Link2, Lock, Plus, ShieldCheck, Trash2, Unlink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useAppStore } from "@/lib/store";
import type { BoundSecretItem, Server } from "@/lib/types";
import { uid } from "@/lib/utils";
import { t } from "@/lib/i18n";

export function ServerSecretsPanel({ server }: { server: Server }) {
  const upsertServer = useAppStore((s) => s.upsertServer);
  const globalSecrets = useAppStore((s) => s.secrets);
  const customSecrets = server.customSecrets ?? [];

  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [selectedVaultId, setSelectedVaultId] = useState("");
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());

  function toggleReveal(id: string) {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleAddCustomSecret() {
    if (!newKey.trim() || !newValue.trim()) {
      toast.error(t("请填写密钥名称与内容"));
      return;
    }

    const newItem: BoundSecretItem = {
      id: uid("sec"),
      key: newKey.trim(),
      value: newValue.trim(),
    };

    upsertServer({
      ...server,
      customSecrets: [...customSecrets, newItem],
    });

    setNewKey("");
    setNewValue("");
    toast.success(t("已添加绑定密钥: {0}", newItem.key));
  }

  function handleBindVaultSecret() {
    if (!selectedVaultId) return;
    const target = globalSecrets.find((s) => s.id === selectedVaultId);
    if (!target) return;

    if (customSecrets.some((s) => s.vaultSecretId === selectedVaultId)) {
      toast(t("该密钥库项目已关联"));
      return;
    }

    const newItem: BoundSecretItem = {
      id: uid("sec"),
      key: target.name,
      value: target.hint || t("密钥库托管私密项目"),
      vaultSecretId: target.id,
    };

    upsertServer({
      ...server,
      customSecrets: [...customSecrets, newItem],
    });

    setSelectedVaultId("");
    toast.success(t("已成功关联密钥库凭据: {0}", target.name));
  }

  function handleDeleteSecret(id: string) {
    upsertServer({
      ...server,
      customSecrets: customSecrets.filter((s) => s.id !== id),
    });
    toast(t("已解绑该密钥"));
  }

  async function copySecretValue(item: BoundSecretItem) {
    try {
      await navigator.clipboard.writeText(item.value);
      toast.success(t("已安全复制密钥【{0}】到剪贴板", item.key));
    } catch {
      toast.error(t("复制失败"));
    }
  }

  return (
    <div className="space-y-4 p-4">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 pb-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
            <KeyRound className="size-4 text-amber-400" />
            {t("服务器绑定密钥 & 凭据")}
            <span className="rounded-full bg-line/60 px-2 py-0.5 text-xs text-muted font-mono">
              {customSecrets.length}
            </span>
          </h3>
          <p className="text-xs text-muted mt-0.5">
            {t("管理与该服务器绑定的敏感变量、部署私钥、数据库口令及关联全局密钥库凭据")}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 font-mono">
          <ShieldCheck className="size-3.5" />
          <span>{t("安全沙盒防护中")}</span>
        </div>
      </div>

      {/* Add New Secret Form */}
      <div className="rounded-xl border border-line bg-surface-subtle p-3.5 space-y-3">
        <div className="text-xs font-semibold text-ink flex items-center gap-1.5">
          <Plus className="size-3.5 text-ink" />
          {t("添加专属敏感键值对 (如环境变量/口令)")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          <div className="sm:col-span-2">
            <Input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="MYSQL_ROOT_PASSWORD / API_KEY"
              className="font-mono text-xs"
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              type="password"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={t("敏感密钥内容 / Token")}
              className="font-mono text-xs"
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleAddCustomSecret}
            className="btn-pill text-xs h-9 shrink-0"
          >
            {t("添加密钥")}
          </Button>
        </div>

        {/* Bind from Global Vault */}
        {globalSecrets.length > 0 && (
          <div className="pt-2 border-t border-line/60 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted flex items-center gap-1">
              <Link2 className="size-3" />
              {t("关联已有密钥库")}:
            </span>
            <select
              value={selectedVaultId}
              onChange={(e) => setSelectedVaultId(e.target.value)}
              className="rounded-md border border-line bg-canvas px-2 py-1 text-xs text-ink max-w-[220px]"
            >
              <option value="">{t("选择全局密钥库中的凭据...")}</option>
              {globalSecrets.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.name} ({sec.kind.toUpperCase()})
                </option>
              ))}
            </select>
            {selectedVaultId && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBindVaultSecret}
                className="btn-pill h-7 text-xs px-2.5"
              >
                {t("确认关联")}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Secret Cards List */}
      <div className="space-y-2">
        {customSecrets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line/80 py-8 text-center">
            <Lock className="mx-auto size-8 text-muted/50 mb-2" />
            <p className="text-xs font-medium text-ink">{t("暂未绑定专属密钥")}</p>
            <p className="text-[11px] text-muted mt-0.5">
              {t("可输入敏感变量或选择全局密钥库凭据进行关联")}
            </p>
          </div>
        ) : (
          customSecrets.map((item) => {
            const isRevealed = revealedIds.has(item.id);
            const isVaultLinked = Boolean(item.vaultSecretId);
            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-3 transition-colors hover:border-line-focus"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-ink">
                      {item.key}
                    </span>
                    {isVaultLinked && (
                      <span className="inline-flex items-center gap-0.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.2 text-[9px] text-sky-400 font-mono">
                        <Link2 className="size-2.5" />
                        VAULT
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted truncate">
                    {isRevealed ? (
                      <span className="text-emerald-400 select-all">{item.value}</span>
                    ) : (
                      <span>••••••••••••••••</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => toggleReveal(item.id)}
                    title={isRevealed ? t("隐藏明文") : t("查看明文")}
                    className="size-7"
                  >
                    {isRevealed ? (
                      <EyeOff className="size-3.5 text-muted hover:text-ink" />
                    ) : (
                      <Eye className="size-3.5 text-muted hover:text-ink" />
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => copySecretValue(item)}
                    title={t("一键复制密钥")}
                    className="size-7"
                  >
                    <Copy className="size-3.5 text-muted hover:text-ink" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDeleteSecret(item.id)}
                    title={t("解绑移除")}
                    className="size-7 text-muted hover:text-rose-400"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
