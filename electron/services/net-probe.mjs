import { connect as tcpConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { promises as dns } from "node:dns";

const WHOIS_PORT = 43;
const WHOIS_TIMEOUT = 8_000;
const TLS_TIMEOUT = 10_000;

/** One WHOIS round trip. */
function whoisQuery(server, query) {
  return new Promise((resolve, reject) => {
    let out = "";
    const socket = tcpConnect({ host: server, port: WHOIS_PORT });
    socket.setTimeout(WHOIS_TIMEOUT);
    socket.on("connect", () => socket.write(`${query}\r\n`));
    socket.on("data", (d) => (out += d.toString("utf8")));
    socket.on("end", () => resolve(out));
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error(`WHOIS 查询超时：${server}`));
    });
    socket.on("error", (err) => reject(new Error(`WHOIS 连接失败：${err.message}`)));
  });
}

/**
 * Resolve a domain the way a registrar would: ask IANA which server owns the
 * TLD, ask that registry, then follow at most one registrar referral. Two hops
 * is where the useful data lives; more just loops through thin WHOIS proxies.
 */
export async function probeDomain(name) {
  const domain = String(name).trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (!domain || !domain.includes(".")) throw new Error("域名格式不正确");
  const tld = domain.slice(domain.lastIndexOf(".") + 1);

  const ianaText = await whoisQuery("whois.iana.org", tld);
  const registryServer = firstMatch(ianaText, /^\s*whois:\s*(\S+)\s*$/im);
  if (!registryServer) throw new Error(`找不到 .${tld} 的 WHOIS 服务器`);

  let text = await whoisQuery(registryServer, domain);
  const referral = firstMatch(text, /Registrar WHOIS Server:\s*(\S+)/i);
  if (referral && referral.toLowerCase() !== registryServer.toLowerCase()) {
    try {
      const deeper = await whoisQuery(referral, domain);
      // Registrar records are richer, but some return a stub — keep the longer.
      if (deeper.length > text.length / 2) text = `${text}\n${deeper}`;
    } catch {
      /* the registry answer is enough */
    }
  }

  const expiresAt = pickDate(text, [
    /Registry Expiry Date:\s*(\S+)/i,
    /Expiration Date:\s*(\S+)/i,
    /Expiry Date:\s*(\S+)/i,
    /Expiration Time:\s*([^\r\n]+)/i,
    /paid-till:\s*(\S+)/i,
    /renewal date:\s*(\S+)/i,
  ]);
  const createdAt = pickDate(text, [/Creation Date:\s*(\S+)/i, /Registered on:\s*(\S+)/i, /created:\s*(\S+)/i]);

  let nameservers = [...text.matchAll(/Name Server:\s*(\S+)/gi)].map((m) => m[1].toLowerCase());
  if (nameservers.length === 0) {
    nameservers = [...text.matchAll(/^\s*nserver:\s*(\S+)/gim)].map((m) => m[1].toLowerCase());
  }
  // WHOIS can be stale or empty; live NS records are the ground truth.
  try {
    const live = await dns.resolveNs(domain);
    if (live.length) nameservers = live.map((n) => n.toLowerCase());
  } catch {
    /* keep whatever WHOIS gave us */
  }

  const registrar =
    firstMatch(text, /Registrar:\s*([^\r\n]+)/i) ??
    firstMatch(text, /Sponsoring Registrar:\s*([^\r\n]+)/i) ??
    firstMatch(text, /^\s*registrar:\s*([^\r\n]+)/im);

  const statuses = [...text.matchAll(/(?:Domain )?Status:\s*([^\r\n\s]+)/gi)].map((m) => m[1]);

  return {
    ok: true,
    domain,
    registrar: registrar?.trim() || undefined,
    expiresAt,
    createdAt,
    nameservers: [...new Set(nameservers)].sort(),
    dns: guessDnsProvider([...new Set(nameservers)]),
    statuses: [...new Set(statuses)].slice(0, 6),
    autoRenew: /autoRenew/i.test(statuses.join(" ")) || undefined,
    at: new Date().toISOString(),
  };
}

/**
 * Read the certificate a host actually serves.
 *
 * `rejectUnauthorized: false` on purpose: an expired or self-signed cert is
 * exactly the case worth reporting, and refusing the handshake would hide it.
 */
export function probeCertificate(host, port = 443, servername) {
  const target = String(host).trim().replace(/^https?:\/\//, "").split("/")[0];
  const sni = servername ?? target;
  return new Promise((resolve, reject) => {
    const socket = tlsConnect(
      { host: target, port: Number(port) || 443, servername: sni, rejectUnauthorized: false, timeout: TLS_TIMEOUT },
      () => {
        const cert = socket.getPeerCertificate(false);
        const proto = socket.getProtocol();
        const authorized = socket.authorized;
        const reason = socket.authorizationError ? String(socket.authorizationError) : undefined;
        socket.end();
        if (!cert || !cert.valid_to) {
          reject(new Error("对端没有返回证书"));
          return;
        }
        resolve({
          ok: true,
          cn: cert.subject?.CN ?? sni,
          issuer: cert.issuer?.O ?? cert.issuer?.CN ?? "未知签发者",
          validFrom: new Date(cert.valid_from).toISOString(),
          expiresAt: new Date(cert.valid_to).toISOString(),
          sans: (cert.subjectaltname ?? "")
            .split(",")
            .map((s) => s.trim().replace(/^DNS:/, ""))
            .filter(Boolean),
          serial: cert.serialNumber,
          protocol: proto ?? undefined,
          trusted: authorized,
          untrustedReason: reason,
          at: new Date().toISOString(),
        });
      },
    );
    socket.setTimeout(TLS_TIMEOUT, () => {
      socket.destroy();
      reject(new Error("TLS 握手超时"));
    });
    socket.on("error", (err) => reject(new Error(`TLS 连接失败：${err.message}`)));
  });
}

function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1] : null;
}

function pickDate(text, patterns) {
  for (const re of patterns) {
    const raw = firstMatch(text, re);
    if (!raw) continue;
    const d = new Date(raw.trim());
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}

/** Nameserver suffixes say who is actually serving DNS, whatever WHOIS claims. */
function guessDnsProvider(nameservers) {
  const joined = nameservers.join(" ");
  const table = [
    [/cloudflare/i, "Cloudflare"],
    [/awsdns/i, "Route 53"],
    [/alidns|hichina/i, "阿里云 DNS"],
    [/dnspod|qcloud/i, "DNSPod"],
    [/azure-dns/i, "Azure DNS"],
    [/googledomains|google/i, "Google"],
    [/vercel-dns/i, "Vercel"],
    [/namecheap|registrar-servers/i, "Namecheap"],
    [/digitalocean/i, "DigitalOcean"],
    [/he\.net/i, "Hurricane Electric"],
  ];
  for (const [re, label] of table) if (re.test(joined)) return label;
  return nameservers[0]?.split(".").slice(-2).join(".") ?? "未知";
}
