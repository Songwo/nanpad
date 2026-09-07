import type { AssetKind } from "./types";
import { t } from "./i18n.ts";

/**
 * What a pasted blob turned out to be.
 *
 * `fields` uses composer form keys, so applying a match is a plain merge into
 * the form state — including the `_`-prefixed keys that route to the vault.
 */
export interface PasteMatch {
  id: string;
  kind: AssetKind;
  label: string;
  detail: string;
  fields: Record<string, string>;
  /** Higher wins when several detectors fire on the same text. */
  score: number;
}

/** Vendors worth recognising by key prefix, newest formats first. */
const KEY_SIGNATURES: Array<{
  test: RegExp;
  provider: string;
  kind: "api" | "token";
  name: string;
}> = [
  { test: /^sk-ant-[\w-]{20,}$/, provider: "Anthropic", kind: "api", name: "Anthropic API" },
  { test: /^sk-proj-[\w-]{20,}$/, provider: "OpenAI", kind: "api", name: "OpenAI API" },
  { test: /^sk-[A-Za-z0-9]{20,}$/, provider: "OpenAI", kind: "api", name: "OpenAI API" },
  { test: /^xai-[A-Za-z0-9]{20,}$/, provider: "xAI", kind: "api", name: "xAI API" },
  { test: /^github_pat_[\w]{20,}$/, provider: "GitHub", kind: "token", name: "GitHub PAT" },
  { test: /^ghp_[A-Za-z0-9]{30,}$/, provider: "GitHub", kind: "token", name: "GitHub PAT" },
  { test: /^gho_[A-Za-z0-9]{30,}$/, provider: "GitHub", kind: "token", name: "GitHub OAuth" },
  { test: /^glpat-[\w-]{15,}$/, provider: "GitLab", kind: "token", name: "GitLab Token" },
  { test: /^AKIA[0-9A-Z]{12,}$/, provider: "AWS", kind: "api", name: "AWS Access Key" },
  { test: /^xox[baprs]-[\w-]{10,}$/, provider: "Slack", kind: "token", name: "Slack Token" },
  { test: /^sk_live_[A-Za-z0-9]{20,}$/, provider: "Stripe", kind: "api", name: "Stripe Live" },
  { test: /^sk_test_[A-Za-z0-9]{20,}$/, provider: "Stripe", kind: "api", name: "Stripe Test" },
  { test: /^dop_v1_[a-f0-9]{40,}$/, provider: "DigitalOcean", kind: "api", name: "DigitalOcean" },
  { test: /^AIza[\w-]{30,}$/, provider: "Google", kind: "api", name: "Google API" },
];

const PRIVATE_KEY = /-----BEGIN ((?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY)-----[\s\S]+?-----END \1-----/;
const CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;

/**
 * What each form can usefully absorb, and the hint it advertises.
 *
 * Offering to parse an `ssh` command on the mailbox form is noise: the
 * detectors are cheap, but the *promise* has to match the form you are looking
 * at, so each kind declares its own repertoire.
 */
export const PASTE_HINTS: Record<AssetKind, { detectors: string[]; hint: string }> = {
  server: {
    detectors: ["ssh-config", "ssh-command", "private-key", "host-port"],
    hint: "SSH 命令 · ssh config 片段 · 私钥",
  },
  domain: {
    detectors: ["url", "certificate", "host-port"],
    hint: "网址 · 证书 PEM",
  },
  mail: {
    detectors: ["mailbox", "mail-settings", "url"],
    hint: "邮箱地址 · IMAP/SMTP 设置 · 网址",
  },
  ai: {
    detectors: ["api-key", "url"],
    hint: "API Key · 控制台网址",
  },
  secret: {
    detectors: ["api-key", "private-key"],
    hint: "API Key · Token · 私钥",
  },
  cert: {
    detectors: ["certificate", "url", "host-port"],
    hint: "证书 PEM · 网址",
  },
};

/**
 * Read whatever is on the clipboard and work out what kind of asset it is.
 *
 * Ordered best-first. Several detectors can fire on one blob — an SSH config
 * block carries a host *and* an identity file — so the caller shows the top
 * match and lets the rest be picked from a list. Pass `kind` to keep the
 * results to what that form can actually use.
 */
export function parsePaste(raw: string, kind?: AssetKind): PasteMatch[] {
  const text = raw.trim();
  if (!text) return [];
  const out: PasteMatch[] = [];

  const sshConfig = matchSshConfig(text);
  if (sshConfig) out.push(sshConfig);

  const sshCommand = matchSshCommand(text);
  if (sshCommand) out.push(sshCommand);

  const privateKey = PRIVATE_KEY.exec(text);
  if (privateKey) {
    out.push({
      id: "private-key",
      kind: "server",
      label: t("SSH 私钥"),
      detail: `${privateKey[1]}${/ENCRYPTED/.test(text) ? t(" · 已加密，需要口令") : ""}`,
      fields: { _authKind: "key", _privateKey: privateKey[0] },
      score: 90,
    });
  }

  const certificate = CERTIFICATE.exec(text);
  if (certificate) {
    out.push({
      id: "certificate",
      kind: "cert",
      label: t("证书 PEM"),
      detail: t("解析签发者、有效期与 SAN"),
      // The real parse needs X.509, which lives in the main process.
      fields: { _pem: certificate[0] },
      score: 88,
    });
  }

  const key = matchApiKey(text);
  if (key) out.push(key);

  const mailbox = matchMailbox(text);
  if (mailbox) out.push(mailbox);

  const url = matchUrl(text);
  if (url) out.push(url);

  const endpoint = matchHostPort(text);
  if (endpoint) out.push(endpoint);

  const mailSettings = matchMailSettings(text);
  if (mailSettings) out.push(mailSettings);

  const allowed = kind ? new Set(PASTE_HINTS[kind].detectors) : null;
  return out
    .filter((m) => !allowed || allowed.has(m.id))
    .sort((a, b) => b.score - a.score);
}

/** An IMAP/SMTP block copied out of a provider's help page or a mail client. */
function matchMailSettings(text: string): PasteMatch | null {
  const pick = (re: RegExp) => re.exec(text)?.[1]?.trim();
  const imap = pick(/IMAP[^\r\n]*?([\w.-]+\.[\w.-]+)/i);
  const smtp = pick(/SMTP[^\r\n]*?([\w.-]+\.[\w.-]+)/i);
  const address = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(text)?.[0];
  if (!imap && !smtp) return null;

  return {
    id: "mail-settings",
    kind: "mail",
    label: t("邮箱服务器设置"),
    detail: [imap && `IMAP ${imap}`, smtp && `SMTP ${smtp}`].filter(Boolean).join(" · "),
    fields: {
      ...(address ? { address, domain: address.split("@")[1] ?? "", _username: address } : {}),
      notes: [imap && `IMAP: ${imap}`, smtp && `SMTP: ${smtp}`].filter(Boolean).join("\n"),
    },
    score: 80,
  };
}

/** Flags that swallow the next token, so it is never mistaken for the host. */
const SSH_VALUE_FLAGS = new Set(["-p", "-i", "-l", "-o", "-J", "-F", "-b", "-c", "-D", "-L", "-R", "-w"]);

/** `ssh -p 2222 ubuntu@10.0.0.1`, `ssh -i key.pem host -l user`, and friends. */
function matchSshCommand(text: string): PasteMatch | null {
  const line = text.split(/\r?\n/).find((l) => /(^|\s)ssh(\s|$)/.test(l));
  if (!line) return null;

  // Walking the tokens beats one big regex here: `-p 2222 host` and
  // `-i key host` both put a bare word right after a flag, and a pattern that
  // lazily skips flags happily returns "-p" as the hostname.
  const tokens = line.trim().split(/\s+/);
  const start = tokens.findIndex((t) => t === "ssh" || t.endsWith("/ssh"));
  if (start === -1) return null;

  let port: string | undefined;
  let flagUser: string | undefined;
  let identity: string | undefined;
  let target: string | undefined;

  for (let i = start + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (SSH_VALUE_FLAGS.has(token)) {
      const value = tokens[i + 1];
      i += 1;
      if (token === "-p") port = value;
      else if (token === "-l") flagUser = value;
      else if (token === "-i") identity = value;
      continue;
    }
    // Joined short flags (`-p2222`) and any long option.
    if (token.startsWith("-")) {
      const joined = /^-p(\d{1,5})$/.exec(token);
      if (joined) port = joined[1];
      continue;
    }
    if (!target) target = token;
  }

  if (!target) return null;
  const at = target.lastIndexOf("@");
  const username = at === -1 ? flagUser : target.slice(0, at);
  const host = at === -1 ? target : target.slice(at + 1);
  if (!host || !/^[\w.-]+$/.test(host)) return null;

  return {
    id: "ssh-command",
    kind: "server",
    label: t("SSH 连接命令"),
    detail: [username && t("用户 {0}", username), t("主机 {0}", host), port && t("端口 {0}", port)]
      .filter(Boolean)
      .join(" · "),
    fields: {
      host,
      name: host,
      ...(username ? { username } : {}),
      ...(port ? { port } : {}),
      ...(identity ? { _authKind: "key", _privateKeyPath: identity } : {}),
    },
    score: 95,
  };
}

/** A `Host …` stanza copied out of `~/.ssh/config`. */
function matchSshConfig(text: string): PasteMatch | null {
  if (!/^\s*Host\s+\S+/im.test(text)) return null;
  const pick = (key: string) =>
    new RegExp(`^\\s*${key}\\s+(.+)$`, "im").exec(text)?.[1]?.trim();

  const alias = pick("Host");
  const host = pick("HostName") ?? pick("Hostname");
  if (!host) return null;

  const username = pick("User");
  const port = pick("Port");
  const identity = pick("IdentityFile");

  return {
    id: "ssh-config",
    kind: "server",
    label: t("SSH config 片段"),
    detail: [alias && t("别名 {0}", alias), t("主机 {0}", host), username && t("用户 {0}", username)]
      .filter(Boolean)
      .join(" · "),
    fields: {
      host,
      name: alias ?? host,
      ...(alias ? { label: alias } : {}),
      ...(username ? { username } : {}),
      ...(port ? { port } : {}),
      ...(identity ? { _authKind: "key", _privateKeyPath: identity } : {}),
    },
    score: 97,
  };
}

function matchApiKey(text: string): PasteMatch | null {
  // Keys usually arrive attached to something — `OPENAI_API_KEY=sk-…`, a JSON
  // value, a shell export — so split on the punctuation that wraps them too.
  const candidate = text
    .split(/[\s"',;]+/)
    .flatMap((token) => {
      const eq = token.lastIndexOf("=");
      const colon = token.lastIndexOf(":");
      const cut = Math.max(eq, colon);
      return cut === -1 ? [token] : [token, token.slice(cut + 1)];
    })
    .find((token) => KEY_SIGNATURES.some((sig) => sig.test.test(token)));
  if (!candidate) return null;
  const sig = KEY_SIGNATURES.find((s) => s.test.test(candidate))!;

  return {
    id: "api-key",
    kind: "secret",
    label: t("{0} 密钥", sig.provider),
    detail: t("识别为 {0}，完整值会存进加密库", sig.name),
    fields: {
      name: sig.name,
      kind: sig.kind,
      hint: `${candidate.slice(0, 8)}…${candidate.slice(-4)}`,
      _password: candidate,
    },
    score: 92,
  };
}

function matchMailbox(text: string): PasteMatch | null {
  const address = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(text)?.[0];
  // An `ssh user@host` line is not a mailbox; require a real TLD-ish tail.
  if (!address || /(^|\s)ssh\s/.test(text)) return null;

  return {
    id: "mailbox",
    kind: "mail",
    label: t("邮箱地址"),
    detail: address,
    fields: { address, domain: address.split("@")[1] ?? "", _username: address },
    score: 70,
  };
}

function matchUrl(text: string): PasteMatch | null {
  const raw = /https?:\/\/[^\s"'<>]+/.exec(text)?.[0];
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return null;
  }
  // Strip one level of subdomain noise for the registrable name.
  const parts = host.split(".");
  const registrable = parts.length > 2 ? parts.slice(-2).join(".") : host;

  return {
    id: "url",
    kind: "domain",
    label: t("网址"),
    detail: t("域名 {0} · 登录地址 {1}", registrable, raw),
    fields: { name: registrable, _url: raw },
    score: 60,
  };
}

function matchHostPort(text: string): PasteMatch | null {
  const line = text.split(/\r?\n/)[0]?.trim() ?? "";
  const m = /^([\w.-]+@)?((?:\d{1,3}\.){3}\d{1,3}|[\w-]+(?:\.[\w-]+)+)(?::(\d{1,5}))?$/.exec(line);
  if (!m) return null;

  // `hello@example.com` is an email, not a login target. Accept the `user@host`
  // shape only when something else marks it as an endpoint — a literal IP, or
  // an explicit port.
  const isIp = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(m[2]);
  if (m[1] && !isIp && !m[3]) return null;

  return {
    id: "host-port",
    kind: "server",
    label: t("主机地址"),
    detail: [m[1]?.replace("@", ""), m[2], m[3]].filter(Boolean).join(" · "),
    fields: {
      host: m[2],
      name: m[2],
      ...(m[1] ? { username: m[1].replace("@", "") } : {}),
      ...(m[3] ? { port: m[3] } : {}),
    },
    score: 55,
  };
}
