import type { Secret } from "./types";

export interface DocumentAccountCandidate {
  id: string;
  name: string;
  url: string;
  username: string;
  password: string;
  note: string;
}
export interface DocumentAccountsBridge {
  preview(documentId: string): Promise<{
    ticket: string;
    documentTitle: string;
    candidates: DocumentAccountCandidate[];
    warnings: string[];
  }>;
  commit(input: { ticket: string; candidates: DocumentAccountCandidate[] }): Promise<{
    assets: Secret[];
    added: number;
    existing: number;
    documentId: string;
    bindingError?: string;
  }>;
  cancel(ticket: string): Promise<void>;
}
