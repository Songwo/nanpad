import { ImapFlow } from "imapflow";

/**
 * IMAP/SMTP endpoints for the providers people actually have.
 *
 * `authNote` is what the provider calls the thing you paste — none of the big
 * Chinese providers accept your login password over IMAP, they issue a separate
 * 授权码, and telling people that up front saves a failed attempt.
 */
export const MAIL_PROVIDERS = {
  qq: {
    label: "QQ 邮箱",
    imap: { host: "imap.qq.com", port: 993 },
    smtp: { host: "smtp.qq.com", port: 465 },
    domains: ["qq.com", "foxmail.com", "vip.qq.com"],
    authNote: "在 QQ 邮箱设置 → 账号中开启 IMAP 服务，用生成的授权码而不是登录密码。",
  },
  "163": {
    label: "网易 163",
    imap: { host: "imap.163.com", port: 993 },
    smtp: { host: "smtp.163.com", port: 465 },
    domains: ["163.com"],
    authNote: "在 163 邮箱设置 → POP3/SMTP/IMAP 中开启 IMAP，用客户端授权码。",
  },
  "126": {
    label: "网易 126",
    imap: { host: "imap.126.com", port: 993 },
    smtp: { host: "smtp.126.com", port: 465 },
    domains: ["126.com"],
    authNote: "在 126 邮箱设置中开启 IMAP，用客户端授权码。",
  },
  gmail: {
    label: "Gmail",
    imap: { host: "imap.gmail.com", port: 993 },
    smtp: { host: "smtp.gmail.com", port: 465 },
    domains: ["gmail.com", "googlemail.com"],
    authNote: "开启两步验证后生成「应用专用密码」；普通账号密码会被拒绝。",
  },
  outlook: {
    label: "Outlook / Microsoft",
    imap: { host: "outlook.office365.com", port: 993 },
    smtp: { host: "smtp.office365.com", port: 587 },
    domains: ["outlook.com", "hotmail.com", "live.com"],
    authNote: "个人账号需要应用密码；企业账号可能已被管理员禁用基本身份验证。",
  },
  icloud: {
    label: "iCloud",
    imap: { host: "imap.mail.me.com", port: 993 },
    smtp: { host: "smtp.mail.me.com", port: 587 },
    domains: ["icloud.com", "me.com"],
    authNote: "在 Apple ID 页面生成 App 专用密码。",
  },
};

/** Best-guess provider for an address, so the form fills itself in. */
export function providerForAddress(address) {
  const domain = String(address).split("@")[1]?.toLowerCase();
  if (!domain) return null;
  for (const [id, p] of Object.entries(MAIL_PROVIDERS)) {
    if (p.domains.includes(domain)) return { id, ...p };
  }
  return null;
}

/**
 * Actually log in, and report what the account looks like.
 *
 * This is the whole point of "快捷登录": the credential is proven to work
 * before it is stored, and the quota and folder counts come back from the
 * server rather than being typed in from memory.
 */
export async function testMailbox({ address, password, host, port, secure = true }) {
  if (!address || !password) throw new Error("请填写邮箱地址与密码 / 授权码");

  const guess = providerForAddress(address);
  const imapHost = host || guess?.imap.host;
  const imapPort = Number(port) || guess?.imap.port || 993;
  if (!imapHost) throw new Error("认不出这个邮箱的服务商，请手动填写 IMAP 地址");

  const client = new ImapFlow({
    host: imapHost,
    port: imapPort,
    secure,
    auth: { user: address, pass: password },
    logger: false,
    // 163/126 reject clients that never introduce themselves — the server
    // answers "Unsafe Login" and the failure looks like a wrong password.
    clientInfo: { name: "Nanpad", version: "0.1.0", vendor: "Nanpad" },
    socketTimeout: 20_000,
    greetingTimeout: 12_000,
  });

  try {
    await client.connect();
  } catch (err) {
    throw new Error(friendlyImap(err, guess));
  }

  try {
    const status = await client.status("INBOX", { messages: true, unseen: true });
    let quota = null;
    try {
      const q = await client.getQuota("INBOX");
      if (q && q.storage) {
        quota = {
          usedMb: Math.round((q.storage.usage ?? 0) / 1024),
          quotaMb: Math.round((q.storage.limit ?? 0) / 1024),
        };
      }
    } catch {
      // Plenty of servers do not implement QUOTA; the login still succeeded.
    }

    return {
      ok: true,
      address,
      provider: guess?.id ?? null,
      providerLabel: guess?.label ?? imapHost,
      imap: { host: imapHost, port: imapPort },
      smtp: guess?.smtp ?? null,
      messages: status.messages ?? 0,
      unseen: status.unseen ?? 0,
      ...(quota ?? {}),
      at: new Date().toISOString(),
    };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** IMAP failures are terse and often misleading; say what actually happened. */
function friendlyImap(err, guess) {
  const msg = String(err?.responseText ?? err?.message ?? err);
  if (/Unsafe Login|unsafe/i.test(msg)) {
    return "服务器拒绝了这次登录（Unsafe Login）。163/126 需要在设置里开启 IMAP 并使用客户端授权码。";
  }
  // QQ answers with a paragraph of English covering six possible causes at
  // once; for a third-party client it is almost always the same two.
  if (
    /AUTHENTICATIONFAILED|Invalid credentials|LOGIN fail|Login fail|auth|Account is abnormal|service is not open/i.test(
      msg,
    )
  ) {
    return guess?.authNote
      ? `登录被拒绝。${guess.authNote}`
      : "登录被拒绝：地址或密码 / 授权码不正确。";
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return "无法解析 IMAP 服务器地址";
  if (/ECONNREFUSED/i.test(msg)) return "连接被拒绝：IMAP 端口不对或服务未开启";
  if (/ETIMEDOUT|timeout/i.test(msg)) return "连接超时：网络不可达，或被防火墙拦截";
  if (/certificate|self.signed/i.test(msg)) return "TLS 证书校验失败";
  return msg;
}
