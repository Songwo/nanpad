import type { AssetKind, Status, ViewId } from "./types";
import { daysUntil } from "./utils";
import type { AppState } from "./store";

export const STATUS_LABEL: Record<Status, string> = {
  online: "正常",
  warning: "注意",
  offline: "告警",
};

export const KIND_LABEL: Record<AssetKind, string> = {
  server: "服务器",
  domain: "域名",
  mail: "邮箱",
  ai: "AI",
  secret: "密钥",
  cert: "证书",
};

export const VIEW_KIND: Partial<Record<ViewId, AssetKind>> = {
  servers: "server",
  domains: "domain",
  mail: "mail",
  ai: "ai",
  vault: "secret",
  certs: "cert",
};

export function chipClass(status: Status): string {
  if (status === "online") return "chip chip-ok";
  if (status === "warning") return "chip chip-warn";
  return "chip chip-crit";
}

export function dotClass(status: Status): string {
  if (status === "online") return "status-dot status-dot-ok";
  if (status === "warning") return "status-dot status-dot-warn";
  return "status-dot status-dot-crit";
}

export function barTone(n: number): "ok" | "warn" | "crit" {
  if (n >= 90) return "crit";
  if (n >= 75) return "warn";
  return "ok";
}

export function expiryStatus(iso: string): Status {
  const d = daysUntil(iso);
  if (d <= 7) return "offline";
  if (d <= 21) return "warning";
  return "online";
}

export function attentionOf(s: AppState): {
  servers: number;
  domains: number;
  mail: number;
  ai: number;
  vault: number;
  certs: number;
  total: number;
} {
  const servers = s.servers.filter((x) => x.status !== "online").length;
  const domains = s.domains.filter((x) => x.status !== "online").length;
  const mail = s.mailboxes.filter((x) => x.status !== "online").length;
  const ai = s.aiAssets.filter((x) => x.status !== "online").length;
  const vault = s.secrets.filter((x) => x.status !== "online").length;
  const certs = s.certs.filter((x) => x.status !== "online").length;
  return {
    servers,
    domains,
    mail,
    ai,
    vault,
    certs,
    total: servers + domains + mail + ai + vault + certs,
  };
}

export function healthScore(s: AppState): number {
  const a = attentionOf(s);
  const n =
    s.servers.length +
    s.domains.length +
    s.mailboxes.length +
    s.aiAssets.length +
    s.secrets.length +
    s.certs.length;
  if (n === 0) return 100;
  const crit =
    s.servers.filter((x) => x.status === "offline").length +
    s.domains.filter((x) => x.status === "offline").length +
    s.certs.filter((x) => x.status === "offline").length;
  const warn = a.total - crit;
  const healthyWeight = n - crit - warn * 0.45;
  return Math.round(Math.max(8, Math.min(100, (healthyWeight / n) * 100)));
}
