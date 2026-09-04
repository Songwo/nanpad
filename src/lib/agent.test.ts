import assert from "node:assert/strict";
import { test } from "node:test";
import { ask, type Block } from "./agent.ts";
import type { Snapshot } from "./types.ts";

const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const SNAPSHOT: Snapshot = {
  servers: [
    {
      id: "srv1",
      name: "腾讯云4H4G",
      label: "腾讯云4H4G",
      host: "114.132.231.98",
      port: 22,
      username: "ubuntu",
      os: "Ubuntu 24.04 LTS",
      region: "深圳",
      tags: ["生产"],
      status: "online",
      cpu: 1,
      memory: 54,
      disk: 66,
      uptime: "186 天",
      lastSeen: iso(0),
      notes: "",
    },
  ],
  domains: [
    {
      id: "dom1",
      name: "example.com",
      registrar: "Cloudflare",
      expiresAt: iso(12),
      dns: "Cloudflare",
      nameservers: [],
      autoRenew: false,
      status: "warning",
      tags: [],
      notes: "",
    },
  ],
  mailboxes: [
    {
      id: "mail1",
      address: "zhaoqsnyah@163.com",
      domain: "163.com",
      kind: "mailbox",
      usedMb: 0,
      quotaMb: 5120,
      status: "online",
      tags: ["网易"],
      notes: "",
    },
    {
      id: "mail2",
      address: "billing@example.com",
      domain: "example.com",
      kind: "mailbox",
      usedMb: 10,
      quotaMb: 1024,
      status: "online",
      tags: [],
      notes: "",
    },
  ],
  aiAssets: [
    {
      id: "ai1",
      name: "Claude Pro",
      provider: "Anthropic",
      plan: "Pro",
      keyHint: "",
      monthlyUsd: 20,
      usagePct: 41,
      renewsAt: iso(9),
      status: "online",
      tags: [],
      notes: "",
    },
  ],
  secrets: [],
  certs: [],
};

const types = (blocks: Block[]) => blocks.map((b) => b.type);
const firstText = (blocks: Block[]) => {
  const b = blocks.find((x) => x.type === "text");
  return b?.type === "text" ? b.text : "";
};

test("a partial Chinese name still finds the host", () => {
  const { blocks } = ask("连一下腾讯云", SNAPSHOT);
  const action = blocks.find((b) => b.type === "action");
  assert.equal(action?.type === "action" && action.assetId, "srv1");
});

test("password question resolves the named mailbox and returns a reference", () => {
  const { blocks, needsVault } = ask("我 163 那个邮箱的密码是多少", SNAPSHOT);
  const secret = blocks.find((b) => b.type === "secret");
  assert.ok(secret && secret.type === "secret");
  assert.equal(secret.assetId, "mail1");
  assert.equal(secret.field, "password");
  assert.equal(needsVault, true);
});

test("the answer never carries a secret value, only a reference", () => {
  const { blocks } = ask("billing 的密码", SNAPSHOT);
  const secret = blocks.find((b) => b.type === "secret");
  assert.ok(secret && secret.type === "secret");
  assert.equal(secret.assetId, "mail2");
  assert.deepEqual(Object.keys(secret).sort(), ["assetId", "field", "kind", "label", "type"]);
});

test("「这个月」 narrows the expiry window to 30 days", () => {
  const { blocks } = ask("这个月有什么要到期的", SNAPSHOT);
  assert.match(firstText(blocks), /30 天内/);
  const rows = blocks.find((b) => b.type === "rows");
  assert.ok(rows && rows.type === "rows" && rows.rows.length === 2);
});

test("spend adds up the subscriptions", () => {
  const { blocks } = ask("AI 一个月花多少钱", SNAPSHOT);
  assert.match(firstText(blocks), /1 个订阅/);
  assert.match(firstText(blocks), /20/);
});

test("host status reports the real numbers", () => {
  const { blocks } = ask("腾讯云 现在 CPU 多少", SNAPSHOT);
  assert.match(firstText(blocks), /CPU 1%/);
});

test("attention is empty when everything is fine except a warning domain", () => {
  const { blocks } = ask("有什么需要处理的", SNAPSHOT);
  const rows = blocks.find((b) => b.type === "rows");
  assert.ok(rows && rows.type === "rows");
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].assetId, "dom1");
});

test("an unrecognised question offers examples rather than guessing", () => {
  const { blocks } = ask("今天天气怎么样", SNAPSHOT);
  assert.deepEqual(types(blocks), ["text", "rows"]);
});

test("an empty question is not an error", () => {
  const { blocks, needsVault } = ask("   ", SNAPSHOT);
  assert.equal(needsVault, false);
  assert.equal(types(blocks).length, 1);
});
