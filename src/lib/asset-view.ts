import type { AssetKind, Snapshot, Status, ViewId } from "./types.ts";
import { refKey, type AssetRef } from "./operations.ts";

export interface AssetRow extends AssetRef {
  name: string;
  detail: string;
  tags: string[];
  status: Status;
  expires?: string;
  cpu?: number;
  memory?: number;
  monthlyUsd?: number;
  search: string;
}

export const VIEW_ASSET_KIND: Partial<Record<ViewId, AssetKind>> = {
  servers: "server",
  domains: "domain",
  certs: "cert",
  mail: "mail",
  ai: "ai",
  vault: "secret",
};
export const GRAPH_KINDS: AssetKind[] = ["domain", "cert", "server", "mail", "ai", "secret"];

export function assetRows(s: Snapshot): AssetRow[] {
  const row = (
    kind: AssetKind,
    item: { id: string; tags: string[]; status: Status },
    name: string,
    detail: string,
    extra: Partial<AssetRow> = {},
  ): AssetRow => ({
    kind,
    id: item.id,
    name,
    detail,
    tags: item.tags ?? [],
    status: item.status,
    search: `${name} ${detail} ${(item.tags ?? []).join(" ")}`.toLocaleLowerCase(),
    ...extra,
  });
  return [
    ...s.servers.map((x) =>
      row("server", x, x.name, `${x.username}@${x.host}:${x.port}`, {
        cpu: x.cpu,
        memory: x.memory,
        search:
          `${x.name} ${x.host} ${x.username} ${x.label} ${x.os} ${x.region} ${x.tags.join(" ")}`.toLocaleLowerCase(),
      }),
    ),
    ...s.domains.map((x) =>
      row("domain", x, x.name, `${x.registrar} · ${x.dns}`, { expires: x.expiresAt }),
    ),
    ...s.certs.map((x) =>
      row("cert", x, x.cn, x.issuer, {
        expires: x.expiresAt,
        search: `${x.cn} ${x.issuer} ${x.sans.join(" ")} ${x.tags.join(" ")}`.toLocaleLowerCase(),
      }),
    ),
    ...s.mailboxes.map((x) => row("mail", x, x.address, x.forwardTo || x.domain)),
    ...s.aiAssets.map((x) =>
      row("ai", x, x.name, `${x.provider} · ${x.plan}`, {
        expires: x.oauthAccountId ? (x.subscriptionExpiresAt ?? undefined) : x.renewsAt,
        monthlyUsd: x.monthlyUsdKnown === false ? undefined : x.monthlyUsd,
      }),
    ),
    ...s.secrets.map((x) => row("secret", x, x.name, x.kind)),
  ];
}

export function filterAssetRows(
  rows: AssetRow[],
  view: ViewId,
  query: string,
  attention: boolean,
  tags: string[],
): AssetRow[] {
  const kind = VIEW_ASSET_KIND[view];
  const text = query.trim().toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (!kind || kind === row.kind) &&
      (!attention || row.status !== "online") &&
      tags.every((tag) => row.tags.includes(tag)) &&
      (!text || row.search.includes(text)),
  );
}

// 仅把已保存的关联绘制为边；不依据名称猜测关系，也不暴露凭据。
export function assetGraph(rows: AssetRow[], links: Snapshot["links"], vertical = false) {
  // 图引擎会把节点 ID 放入选择器，编码后可容纳资产 ID 中的引号等字符。
  const nodeId = (ref: AssetRef) => encodeURIComponent(refKey(ref));
  const ids = new Set(rows.map(refKey));
  const columns = GRAPH_KINDS.filter((kind) => rows.some((row) => row.kind === kind));
  const slots = new Map<AssetKind, number>();
  return {
    nodes: rows.map((row) => {
      const slot = slots.get(row.kind) ?? 0;
      slots.set(row.kind, slot + 1);
      return {
        id: nodeId(row),
        type: "asset" as const,
        position: vertical
          ? { x: slot * 260, y: columns.indexOf(row.kind) * 144 }
          : { x: columns.indexOf(row.kind) * 280, y: slot * 132 },
        data: { asset: row, vertical },
      };
    }),
    edges: (links ?? [])
      .filter((link) => ids.has(refKey(link.from)) && ids.has(refKey(link.to)))
      .map((link) => ({
        id: JSON.stringify([refKey(link.from), refKey(link.to)].sort()),
        source: nodeId(link.from),
        target: nodeId(link.to),
        type: "smoothstep",
      })),
  };
}
