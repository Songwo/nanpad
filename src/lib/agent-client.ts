import type { AssetKind } from "./types";

export interface ModelConfig {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  topK: number;
  maxSteps: number;
  maxTokens: number;
  embeddingEnabled: boolean;
  embeddingBaseUrl: string;
  embeddingModel: string;
}
export interface Source {
  id: string;
  citation: string;
  title: string;
  kind?: AssetKind;
  assetId?: string;
  focus?: "account";
  excerpt: string;
}
export interface AgentEvent {
  id: string;
  type: "phase" | "delta" | "tool" | "source" | "done" | "error";
  text?: string;
  name?: string;
  model?: string;
  step?: number;
  source?: Source;
}
export interface KnowledgeStatus {
  assets: number;
  chunks: number;
  documents: Array<{ id: string; name: string; characters: number; addedAt: string }>;
}
export interface AgentBridge {
  config(): Promise<ModelConfig>;
  saveConfig(
    config: ModelConfig & { apiKey?: string; clearApiKey?: boolean },
  ): Promise<ModelConfig>;
  models(): Promise<string[]>;
  test(): Promise<{ model: string; latencyMs: number; text: string }>;
  knowledge(): Promise<KnowledgeStatus>;
  rebuild(): Promise<KnowledgeStatus>;
  importDocument(): Promise<KnowledgeStatus | null>;
  removeDocument(id: string): Promise<KnowledgeStatus>;
  run(request: {
    id: string;
    question: string;
    allowMailboxChecks?: boolean;
    history: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<{
    model: string;
    sources: number;
    steps: number;
    text: string;
    sourceItems: Source[];
    tools: string[];
  }>;
  cancel(id: string): Promise<boolean>;
  onEvent(handler: (event: AgentEvent) => void): () => void;
}
