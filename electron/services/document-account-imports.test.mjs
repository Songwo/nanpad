import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "./vault.mjs";
import { DocumentsStore } from "./documents.mjs";
import { DocumentAccountImports } from "./document-account-imports.mjs";

const candidate = {
  id: "candidate-1",
  name: "测试账户",
  url: "https://example.test/login",
  username: "alice",
  password: "synthetic-document-password",
  note: "",
};
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "zhiyu-doc-accounts-"));
  const vault = new Vault(join(dir, "vault.enc"));
  await vault.create("synthetic-master-password");
  const documents = new DocumentsStore(join(dir, "docs"));
  await documents.save({
    id: "doc-synthetic",
    title: "测试资料",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "账号：alice" }] }],
    },
    bindings: [],
  });
  let assets = [];
  let now = Date.now();
  const importer = new DocumentAccountImports({
    vault,
    documents,
    getAssets: () => assets,
    publishAssets: async (next) => {
      assets = [...assets, ...next.filter((x) => !assets.some((a) => a.id === x.id))];
    },
    parse: () => ({ candidates: [candidate], warnings: [] }),
    now: () => now,
  });
  t.after(async () => {
    importer.stop();
    vault.lock();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, vault, documents, importer, assets: () => assets, advance: () => (now += 301000) };
}
test("提取仅预览；确认后加密保存并关联，重导入复用已有账号", async (t) => {
  const s = await setup(t);
  let preview = await s.importer.preview("doc-synthetic");
  assert.deepEqual(await s.vault.list(), []);
  const result = await s.importer.commit({
    ticket: preview.ticket,
    candidates: preview.candidates,
  });
  assert.equal(result.added, 1);
  const asset = result.assets[0];
  assert.equal(JSON.stringify(asset).includes(candidate.password), false);
  assert.equal(
    (await readFile(join(s.dir, "vault.enc"), "utf8")).includes(candidate.password),
    false,
  );
  assert.equal((await s.vault.get(`account:${asset.id}`)).password, candidate.password);
  assert.deepEqual((await s.documents.get("doc-synthetic")).bindings, [
    { kind: "secret", id: asset.id },
  ]);
  preview = await s.importer.preview("doc-synthetic");
  const again = await s.importer.commit({ ticket: preview.ticket, candidates: preview.candidates });
  assert.equal(again.added, 0);
  assert.equal(again.existing, 1);
});
test("同站点多账号和不同密码版本分别保存，不覆盖旧密码", async (t) => {
  const s = await setup(t);
  for (const patch of [{}, { username: "bob" }, { password: "new-synthetic-password" }]) {
    const p = await s.importer.preview("doc-synthetic");
    await s.importer.commit({ ticket: p.ticket, candidates: [{ ...p.candidates[0], ...patch }] });
  }
  assert.equal(s.assets().length, 3);
  assert.equal((await s.vault.get(`account:${s.assets()[0].id}`)).password, candidate.password);
});
test("原文变更、取消、超时、锁库都使预览失效", async (t) => {
  const s = await setup(t);
  for (const action of [
    async () => s.documents.save({ ...(await s.documents.get("doc-synthetic")), title: "已修改" }),
    async (p) => s.importer.cancel(p.ticket),
    async () => s.advance(),
    async () => s.vault.lock(),
  ]) {
    const p = await s.importer.preview("doc-synthetic");
    await action(p);
    await assert.rejects(s.importer.commit({ ticket: p.ticket, candidates: p.candidates }));
  }
  assert.equal(s.assets().length, 0);
});
test("不能伪造候选ID或注入危险网址，失败不写任何账号", async (t) => {
  const s = await setup(t);
  for (const patch of [
    { id: "injected" },
    { url: "javascript:alert(1)" },
    { url: "https://alice:secret@example.test" },
  ]) {
    const p = await s.importer.preview("doc-synthetic");
    await assert.rejects(
      s.importer.commit({ ticket: p.ticket, candidates: [{ ...candidate, ...patch }] }),
    );
  }
  assert.deepEqual(await s.vault.list(), []);
});
test("关联失败明确报告，已加密账号保留且可以从恢复标记找回", async (t) => {
  const s = await setup(t);
  const p = await s.importer.preview("doc-synthetic");
  s.documents.save = async () => {
    throw new Error("synthetic write failure");
  };
  const result = await s.importer.commit({ ticket: p.ticket, candidates: p.candidates });
  assert.equal(result.added, 1);
  assert.ok(result.bindingError);
  assert.equal(
    (await s.vault.get(`account:${result.assets[0].id}`))._browserAsset.id,
    result.assets[0].id,
  );
});
