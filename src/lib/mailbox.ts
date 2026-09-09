export interface MailboxConnection {
  host: string;
  port: number;
  secure: boolean;
}

export interface MailboxStatus {
  assetId: string;
  address: string;
  messages: number;
  unseen: number;
  newMessages: number | null;
  checkedAt: string;
  usedMb?: number;
  quotaMb?: number;
}

export interface MailboxesBridge {
  check(assetId: string): Promise<MailboxStatus>;
  validate(connection: MailboxConnection): Promise<MailboxConnection>;
}
