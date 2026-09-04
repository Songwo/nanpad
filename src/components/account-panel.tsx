import { Copy, ExternalLink, Eye, EyeOff, KeyRound, Lock, UserRound } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ACCOUNT_COPY } from "./account-fields";
import { Button } from "./ui/button";
import { TimeAgo } from "./ui/time-ago";
import { accountId, desktop, type AccountCredential } from "@/lib/desktop";
import { useAppStore } from "@/lib/store";
import type { AssetKind } from "@/lib/types";
import { copyText } from "@/lib/utils";
import { useVault } from "@/lib/vault-state";

/**
 * The read side of a saved account, shown inside the detail sheet.
 *
 * This is the thing you actually open the app for — so it leads with copy
 * buttons rather than a form, and the password stays masked until asked for.
 */
export function AccountPanel({ assetId, kind }: { assetId: string; kind: AssetKind }) {
  const bridge = desktop();
  const unlocked = useVault((s) => s.unlocked);
  const requireVault = useVault((s) => s.require);
  const openComposer = useAppStore((s) => s.openComposer);
  const [record, setRecord] = useState<AccountCredential | null>(null);
  const [checked, setChecked] = useState(false);
  const [reveal, setReveal] = useState(false);
  const copy = ACCOUNT_COPY[kind];

  useEffect(() => {
    let alive = true;
    setReveal(false);
    void (async () => {
      if (!bridge || !unlocked) {
        if (alive) {
          setRecord(null);
          setChecked(false);
        }
        return;
      }
      try {
        const rec = await bridge.vault.get(accountId(assetId));
        if (alive) {
          setRecord(rec as AccountCredential | null);
          setChecked(true);
        }
      } catch {
        if (alive) setChecked(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bridge, assetId, unlocked]);

  if (!bridge) return null;

  return (
    <section className="border-t border-line px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <UserRound className="size-4 text-muted" />
        <h3 className="text-meta font-semibold">{copy.title}</h3>
      </div>

      {!unlocked ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void requireVault("查看已保存的账号密码需要先解锁密钥库。")}
        >
          <Lock className="size-3.5" />
          解锁查看
        </Button>
      ) : !checked ? (
        <p className="text-meta text-muted">读取中…</p>
      ) : !record ? (
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => openComposer(kind, assetId)}>
            <KeyRound className="size-3.5" />
            录入账号密码
          </Button>
          <span className="text-2xs text-muted">尚未保存任何账号信息。</span>
        </div>
      ) : (
        <dl className="space-y-2">
          {record.url && (
            <Row label="登录地址">
              <button
                type="button"
                className="truncate text-left text-meta text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                onClick={() => bridge.openExternal(record.url!).catch(() => toast("无法打开链接"))}
              >
                {record.url}
              </button>
              <IconAction label="打开" onClick={() => bridge.openExternal(record.url!)}>
                <ExternalLink className="size-3.5" />
              </IconAction>
            </Row>
          )}

          {record.username && (
            <Row label="账号">
              <span className="truncate font-mono text-meta">{record.username}</span>
              <CopyAction value={record.username} what="账号" />
            </Row>
          )}

          {record.password && (
            <Row label={copy.password}>
              <span className="truncate font-mono text-meta">
                {reveal ? record.password : "•".repeat(Math.min(18, record.password.length))}
              </span>
              <IconAction label={reveal ? "隐藏" : "显示"} onClick={() => setReveal((v) => !v)}>
                {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </IconAction>
              <CopyAction value={record.password} what={copy.password} />
            </Row>
          )}

          {record.note && (
            <div>
              <dt className="mb-1 text-2xs text-subtle">备注</dt>
              <dd>
                <pre className="whitespace-pre-wrap rounded-md bg-canvas px-3 py-2 font-mono text-2xs text-ink">
                  {record.note}
                </pre>
              </dd>
            </div>
          )}

          <p className="pt-1 text-2xs text-subtle">
            更新于 <TimeAgo iso={record.updatedAt} />
          </p>
        </dl>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-20 shrink-0 text-2xs text-subtle">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center gap-1.5">{children}</dd>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="grid size-7 shrink-0 place-items-center rounded-full text-subtle transition-colors duration-150 ease-out hover:bg-line hover:text-ink"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function CopyAction({ value, what }: { value: string; what: string }) {
  return (
    <IconAction
      label={`复制${what}`}
      onClick={() => {
        void copyText(value);
        toast(`已复制${what}`);
      }}
    >
      <Copy className="size-3.5" />
    </IconAction>
  );
}
