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
  origin?: "local";
  model?: string;
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
  localStatus(): Promise<LocalUsageStatus>;
  configureLocal(input: { enabled: boolean }): Promise<LocalUsageStatus>;
  refreshLocal(): Promise<LocalUsageStatus>;
}
export interface LocalUsageStatus {
  enabled: boolean;
  paused?: boolean;
  intervalMs: number;
  lastScannedAt: string | null;
  sources: {
    id: string;
    name: string;
    available: boolean;
    files: number;
    records: number;
    status?: "not-found" | "discovering" | "importing" | "ready" | "no-usage" | "error";
    progress?: { discoveryComplete: boolean; pendingFiles: number; processedFiles: number };
    warnings?: string[];
    firstUsageAt?: string;
    lastUsageAt?: string;
    error?: string;
  }[];
  error?: string;
}
export function usageBytes(value: number | null | undefined) {
  if (value == null) return "未提供";
  if (value === 0) return "0 B";
  const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 2 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][index]}`;
}
