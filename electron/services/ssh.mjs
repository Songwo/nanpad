import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import ssh2 from "ssh2";

const { Client } = ssh2;

const CONNECT_TIMEOUT = 15_000;
const PROBE_TIMEOUT = 20_000;

/**
 * One shell script, one round trip, `key=value` back.
 *
 * CPU is sampled from two reads of /proc/stat 400ms apart rather than `top`,
 * which is slow, non-uniform across distros, and reports the wrong thing on the
 * first sample anyway. Everything degrades to an empty value instead of failing
 * the whole probe, so a BSD box still reports what it can.
 */
const PROBE_SCRIPT = `
set +e
os=$( . /etc/os-release 2>/dev/null; printf '%s' "\${PRETTY_NAME:-$(uname -s) $(uname -r)}" )
printf 'os=%s\\n' "$os"
printf 'host=%s\\n' "$(hostname 2>/dev/null)"
printf 'kernel=%s\\n' "$(uname -r 2>/dev/null)"

if [ -r /proc/uptime ]; then
  printf 'uptime=%s\\n' "$(cut -d' ' -f1 /proc/uptime | cut -d. -f1)"
fi

if [ -r /proc/stat ]; then
  read _cpu a b c d e f g _rest < /proc/stat
  t1=$((a+b+c+d+e+f+g)); i1=$d
  sleep 0.4
  read _cpu a b c d e f g _rest < /proc/stat
  t2=$((a+b+c+d+e+f+g)); i2=$d
  dt=$((t2-t1)); di=$((i2-i1))
  [ "$dt" -gt 0 ] && printf 'cpu=%s\\n' "$(( (100*(dt-di)) / dt ))"
fi

if [ -r /proc/meminfo ]; then
  total=$(awk '/^MemTotal:/{print $2}' /proc/meminfo)
  avail=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
  [ -z "$avail" ] && avail=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
  [ -n "$total" ] && [ "$total" -gt 0 ] && printf 'memory=%s\\nmemTotalKb=%s\\n' "$(( (100*(total-avail))/total ))" "$total"
fi

df -Pk / 2>/dev/null | awk 'NR==2 {gsub("%","",$5); printf "disk=%s\\ndiskTotalKb=%s\\n", $5, $2}'
printf 'loadavg=%s\\n' "$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
`;

/**
 * Live SSH connections, keyed by session id.
 *
 * Interactive shells and one-shot probes both go through here so a host is
 * never connected twice for the same click; probes open their own short-lived
 * connection because a shell channel is the user's, not ours.
 */
export class SshManager {
  /** @type {Map<string, {client: import("ssh2").Client, stream: any, serverId: string}>} */
  #sessions = new Map();
  #emit;

  constructor(emit) {
    this.#emit = emit;
  }

  async #connect(target, credential) {
    const config = {
      host: target.host,
      port: target.port || 22,
      username: target.username,
      readyTimeout: CONNECT_TIMEOUT,
      keepaliveInterval: 20_000,
      // Older boxes still hand out ssh-rsa host keys; refusing them outright
      // would make the app useless against exactly the servers people keep.
      algorithms: { serverHostKey: ["ssh-ed25519", "ecdsa-sha2-nistp256", "rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"] },
    };

    if (!credential) throw new Error("没有找到该主机的凭据，请先在密钥库中保存");

    if (credential.kind === "password") {
      if (!credential.password) throw new Error("凭据缺少密码");
      config.password = credential.password;
    } else if (credential.kind === "key") {
      const key = credential.privateKey ?? (credential.privateKeyPath ? await readFile(credential.privateKeyPath, "utf8") : null);
      if (!key) throw new Error("凭据缺少私钥");
      config.privateKey = key;
      if (credential.passphrase) config.passphrase = credential.passphrase;
    } else if (credential.kind === "agent") {
      config.agent = process.env.SSH_AUTH_SOCK || (process.platform === "win32" ? "pageant" : undefined);
      if (!config.agent) throw new Error("找不到 SSH agent");
    } else {
      throw new Error(`不支持的认证方式：${credential.kind}`);
    }

    const client = new Client();
    await new Promise((resolve, reject) => {
      const fail = (err) => {
        client.removeAllListeners();
        reject(new Error(friendly(err)));
      };
      client.once("ready", () => {
        client.removeListener("error", fail);
        resolve();
      });
      client.once("error", fail);
      client.connect(config);
    });
    return client;
  }

  /** Open an interactive PTY. Output is pushed to the renderer as it arrives. */
  async openShell(target, credential, size = { cols: 100, rows: 30 }) {
    const client = await this.#connect(target, credential);
    const sessionId = randomUUID();

    const stream = await new Promise((resolve, reject) => {
      client.shell(
        { term: "xterm-256color", cols: size.cols, rows: size.rows },
        (err, s) => (err ? reject(new Error(friendly(err))) : resolve(s)),
      );
    });

    stream.on("data", (chunk) => this.#emit("ssh:data", { sessionId, chunk: chunk.toString("utf8") }));
    stream.stderr?.on("data", (chunk) => this.#emit("ssh:data", { sessionId, chunk: chunk.toString("utf8") }));
    stream.on("close", () => {
      this.#sessions.delete(sessionId);
      client.end();
      this.#emit("ssh:exit", { sessionId });
    });
    client.on("error", (err) => this.#emit("ssh:data", { sessionId, chunk: `\r\n\x1b[31m${friendly(err)}\x1b[0m\r\n` }));

    this.#sessions.set(sessionId, { client, stream, serverId: target.id });
    return { sessionId };
  }

  write(sessionId, data) {
    this.#sessions.get(sessionId)?.stream.write(data);
  }

  resize(sessionId, cols, rows) {
    this.#sessions.get(sessionId)?.stream.setWindow(rows, cols, 0, 0);
  }

  close(sessionId) {
    const s = this.#sessions.get(sessionId);
    if (!s) return;
    this.#sessions.delete(sessionId);
    try {
      s.stream.end();
    } catch {
      /* already gone */
    }
    s.client.end();
  }

  closeAll() {
    for (const id of [...this.#sessions.keys()]) this.close(id);
  }

  /** Run the metrics script once and hang up. */
  async probe(target, credential) {
    const client = await this.#connect(target, credential);
    try {
      const out = await this.#exec(client, PROBE_SCRIPT, PROBE_TIMEOUT);
      return { ok: true, ...parseProbe(out), at: new Date().toISOString() };
    } finally {
      client.end();
    }
  }

  /** Authenticate, run `true`, hang up — used by the credential form. */
  async test(target, credential) {
    const client = await this.#connect(target, credential);
    try {
      const who = await this.#exec(client, "id -un 2>/dev/null || whoami", 10_000);
      return { ok: true, message: `已连接，登录为 ${who.trim() || target.username}` };
    } finally {
      client.end();
    }
  }

  #exec(client, command, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("命令执行超时")), timeout);
      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          reject(new Error(friendly(err)));
          return;
        }
        let out = "";
        stream.on("data", (d) => (out += d.toString("utf8")));
        stream.stderr.on("data", () => {});
        stream.on("close", () => {
          clearTimeout(timer);
          resolve(out);
        });
      });
    });
  }
}

function parseProbe(text) {
  /** @type {Record<string, string>} */
  const kv = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const num = (k) => {
    const n = Number(kv[k]);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    os: kv.os || undefined,
    hostname: kv.host || undefined,
    kernel: kv.kernel || undefined,
    cpu: clampPct(num("cpu")),
    memory: clampPct(num("memory")),
    disk: clampPct(num("disk")),
    uptimeSeconds: num("uptime"),
    memTotalKb: num("memTotalKb"),
    diskTotalKb: num("diskTotalKb"),
    loadavg: kv.loadavg || undefined,
  };
}

function clampPct(n) {
  if (n === undefined) return undefined;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** ssh2 errors are terse and English; say what actually went wrong. */
function friendly(err) {
  const msg = String(err?.message ?? err);
  if (/All configured authentication methods failed/i.test(msg)) return "认证失败：用户名、密码或私钥不正确";
  if (/ECONNREFUSED/i.test(msg)) return "连接被拒绝：目标端口没有 SSH 服务";
  if (/ETIMEDOUT|Timed out while waiting/i.test(msg)) return "连接超时：主机不可达或被防火墙拦截";
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return "无法解析主机名";
  if (/ECONNRESET/i.test(msg)) return "连接被重置";
  // What a DNS wildcard or a captive proxy looks like: the socket opens, then
  // dies before SSH says hello.
  if (/Connection lost before handshake/i.test(msg)) return "对端未完成 SSH 握手：地址或端口可能不对";
  if (/Handshake failed/i.test(msg)) return "SSH 握手失败：双方没有共同的加密算法";
  if (/Cannot parse privateKey|no matching key format/i.test(msg)) return "私钥格式无法解析（若有口令请一并填写）";
  if (/Encrypted private key detected|passphrase/i.test(msg)) return "私钥已加密，需要填写口令";
  return msg;
}
