import assert from "node:assert/strict";
import test from "node:test";
import { mergeSnapshotChange } from "../src/lib/snapshot-merge.ts";

const fixture = () => ({
  servers: [{ id: "host", name: "主机", cpu: 10 }],
  domains: [],
  mailboxes: [],
  aiAssets: [],
  certs: [],
  secrets: [{ id: "account", name: "旧名称", tags: ["个人"] }],
  links: [],
});
test("AI 账号重命名不会覆盖并发采集或账号其他字段的编辑", () => {
  const before = fixture(),
    snapshot = structuredClone(before),
    current = structuredClone(before);
  snapshot.secrets[0].name = "新名称";
  current.servers[0].cpu = 81;
  current.secrets[0].tags = ["本地刚编辑"];
  const merged = mergeSnapshotChange(current, { before, snapshot });
  assert.equal(merged.servers[0].cpu, 81);
  assert.deepEqual(merged.secrets[0], { id: "account", name: "新名称", tags: ["本地刚编辑"] });
  assert.deepEqual(
    mergeSnapshotChange(merged, { before, snapshot }),
    merged,
    "事件和响应重复送达应幂等",
  );
});
test("迟到的提案结果保留本地同字段编辑和删除，不恢复已删除资产", () => {
  const before = fixture(),
    snapshot = structuredClone(before),
    current = structuredClone(before);
  snapshot.secrets[0].name = "AI 名称";
  current.secrets[0].name = "用户新名称";
  assert.equal(mergeSnapshotChange(current, { before, snapshot }).secrets[0].name, "用户新名称");
  current.secrets = [];
  assert.deepEqual(mergeSnapshotChange(current, { before, snapshot }).secrets, []);
});
test("两处同时添加不同关联时均保留，解除关联不会被旧响应恢复", () => {
  const before = fixture(),
    snapshot = structuredClone(before),
    current = structuredClone(before);
  const first = { from: { kind: "server", id: "host" }, to: { kind: "secret", id: "account" } };
  const second = { from: { kind: "server", id: "host" }, to: { kind: "domain", id: "domain" } };
  snapshot.links = [first];
  current.links = [second];
  assert.deepEqual(mergeSnapshotChange(current, { before, snapshot }).links, [second, first]);
  before.links = [first];
  snapshot.links = [first, second];
  current.links = [];
  assert.deepEqual(mergeSnapshotChange(current, { before, snapshot }).links, [second]);
});
test("远端删除仅作用于本地未修改的项目，添加资料按 ID 合并", () => {
  const before = fixture(),
    snapshot = structuredClone(before),
    current = structuredClone(before);
  snapshot.servers = [];
  snapshot.secrets.push({ id: "new", name: "新增" });
  current.servers[0].name = "正在编辑的主机";
  const merged = mergeSnapshotChange(current, { before, snapshot });
  assert.equal(merged.servers[0].name, "正在编辑的主机");
  assert.equal(merged.secrets.length, 2);
  assert.deepEqual(mergeSnapshotChange(before, { before, snapshot }).servers, []);
});
