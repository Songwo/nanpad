export const DEMO_KNOWLEDGE = `# 星桥商城演示运维手册

本文全部为演示情境，不代表真实监控结果。

## API 高负载处理
hk-api-01 和 hk-api-02 承载星桥商城 API。hk-api-02 示例 CPU 为 84%。先比较两个节点流量与 P95 延迟，再检查慢请求及连接池；计划在低峰期扩容或分流。不要把高 CPU 直接判定为主机离线。

## 数据库备份与恢复
sg-pg-primary 是 PostgreSQL 主库，hz-backup-01 存放备份。目标 RPO 为 15 分钟，RTO 为 60 分钟。每晚 02:00 全量备份，每 15 分钟归档 WAL。恢复顺序：验证 SHA-256 校验和、在隔离环境还原、验证最近订单与库存一致性、经负责人确认后安排切换。不得直接覆盖生产数据库。

## 证书与域名
api.starbridge.example 的证书将在示例日期后 5 天到期，其域名将在 12 天后续费且未开启自动续费。先确认 DNS 验证权限与 ACME 自动续期日志，再完成证书续期验证；域名续费是独立事项。

## 成本治理
生产客服推理预算每月 86 美元，研发编程助手订阅每月 100 美元，本地文档向量化的软件订阅费为 0 美元，不包括主机硬件和电费。合计已记录 AI 月费 186 美元。优先检查闲置席位、模型路由和缓存命中率，不能把样例预算视为真实账单。
`;

export function demoSnapshot(now = Date.now()) {
  const date = (days) => new Date(now + days * 86400000).toISOString();
  const base = { demo: true, tags: ["演示"], notes: "演示资产，不连接真实基础设施。" };
  const servers = [
    ["hk-api-01", "香港 API 主节点", "香港", "production", 38, 62, 46],
    ["hk-api-02", "香港 API 副节点", "香港", "production", 84, 78, 51],
    ["sg-pg-primary", "新加坡 PostgreSQL 主库", "新加坡", "database", 31, 74, 81],
    ["sg-redis-01", "新加坡缓存节点", "新加坡", "cache", 12, 56, 19],
    ["sh-staging-01", "上海预发环境", "上海", "staging", 7, 28, 34],
    ["hz-backup-01", "杭州异地备份", "杭州", "backup", 6, 22, 68],
  ].map(([name, label, region, group, cpu, memory, disk], i) => ({
    ...base,
    id: `demo-server-${i}`,
    name,
    label,
    region,
    host: `192.0.2.${10 + i}`,
    port: 22,
    username: "deploy",
    os: "Ubuntu 24.04 LTS",
    tags: ["演示", "星桥商城", group],
    status: i === 1 || i === 2 ? "warning" : "online",
    cpu,
    memory,
    disk,
    uptime: `${18 + i * 13} 天`,
    lastSeen: date(-0.002),
  }));
  const domains = [
    ["starbridge.example", 210, true],
    ["api.starbridge.example", 12, false],
    ["status.starbridge.example", 95, true],
    ["staging.starbridge.example", 7, false],
  ].map(([name, days, autoRenew], i) => ({
    ...base,
    id: `demo-domain-${i}`,
    name,
    registrar: "Cloudflare Registrar",
    expiresAt: date(days),
    dns: "Cloudflare DNS",
    nameservers: ["ns1.example", "ns2.example"],
    autoRenew,
    status: days < 21 ? "warning" : "online",
    tags: ["演示", "星桥商城", i === 3 ? "staging" : "production"],
  }));
  const certs = domains
    .slice(0, 3)
    .map((d, i) => ({
      ...base,
      id: `demo-cert-${i}`,
      cn: d.name,
      host: d.name,
      issuer: "Let's Encrypt",
      expiresAt: date([54, 5, 36][i]),
      sans: [d.name],
      status: i === 1 ? "warning" : "online",
      tags: [...d.tags],
    }));
  const mailboxes = ["ops", "billing", "support"].map((name, i) => ({
    ...base,
    id: `demo-mail-${i}`,
    address: `${name}@starbridge.example`,
    domain: "starbridge.example",
    kind: "mailbox",
    usedMb: [1850, 820, 9300][i],
    quotaMb: 10240,
    status: i === 2 ? "warning" : "online",
    tags: ["演示", "星桥商城", "team"],
  }));
  const aiAssets = [
    ["生产客服推理", "OpenAI compatible", "按量计费", 86, 72, 18],
    ["研发编程助手", "Anthropic", "团队订阅", 100, 48, 9],
    ["文档向量化", "Ollama", "本地部署", 0, 24, 365],
  ].map(([name, provider, plan, monthlyUsd, usagePct, days], i) => ({
    ...base,
    id: `demo-ai-${i}`,
    name,
    provider,
    plan,
    monthlyUsd,
    usagePct,
    renewsAt: date(days),
    keyHint: "未配置凭据",
    status: days < 14 ? "warning" : "online",
    tags: ["演示", "星桥商城", "ai"],
  }));
  const secrets = ["CI 发布令牌", "数据库只读账号", "备份服务凭据"].map((name, i) => ({
    ...base,
    id: `demo-secret-${i}`,
    name,
    kind: "token",
    hint: "演示引用，无密钥值",
    value: "",
    lastRotated: date(-[24, 65, 110][i]),
    status: i === 2 ? "warning" : "online",
    tags: ["演示", "星桥商城", "credentials"],
  }));
  const link = (a, b) => ({
    from: { kind: a[0], id: `demo-${a[0]}-${a[1]}` },
    to: { kind: b[0], id: `demo-${b[0]}-${b[1]}` },
  });
  const links = [
    link(["domain", 0], ["server", 0]),
    link(["domain", 1], ["server", 1]),
    link(["server", 0], ["server", 2]),
    link(["server", 1], ["server", 3]),
    link(["server", 2], ["server", 5]),
    link(["domain", 3], ["server", 4]),
    ...certs.map((_, i) => link(["domain", i], ["cert", i])),
    link(["server", 0], ["ai", 0]),
    link(["server", 2], ["secret", 1]),
    link(["server", 5], ["secret", 2]),
    link(["domain", 0], ["mail", 0]),
  ];
  return { servers, domains, certs, mailboxes, aiAssets, secrets, links };
}

export function mergeDemo(snapshot, now) {
  const demo = demoSnapshot(now);
  const next = { ...snapshot };
  for (const key of ["servers", "domains", "certs", "mailboxes", "aiAssets", "secrets"]) {
    const existing = Array.isArray(snapshot[key]) ? snapshot[key] : [];
    next[key] = [...existing, ...demo[key].filter((row) => !existing.some((x) => x.id === row.id))];
  }
  const links = snapshot.links ?? [];
  next.links = [
    ...links,
    ...demo.links.filter((link) => !links.some((x) => JSON.stringify(x) === JSON.stringify(link))),
  ];
  return next;
}
