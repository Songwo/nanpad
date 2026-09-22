export interface UsageSource {
  id: string;
  name: string;
  type: string;
  nodeId?: string;
  checkedAt?: string;
  attemptedAt?: string;
  error?: string;
}
export interface UsageRecord {
  sourceId: string;
  sourceName: string;
  key: string;
  kind: "traffic" | "tokens" | "quota";
  label: string;
  checkedAt: string;
  bucketStart?: string;
  upload?: number;
  download?: number;
  total?: number | null;
  expiresAt?: string | null;
  deltaUpload?: number | null;
  deltaDownload?: number | null;
  counterReset?: boolean;
  input?: number;
  output?: number;
  cached?: number;
  cacheWrite?: number;
  usedPercent?: number | null;
  used?: number | null;
  limit?: number | null;
  unit?: string;
  resetsAt?: string | null;
  scope?: string;
  sampleAt?: string;
}
export interface UsageState {
  sources: UsageSource[];
  records: UsageRecord[];
}
export interface UsageBridge {
  list(): Promise<UsageState>;
  add(input: Record<string, string>): Promise<UsageSource>;
  remove(id: string): Promise<void>;
  refresh(id: string): Promise<UsageState>;
  refreshAll(): Promise<{ failures: string[] }>;
}
export function usageBytes(value: number | null | undefined) {
  if (value == null) return "未提供";
  if (value === 0) return "0 B";
  const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 2 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][index]}`;
}
