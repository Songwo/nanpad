import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Vault } from "./vault.mjs";

const OLD_MASTER = "old-master-for-vault-test";
const NEW_MASTER = "new-master-for-vault-test";

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), "nanpad-vault-concurrency-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "vault.enc");
  const vault = new Vault(file);
  await vault.create(OLD_MASTER);
  return { directory, file, vault };
}

test("30 次并发写入全部成功，重启后每条凭据都能解密", async (t) => {
  const { directory, file, vault } = await setup(t);
  const results = await Promise.allSettled(
    Array.from({ length: 30 }, (_, index) =>
      vault.set(`account:${index}`, { password: `private-${index}` }),
    ),
  );
  assert.equal(results.filter((result) => result.status === "rejected").length, 0);
  assert.equal((await vault.list()).length, 30);
  const restarted = new Vault(file);
  await restarted.unlock(OLD_MASTER);
  for (let index = 0; index < 30; index += 1)
    assert.deepEqual(await restarted.get(`account:${index}`), { password: `private-${index}` });
  assert.doesNotMatch(await readFile(file, "utf8"), /private-/);
  assert.deepEqual(await readdir(directory), ["vault.enc"]);
});

test("写入、删除、读取与改主密码按调用顺序串行完成", async (t) => {
  const { file, vault } = await setup(t);
  await vault.set("account:remove", { password: "remove-me" });
  const before = Array.from({ length: 12 }, (_, index) => vault.set(`before:${index}`, { index }));
  const change = vault.changePassword(OLD_MASTER, NEW_MASTER);
  const after = Array.from({ length: 12 }, (_, index) => vault.set(`after:${index}`, { index }));
  const remove = vault.remove("account:remove");
  const read = vault.get("after:11");
  await Promise.all([...before, change, ...after, remove]);
  assert.equal((await change).count, 13);
  assert.deepEqual(await read, { index: 11 });
  const restarted = new Vault(file);
  await assert.rejects(restarted.unlock(OLD_MASTER), /主密码不正确/);
  await restarted.unlock(NEW_MASTER);
  assert.equal((await restarted.list()).length, 24);
  assert.equal(await restarted.get("account:remove"), null);
  for (const prefix of ["before", "after"])
    for (let index = 0; index < 12; index += 1)
      assert.deepEqual(await restarted.get(`${prefix}:${index}`), { index });
});

test("并发解锁和改主密码不会留下旧 key 与新 doc 的混合状态", async (t) => {
  const { file, vault } = await setup(t);
  await vault.set("credential", { password: "still-private" });
  const results = await Promise.allSettled([
    vault.unlock(OLD_MASTER),
    vault.changePassword(OLD_MASTER, NEW_MASTER),
    vault.unlock(OLD_MASTER),
    vault.unlock(NEW_MASTER),
    vault.set("after-rekey", { value: 42 }),
  ]);
  assert.deepEqual(
    results.map((entry) => entry.status),
    ["fulfilled", "fulfilled", "rejected", "fulfilled", "fulfilled"],
  );
  assert.deepEqual(await vault.get("credential"), { password: "still-private" });
  const restarted = new Vault(file);
  await restarted.unlock(NEW_MASTER);
  assert.deepEqual(await restarted.get("after-rekey"), { value: 42 });
});

test("锁库同步生效，并取消锁前排队的写入和读取", async (t) => {
  const { file, vault } = await setup(t);
  await vault.set("keep", { value: "original" });
  const pending = [
    vault.set("new", { value: "must-not-persist" }),
    vault.remove("keep"),
    vault.get("keep"),
  ];
  assert.deepEqual(vault.lock(), { ok: true });
  assert.equal(vault.unlocked, false);
  const outcomes = await Promise.allSettled(pending);
  assert.equal(
    outcomes.every((entry) => entry.status === "rejected"),
    true,
  );
  await assert.rejects(vault.get("keep"), /已锁定/);
  await assert.rejects(vault.set("locked", {}), /已锁定/);
  const restarted = new Vault(file);
  await restarted.unlock(OLD_MASTER);
  assert.deepEqual(await restarted.get("keep"), { value: "original" });
  assert.equal(await restarted.get("new"), null);
});

test("锁库取消正在派生密钥的换密码任务，不能自动重新解锁", async (t) => {
  const { file, vault } = await setup(t);
  await vault.set("keep", { value: "original" });
  const previousFile = await readFile(file, "utf8");
  const change = vault.changePassword(OLD_MASTER, NEW_MASTER);
  const queued = vault.set("queued", { value: "must-not-persist" });
  await nextTurn();
  vault.lock();
  assert.equal(vault.unlocked, false);
  const outcomes = await Promise.allSettled([change, queued]);
  assert.equal(
    outcomes.every((entry) => entry.status === "rejected"),
    true,
  );
  assert.equal(vault.unlocked, false);
  assert.equal(await readFile(file, "utf8"), previousFile);
  await vault.unlock(OLD_MASTER);
  assert.deepEqual(await vault.get("keep"), { value: "original" });
  assert.equal(await vault.get("queued"), null);
  const restarted = new Vault(file);
  await assert.rejects(restarted.unlock(NEW_MASTER), /主密码不正确/);
});

test("锁库取消在途解锁，锁后明确发起的新解锁仍可成功", async (t) => {
  const { vault } = await setup(t);
  vault.lock();
  const unlocking = vault.unlock(OLD_MASTER);
  await nextTurn();
  vault.lock();
  await assert.rejects(unlocking, /操作已取消/);
  assert.equal(vault.unlocked, false);
  await vault.unlock(OLD_MASTER);
  assert.equal(vault.unlocked, true);
});

test("锁库取消尚未提交的首次创建", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanpad-vault-create-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vault = new Vault(join(directory, "vault.enc"));
  const creating = vault.create(OLD_MASTER);
  await nextTurn();
  vault.lock();
  await assert.rejects(creating, /操作已取消/);
  assert.deepEqual(await vault.status(), { exists: false, unlocked: false });
  assert.deepEqual(await readdir(directory), []);
  await vault.create(OLD_MASTER);
  assert.equal(vault.unlocked, true);
});

test("保存失败不污染内存记录，修复磁盘障碍后可继续写入", async (t) => {
  const { directory, file, vault } = await setup(t);
  await vault.set("original", { password: "before-failure" });
  const backup = join(directory, "original.enc");
  await rename(file, backup);
  await mkdir(file);
  await assert.rejects(vault.set("failed", { password: "never-committed" }), /保存失败/);
  await assert.rejects(vault.remove("original"), /保存失败/);
  assert.deepEqual(await vault.get("original"), { password: "before-failure" });
  assert.equal(await vault.get("failed"), null);
  assert.deepEqual((await readdir(directory)).sort(), ["original.enc", "vault.enc"]);
  await rm(file, { recursive: true });
  await rename(backup, file);
  await vault.set("recovered", { value: true });
  const restarted = new Vault(file);
  await restarted.unlock(OLD_MASTER);
  assert.deepEqual(await restarted.get("original"), { password: "before-failure" });
  assert.deepEqual(await restarted.get("recovered"), { value: true });
  assert.equal(await restarted.get("failed"), null);
});

test("换密码落盘失败仍保持旧密钥及旧记录可用", async (t) => {
  const { directory, file, vault } = await setup(t);
  await vault.set("original", { password: "before-failure" });
  const backup = join(directory, "original.enc");
  await rename(file, backup);
  await mkdir(file);
  await assert.rejects(vault.changePassword(OLD_MASTER, NEW_MASTER), /保存失败/);
  assert.equal(vault.unlocked, true);
  assert.deepEqual(await vault.get("original"), { password: "before-failure" });
  await rm(file, { recursive: true });
  await rename(backup, file);
  const restarted = new Vault(file);
  await assert.rejects(restarted.unlock(NEW_MASTER), /主密码不正确/);
  await restarted.unlock(OLD_MASTER);
  assert.deepEqual(await restarted.get("original"), { password: "before-failure" });
});

test("连续改主密码与失败操作不会阻塞后续队列", async (t) => {
  const { file, vault } = await setup(t);
  await vault.set("credential", { value: 1 });
  const results = await Promise.allSettled([
    vault.changePassword("incorrect", NEW_MASTER),
    vault.changePassword(OLD_MASTER, NEW_MASTER),
    vault.changePassword(NEW_MASTER, "third-master-for-vault-test"),
    vault.get("credential"),
  ]);
  assert.deepEqual(
    results.map((entry) => entry.status),
    ["rejected", "fulfilled", "fulfilled", "fulfilled"],
  );
  assert.deepEqual(results[3].value, { value: 1 });
  const restarted = new Vault(file);
  await restarted.unlock("third-master-for-vault-test");
  assert.deepEqual(await restarted.get("credential"), { value: 1 });
});
