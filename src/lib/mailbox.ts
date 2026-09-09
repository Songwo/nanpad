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

export interface SmtpConnection {
  host: string;
  port: number;
  security: "tls" | "starttls";
}
export interface MailFolderRemote {
  path: string;
  name: string;
  specialUse: string | null;
}
export interface MailContact {
  name: string;
  address: string;
}
export interface MailSelection {
  folder: string;
  uid: number;
  uidValidity: string;
}
export interface MailSummary {
  uid: number;
  subject: string;
  from: MailContact[];
  to: MailContact[];
  date: string | null;
  seen: boolean;
  size: number;
}
export interface MailPage {
  items: MailSummary[];
  total: number;
  page: number;
  uidValidity: string;
  folder: string;
}
export interface MailMessage extends MailSummary {
  html?: string;
  text: string;
  cc: MailContact[];
  replyTo: MailContact[];
  messageId: string | null;
  attachments: { index: number; name: string; size: number; contentType: string }[];
}
export interface MailAttachment {
  name: string;
  base64: string;
}
export interface MailDraft {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  attachments: MailAttachment[];
}
export interface MailClientBridge {
  folders(id: string): Promise<MailFolderRemote[]>;
  messages(
    id: string,
    options: { folder: string; page: number; query: string; unseen: boolean },
  ): Promise<MailPage>;
  read(id: string, selection: MailSelection): Promise<MailMessage>;
  seen(id: string, selection: MailSelection, seen: boolean): Promise<boolean>;
  send(
    id: string,
    draft: MailDraft,
  ): Promise<{ messageId: string; accepted: string[]; rejected: string[] }>;
  draft(id: string): Promise<MailDraft | null>;
  saveDraft(id: string, draft: MailDraft): Promise<void>;
  validateSmtp(value: SmtpConnection): Promise<SmtpConnection>;
  pickAttachments(): Promise<MailAttachment[]>;
  download(id: string, selection: MailSelection, index: number): Promise<boolean>;
}
