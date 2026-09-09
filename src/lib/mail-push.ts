export type MailPushProvider = "telegram" | "serverchan" | "wecom";

export interface MailPushConfig {
  enabled: boolean;
  provider: MailPushProvider;
  destination: string;
  hasToken: boolean;
  mailboxIds: string[];
  intervalMinutes: number;
}

export interface MailPushInput extends Omit<MailPushConfig, "hasToken"> {
  token?: string;
  clearToken?: boolean;
}

export interface MailPushBridge {
  config(): Promise<MailPushConfig>;
  save(input: MailPushInput): Promise<MailPushConfig>;
  test(): Promise<{ ok: true }>;
}
