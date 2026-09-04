import type { Snapshot } from "./types";

export type CredentialKind = "password" | "key" | "agent";

export interface SshCredential {
  kind: CredentialKind;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

/**
 * A login kept in the vault: mailbox password, registrar account, AI provider
 * sign-in, or the body of a secret. One shape for every asset kind, because the
 * thing you actually want at 2am is always "账号是什么、密码是什么".
 */
export interface AccountCredential {
  url?: string;
  username?: string;
  password?: string;
  /** Recovery codes, API keys, 2FA backup — anything that needs more than a line. */
  note?: string;
  updatedAt: string;
}

export interface SshTarget {
  id: string;
  host: string;
  port: number;
  username: string;
}

export interface HostProbe {
  ok: true;
  os?: string;
  hostname?: string;
  kernel?: string;
  cpu?: number;
  memory?: number;
  disk?: number;
  uptimeSeconds?: number;
  memTotalKb?: number;
  diskTotalKb?: number;
  loadavg?: string;
  at: string;
}

export interface DomainProbe {
  ok: true;
  domain: string;
  registrar?: string;
  expiresAt?: string;
  createdAt?: string;
  nameservers: string[];
  dns: string;
  statuses: string[];
  autoRenew?: boolean;
  at: string;
}

export interface CertProbe {
  ok: true;
  cn: string;
  issuer: string;
  validFrom: string;
  expiresAt: string;
  sans: string[];
  serial?: string;
  protocol?: string;
  trusted: boolean;
  untrustedReason?: string;
  at: string;
}

export interface AppInfo {
  platform: NodeJS.Platform;
  version: string;
  electron: string;
  node: string;
  userData: string;
}

export interface PersistedFile extends Snapshot {
  activity?: unknown[];
}

export interface DesktopBridge {
  isDesktop: true;
  info(): Promise<AppInfo>;
  openExternal(url: string): Promise<boolean>;
  store: {
    load(): Promise<PersistedFile | null>;
    save(snapshot: PersistedFile): Promise<boolean>;
  };
  vault: {
    status(): Promise<{ exists: boolean; unlocked: boolean }>;
    create(master: string): Promise<{ ok: true }>;
    unlock(master: string): Promise<{ ok: true }>;
    lock(): Promise<{ ok: true }>;
    set(id: string, secret: SshCredential | AccountCredential): Promise<{ ok: true }>;
    get(id: string): Promise<(SshCredential & AccountCredential) | null>;
    remove(id: string): Promise<{ ok: true }>;
    list(): Promise<string[]>;
  };
  ssh: {
    open(target: SshTarget, size: { cols: number; rows: number }): Promise<{ sessionId: string }>;
    probe(target: SshTarget): Promise<HostProbe>;
    test(target: SshTarget, credential: SshCredential): Promise<{ ok: true; message: string }>;
    close(sessionId: string): Promise<boolean>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    onData(handler: (e: { sessionId: string; chunk: string }) => void): () => void;
    onExit(handler: (e: { sessionId: string }) => void): () => void;
  };
  win: {
    state(): Promise<{ maximized: boolean; platform: NodeJS.Platform }>;
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    onMaximized(handler: (e: { maximized: boolean }) => void): () => void;
  };
  domain: { probe(name: string): Promise<DomainProbe> };
  cert: { probe(host: string, port?: number, servername?: string): Promise<CertProbe> };
}

declare global {
  interface Window {
    sinan?: DesktopBridge;
  }
}

/**
 * The desktop bridge, or `null` in a browser.
 *
 * Every caller has to handle `null`: the same UI runs as a web preview where
 * there is no main process to talk to, and the simulated data path stands in.
 */
export function desktop(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.sinan ?? null;
}

export const isDesktop = () => desktop() !== null;

/** Vault key for a server's SSH credential — must match the main process. */
export const credentialId = (serverId: string) => `ssh:${serverId}`;

/** Vault key for an asset's account login. Namespaced apart from SSH keys. */
export const accountId = (assetId: string) => `account:${assetId}`;

/** "47 天" / "3 小时" — the shape the cards already print. */
export function formatUptime(seconds?: number): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  const days = Math.floor(seconds / 86_400);
  if (days >= 1) return `${days} 天`;
  const hours = Math.floor(seconds / 3_600);
  if (hours >= 1) return `${hours} 小时`;
  return `${Math.max(1, Math.floor(seconds / 60))} 分钟`;
}
