export type AiProvider = "openai" | "claude" | "grok" | "gemini";
export interface AiAccount {
  id: string;
  provider: AiProvider;
  accountId: string;
  email: string;
  plan: string;
  tokenExpiresAt: string;
  subscriptionExpiresAt: string | null;
  refreshable: boolean;
  usage: null | {
    checkedAt: string;
    windows: { label: string; usedPercent: number; resetsAt: string | null }[];
  };
}
export interface AiAccountBridge {
  list(): Promise<AiAccount[]>;
  start(provider: AiProvider): Promise<{ id: string; mode: "loopback" | "code" }>;
  status(id: string): Promise<{ status: string; error: string }>;
  finish(id: string, code: string): Promise<AiAccount>;
  cancel(id: string): Promise<boolean>;
  refresh(id: string): Promise<AiAccount>;
  remove(id: string): Promise<boolean>;
}
