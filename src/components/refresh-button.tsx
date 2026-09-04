import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { isDesktop } from "@/lib/desktop";
import { refreshAll, refreshById, useProbeState, type ProbeKind } from "@/lib/probes";
import { cn } from "@/lib/utils";
import { useVault } from "@/lib/vault-state";

const NEEDS_VAULT: Record<ProbeKind, boolean> = { server: true, domain: false, cert: false };
const LABEL: Record<ProbeKind, string> = { server: "主机", domain: "域名", cert: "证书" };

/** Probe every asset of one kind. Hidden entirely in the web preview. */
export function RefreshAllButton({ kind }: { kind: ProbeKind | null }) {
  const [busy, setBusy] = useState(false);
  const requireVault = useVault((s) => s.require);
  if (!isDesktop() || !kind) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      title={`重新采集全部${LABEL[kind]}`}
      onClick={async () => {
        if (NEEDS_VAULT[kind] && !(await requireVault("采集主机指标需要读取已保存的 SSH 凭据。"))) {
          return;
        }
        setBusy(true);
        try {
          const n = await refreshAll(kind);
          toast(`已刷新 ${n} 项${LABEL[kind]}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
      刷新
    </Button>
  );
}

/** Probe one asset, from its detail sheet. */
export function RefreshOneButton({ kind, id }: { kind: ProbeKind; id: string }) {
  const busy = useProbeState((s) => Boolean(s.busy[id]));
  const requireVault = useVault((s) => s.require);
  if (!isDesktop()) return null;

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={busy}
      aria-label="重新采集"
      title="重新采集"
      onClick={async () => {
        if (NEEDS_VAULT[kind] && !(await requireVault("采集主机指标需要读取已保存的 SSH 凭据。"))) {
          return;
        }
        await refreshById(kind, id);
      }}
    >
      <RefreshCw className={cn("size-4", busy && "animate-spin")} />
    </Button>
  );
}
