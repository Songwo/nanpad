import type { AiAsset } from "./types";

export function subscriptionCost(items: Pick<AiAsset, "monthlyUsd" | "monthlyUsdKnown">[]) {
  const known = items.filter(
    (item) =>
      item.monthlyUsdKnown !== false && Number.isFinite(item.monthlyUsd) && item.monthlyUsd >= 0,
  );
  return {
    total: known.reduce((sum, item) => sum + item.monthlyUsd, 0),
    missing: items.length - known.length,
    known: known.length,
  };
}
