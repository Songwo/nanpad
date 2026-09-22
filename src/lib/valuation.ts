import type { Snapshot } from "./types";

export interface ValuationCategory {
  key: string;
  label: string;
  usd: number;
  pct: number;
  count: number;
  color: string;
}

export interface EstateValuation {
  totalUsd: number;
  categories: ValuationCategory[];
}

/**
 * Estimates the total digital estate valuation (Annual USD value)
 * based on compute instances, domains, AI compute budgets, and protected secrets.
 */
export function calculateEstateValuation(snapshot: Snapshot): EstateValuation {
  // 1. Compute Instances Valuation (Annual compute worth ~ $360/server base)
  const computeUsd = snapshot.servers.reduce((acc, s) => {
    const baseMonthly = 35;
    const loadBonus = (s.cpu + s.memory) * 0.2;
    return acc + Math.round((baseMonthly + loadBonus) * 12);
  }, 0);

  // 2. Domain Portfolio Valuation (~$120 - $280 estimated brand/registry value per domain)
  const domainsUsd = snapshot.domains.reduce((acc, d) => {
    let val = 120;
    if (d.name.endsWith(".com")) val = 280;
    else if (d.name.endsWith(".io") || d.name.endsWith(".ai")) val = 360;
    else if (d.name.endsWith(".org") || d.name.endsWith(".net")) val = 160;
    return acc + val;
  }, 0);

  // 3. AI Compute & Subscriptions (Annualized USD spend)
  const aiUsd = snapshot.aiAssets.reduce((acc, a) => {
    return acc + Math.round(a.monthlyUsd * 12);
  }, 0);

  // 4. Encrypted Vault Assets (Enterprise confidential protection value ~ $80/secret)
  const secretsUsd = snapshot.secrets.length * 80;

  // 5. SSL / TLS Certificates (Commercial certificate assurance ~ $95/cert)
  const certsUsd = snapshot.certs.length * 95;

  const totalUsd = computeUsd + domainsUsd + aiUsd + secretsUsd + certsUsd;
  const safeTotal = totalUsd > 0 ? totalUsd : 1;

  const categories: ValuationCategory[] = [
    {
      key: "compute",
      label: "计算算力",
      usd: computeUsd,
      pct: Math.round((computeUsd / safeTotal) * 100),
      count: snapshot.servers.length,
      color: "var(--color-ink)",
    },
    {
      key: "domains",
      label: "域名资产",
      usd: domainsUsd,
      pct: Math.round((domainsUsd / safeTotal) * 100),
      count: snapshot.domains.length,
      color: "#0ea5e9", // Sky
    },
    {
      key: "ai",
      label: "AI 算力",
      usd: aiUsd,
      pct: Math.round((aiUsd / safeTotal) * 100),
      count: snapshot.aiAssets.length,
      color: "#8b5cf6", // Purple
    },
    {
      key: "secrets",
      label: "加密密钥",
      usd: secretsUsd,
      pct: Math.round((secretsUsd / safeTotal) * 100),
      count: snapshot.secrets.length,
      color: "#f59e0b", // Amber
    },
    {
      key: "certs",
      label: "安全证书",
      usd: certsUsd,
      pct: Math.round((certsUsd / safeTotal) * 100),
      count: snapshot.certs.length,
      color: "#10b981", // Emerald
    },
  ];

  return {
    totalUsd,
    categories,
  };
}

export function formatCurrencyUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}
