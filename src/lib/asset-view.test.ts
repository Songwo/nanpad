import assert from "node:assert/strict";
import { test } from "node:test";
import { assetRows, filterAssetRows, assetGraph } from "./asset-view.ts";
import type { Snapshot } from "./types.ts";

const snapshot: Snapshot = {
  servers: [
    {
      id: "shared",
      name: "Host 10",
      host: "127.0.0.1",
      username: "qa",
      port: 22,
      label: "Production",
      os: "Linux",
      region: "Local",
      cpu: 9,
      memory: 30,
      disk: 40,
      tags: ["prod", "web"],
      status: "online",
      uptime: "1d",
      notes: "private-note",
      lastSeen: "2026-09-07",
    },
  ],
  domains: [
    {
      id: "shared",
      name: "example.test",
      registrar: "QA",
      expiresAt: "2026-09-10",
      dns: "dns.test",
      nameservers: [],
      autoRenew: false,
      tags: ["prod"],
      status: "warning",
      notes: "private-note",
    },
  ],
  secrets: [
    {
      id: "secret",
      name: "Token",
      kind: "api",
      hint: "hidden",
      value: "do-not-leak",
      lastRotated: "2026-09-07",
      tags: [],
      status: "online",
      notes: "private-note",
    },
  ],
  mailboxes: [],
  aiAssets: [],
  certs: [],
  links: [{ from: { kind: "domain", id: "shared" }, to: { kind: "server", id: "shared" } }],
};

test("表格跨类型保留同 ID 资产，数字保留数值，不读取密钥内容", () => {
  const rows = assetRows(snapshot);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].cpu, 9);
  assert.ok(!JSON.stringify(rows).includes("do-not-leak"));
  assert.ok(!JSON.stringify(rows).includes("private-note"));
});
test("类型、搜索、状态与多个标签共同筛选", () => {
  const rows = assetRows(snapshot);
  assert.equal(filterAssetRows(rows, "servers", "linux", false, ["prod", "web"]).length, 1);
  assert.equal(filterAssetRows(rows, "overview", "", true, ["prod"])[0].kind, "domain");
  assert.equal(filterAssetRows(rows, "servers", "", true, []).length, 0);
  assert.equal(filterAssetRows(rows, "domains", "HOST", false, []).length, 0);
});
test("关系图只连接可见的已保存关联，节点 ID 和位置不冲突", () => {
  const rows = assetRows(snapshot);
  const graph = assetGraph(rows, snapshot.links);
  assert.equal(new Set(graph.nodes.map((node) => node.id)).size, 3);
  assert.equal(new Set(graph.nodes.map((node) => JSON.stringify(node.position))).size, 3);
  assert.equal(graph.edges.length, 1);
  assert.equal(
    assetGraph(
      rows.filter((row) => row.kind === "server"),
      snapshot.links,
    ).edges.length,
    0,
  );
  assert.equal(assetGraph(rows, []).edges.length, 0);
  const vertical = assetGraph(rows, snapshot.links, true);
  assert.equal(vertical.nodes[0].position.x, vertical.nodes[1].position.x);
  assert.notEqual(vertical.nodes[0].position.y, vertical.nodes[1].position.y);
});
