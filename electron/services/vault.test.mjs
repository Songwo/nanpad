import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import fs, { statSync, writeFileSync } from "node:fs";
import fsPromises, {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  utimes,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Vault } from "./vault.mjs";

const OLD_MASTER = "old-master-for-vault-test";
const NEW_MASTER = "new-master-for-vault-test";

/** 按 1.7.0 及之前的 v1 格式手工写一份密钥库：无 kdf 字段，scrypt N=2^15。 */
function writeLegacyVault(master, records) {
  const salt = randomBytes(16);
  const key = scryptSync(master, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const seal = (plaintext) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    };
  };
  return JSON.stringify({
    v: 1,
    salt: salt.toString("base64"),
    check: seal(Buffer.from("sinan-vault")),
    records: Object.fromEntries(
      Object.entries(records).map(([id, secret]) => [
        id,
        seal(Buffer.from(JSON.stringify(secret))),
      ]),
    ),
  });
}

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

test("批量写入一次提交，并按前缀读取独立副本", async (t) => {
  const { file, vault } = await setup(t);
  await vault.set("ssh:keep", { password: "ssh-private" });
  await vault.batch([
    { id: "account:a", secret: { username: "one", password: "batch-private-1" } },
    { id: "account:b", secret: { username: "two", password: "batch-private-2" } },
  ]);
  const records = await vault.readAll("account:");
  assert.deepEqual(Object.keys(records).sort(), ["account:a", "account:b"]);
  records["account:a"].password = "mutated";
  assert.equal((await vault.get("account:a")).password, "batch-private-1");
  const restarted = new Vault(file);
  await restarted.unlock(OLD_MASTER);
  assert.equal((await restarted.readAll("account:"))["account:b"].username, "two");
  assert.doesNotMatch(await readFile(file, "utf8"), /batch-private|ssh-private/);
});

test("批量序列化失败或落盘失败时没有部分记录", async (t) => {
  const { directory, file, vault } = await setup(t);
  await vault.set("keep", { value: "original" });
  const cyclic = {};
  cyclic.self = cyclic;
  await assert.rejects(
    vault.batch([
      { id: "account:first", secret: { value: "never-saved" } },
      { id: "account:invalid", secret: cyclic },
    ]),
  );
  assert.deepEqual(await vault.list(), ["keep"]);
  const backup = join(directory, "backup.enc");
  await rename(file, backup);
  await mkdir(file);
  await assert.rejects(
    vault.batch([
      { id: "account:first", secret: { value: "never-saved" } },
      { id: "account:second", secret: { value: "never-saved" } },
    ]),
    /保存失败/,
  );
  assert.deepEqual(await vault.list(), ["keep"]);
});

test("锁库使批量写入、全部读取和会话失效，并同步通知订阅者", async (t) => {
  const { vault } = await setup(t);
  const session = vault.session;
  let locks = 0;
  const unsubscribe = vault.onLock(() => {
    locks += 1;
  });
  const pending = [
    vault.batch([{ id: "account:a", secret: { value: 1 } }]),
    vault.readAll("account:"),
  ];
  vault.lock();
  assert.equal(locks, 1);
  assert.notEqual(vault.session, session);
  assert.ok((await Promise.allSettled(pending)).every((result) => result.status === "rejected"));
  await assert.rejects(vault.batch([]), /锁定/);
  await assert.rejects(vault.readAll("account:"), /锁定/);
  unsubscribe();
  vault.lock();
  assert.equal(locks, 1);
});

test("原子替换前最后一次提交校验失败时保留旧库并清理临时密文", async (t) => {
  const { directory, file, vault } = await setup(t);
  await vault.set("keep", { value: "original" });
  const original = await readFile(file, "utf8");
  let checks = 0;
  await assert.rejects(
    vault.batch([{ id: "account:a", secret: { password: "never-committed" } }], {
      beforeCommit() {
        checks += 1;
        if (checks >= 2) throw new Error("导入已取消");
      },
    }),
    /取消/,
  );
  assert.equal(await readFile(file, "utf8"), original);
  assert.equal(await vault.get("account:a"), null);
  assert.deepEqual(await readdir(directory), ["vault.enc"]);
});

const linkedCredentialIds = ["account:linked", "identity-auth:linked", "totp:linked"];
const linkedCredentials = () =>
  linkedCredentialIds.map((id, index) => ({ id, secret: { value: `linked-private-${index}` } }));

test("关联账号批量删除一次落盘，重复或缺失标识不影响其他记录", async (t) => {
  const { file, vault } = await setup(t);
  await vault.batch([...linkedCredentials(), { id: "unrelated", secret: { value: "keep" } }]);
  let checks = 0;
  assert.deepEqual(
    await vault.removeMany([...linkedCredentialIds, linkedCredentialIds[0], "missing"], {
      beforeCommit() {
        checks++;
      },
    }),
    { ok: true, count: 3 },
  );
  assert.equal(checks, 2);
  assert.deepEqual(await vault.readAll(), { unrelated: { value: "keep" } });
  const reopened = new Vault(file);
  await reopened.unlock(OLD_MASTER);
  assert.deepEqual(await reopened.readAll(), { unrelated: { value: "keep" } });
  assert.deepEqual(await vault.removeMany([]), { ok: true, count: 0 });
  await assert.rejects(vault.removeMany(["unrelated", null]), /标识无效/);
  assert.deepEqual(await vault.get("unrelated"), { value: "keep" });
});

test("批量删除落盘失败时账号、授权和验证码在内存及磁盘中全部保留", async (t) => {
  const { directory, file, vault } = await setup(t);
  await vault.batch(linkedCredentials());
  const original = await readFile(file, "utf8");
  const backup = join(directory, "linked-backup.enc");
  await rename(file, backup);
  await mkdir(file);
  await assert.rejects(vault.removeMany(linkedCredentialIds), /保存失败/);
  for (const { id, secret } of linkedCredentials()) assert.deepEqual(await vault.get(id), secret);
  assert.equal(await readFile(backup, "utf8"), original);
  assert.deepEqual((await readdir(directory)).sort(), ["linked-backup.enc", "vault.enc"]);
  await rm(file, { recursive: true });
  await rename(backup, file);
  const reopened = new Vault(file);
  await reopened.unlock(OLD_MASTER);
  for (const { id, secret } of linkedCredentials())
    assert.deepEqual(await reopened.get(id), secret);
  await vault.removeMany(linkedCredentialIds);
  assert.deepEqual(await vault.list(), []);
});

test("批量删除提交前取消时不落盘，也不残留临时密文", async (t) => {
  const { directory, file, vault } = await setup(t);
  await vault.batch(linkedCredentials());
  const original = await readFile(file, "utf8");
  let checks = 0;
  await assert.rejects(
    vault.removeMany(linkedCredentialIds, {
      beforeCommit() {
        if (++checks >= 2) throw new Error("删除已取消");
      },
    }),
    /取消/,
  );
  assert.equal(await readFile(file, "utf8"), original);
  for (const { id, secret } of linkedCredentials()) assert.deepEqual(await vault.get(id), secret);
  assert.deepEqual(await readdir(directory), ["vault.enc"]);
});

test("排队及最终提交校验期间锁库均取消整组删除", async (t) => {
  const { directory, file, vault } = await setup(t);
  await vault.batch(linkedCredentials());
  const original = await readFile(file, "utf8");
  const queued = vault.removeMany(linkedCredentialIds);
  vault.lock();
  await assert.rejects(queued, /操作已取消/);
  await vault.unlock(OLD_MASTER);
  let checks = 0;
  await assert.rejects(
    vault.removeMany(linkedCredentialIds, {
      beforeCommit() {
        if (++checks === 2) vault.lock();
      },
    }),
    /操作已取消/,
  );
  assert.equal(vault.unlocked, false);
  assert.equal(await readFile(file, "utf8"), original);
  assert.deepEqual(await readdir(directory), ["vault.enc"]);
  await vault.unlock(OLD_MASTER);
  for (const { id, secret } of linkedCredentials()) assert.deepEqual(await vault.get(id), secret);
});

test("批量字段合并读取队列中的最新账号，不覆盖新密码、备注与恢复标记", async (t) => {
  const { file, vault } = await setup(t);
  await vault.set("account:shared", { username: "old", password: "password-A", note: "note-A" });
  const latest = {
    username: "user-edited",
    password: "password-B",
    note: "note-B",
    custom: "keep-custom",
    _browserAsset: { id: "shared", name: "保留恢复入口" },
  };
  const editing = vault.set("account:shared", latest);
  const merging = vault.batch([
    { id: "identity-auth:shared", secret: { profile: { username: "official" } } },
    {
      id: "account:shared",
      merge: true,
      secret: {
        username: "official",
        url: "https://linux.do/u/official",
        updatedAt: "2026-10-08T00:00:00Z",
      },
    },
  ]);
  await Promise.all([editing, merging]);
  const expected = {
    ...latest,
    username: "official",
    url: "https://linux.do/u/official",
    updatedAt: "2026-10-08T00:00:00Z",
  };
  assert.deepEqual(await vault.get("account:shared"), expected);
  const reopened = new Vault(file);
  await reopened.unlock(OLD_MASTER);
  assert.deepEqual(await reopened.get("account:shared"), expected);
  await vault.set("invalid", "not-object");
  await assert.rejects(
    vault.batch([
      { id: "never-written", secret: { value: 1 } },
      { id: "invalid", merge: true, secret: { value: 2 } },
    ]),
    /可合并/,
  );
  assert.equal(await vault.get("never-written"), null);
});

test("主密码长度在主进程强制为 10 至 256 位，创建与改密均不接受更短的值", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanpad-vault-length-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vault = new Vault(join(directory, "vault.enc"));
  await assert.rejects(vault.create("short9chr"), /至少 10 位/);
  await assert.rejects(vault.create("x".repeat(257)), /最多 256 位/);
  assert.deepEqual(await readdir(directory), []);
  await vault.create(OLD_MASTER);
  await assert.rejects(vault.changePassword(OLD_MASTER, "short9chr"), /至少 10 位/);
  await assert.rejects(vault.changePassword(OLD_MASTER, "y".repeat(257)), /最多 256 位/);
  const restarted = new Vault(join(directory, "vault.enc"));
  await restarted.unlock(OLD_MASTER);
  assert.equal(restarted.unlocked, true);
});

test("新建密钥库写入 v2 与 scrypt 参数，参数达到 OWASP 下限", async (t) => {
  const { file } = await setup(t);
  const doc = JSON.parse(await readFile(file, "utf8"));
  assert.equal(doc.v, 2);
  assert.deepEqual(doc.kdf, { N: 2 ** 17, r: 8, p: 1 });
  assert.equal(typeof doc.salt, "string");
});

test("v1 旧库（无 kdf 字段）按原参数解锁，改密后升级为 v2 并保留全部记录", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nanpad-vault-legacy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "vault.enc");
  const records = {
    "account:site": { username: "alice", password: "legacy-private-1" },
    "ssh:host": { password: "legacy-private-2" },
  };
  await writeFile(file, writeLegacyVault(OLD_MASTER, records), "utf8");
  const vault = new Vault(file);
  await assert.rejects(vault.unlock("wrong-master-password"), /主密码不正确/);
  await vault.unlock(OLD_MASTER);
  assert.deepEqual(await vault.get("account:site"), records["account:site"]);
  // 普通写入沿用 v1 格式，不在用户不知情时改变派生参数。
  await vault.set("account:new", { password: "added-private" });
  let doc = JSON.parse(await readFile(file, "utf8"));
  assert.equal(doc.v, 1);
  assert.equal(doc.kdf, undefined);
  const upgraded = new Vault(file);
  await upgraded.unlock(OLD_MASTER);
  assert.deepEqual(await upgraded.get("account:new"), { password: "added-private" });
  // 改密是派生新密钥的时机，此时升级到当前参数。
  await upgraded.changePassword(OLD_MASTER, NEW_MASTER);
  doc = JSON.parse(await readFile(file, "utf8"));
  assert.equal(doc.v, 2);
  assert.deepEqual(doc.kdf, { N: 2 ** 17, r: 8, p: 1 });
  const reopened = new Vault(file);
  await assert.rejects(reopened.unlock(OLD_MASTER), /主密码不正确/);
  await reopened.unlock(NEW_MASTER);
  assert.deepEqual(await reopened.get("account:site"), records["account:site"]);
  assert.deepEqual(await reopened.get("ssh:host"), records["ssh:host"]);
  assert.deepEqual(await reopened.get("account:new"), { password: "added-private" });
  assert.doesNotMatch(await readFile(file, "utf8"), /legacy-private|added-private/);
});

test("文件里的 kdf 参数非法或超出内存上限时不按其派生，而是拒绝解锁", async (t) => {
  const { file, vault } = await setup(t);
  vault.lock();
  const doc = JSON.parse(await readFile(file, "utf8"));
  for (const kdf of [
    { N: 2 ** 30, r: 8, p: 1 },
    { N: 2 ** 17 + 1, r: 8, p: 1 },
    { N: 2 ** 17, r: 64, p: 1 },
    "not-an-object",
  ]) {
    await writeFile(file, JSON.stringify({ ...doc, kdf }), "utf8");
    await assert.rejects(new Vault(file).unlock(OLD_MASTER), /主密码不正确/);
  }
});

test("应用运行中被外部恢复的备份会被重新读取，不被内存旧副本覆盖", async (t) => {
  const { file, vault } = await setup(t);
  await vault.set("account:a", { password: "keep-a" });
  const backup = await readFile(file, "utf8");
  await vault.set("account:b", { password: "to-be-rolled-back" });
  assert.deepEqual((await vault.list()).sort(), ["account:a", "account:b"]);
  // 用户在应用仍解锁时把早先的备份复制回来。
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(file, backup, "utf8");
  assert.deepEqual(await vault.list(), ["account:a"]);
  assert.equal(await vault.get("account:b"), null);
  assert.deepEqual(await vault.get("account:a"), { password: "keep-a" });
  // 之后的写入基于恢复后的内容，旧的 account:b 不会被内存副本"复活"。
  await vault.set("account:c", { password: "after-restore" });
  const restarted = new Vault(file);
  await restarted.unlock(OLD_MASTER);
  assert.deepEqual((await restarted.list()).sort(), ["account:a", "account:c"]);
  assert.equal(await restarted.get("account:b"), null);
});

test("磁盘上的密钥库暂时缺失或被目录占位时沿用内存副本，不误判为未创建", async (t) => {
  const { directory, file, vault } = await setup(t);
  await vault.set("account:a", { password: "still-here" });
  const backup = join(directory, "moved.enc");
  await rename(file, backup);
  assert.deepEqual(await vault.get("account:a"), { password: "still-here" });
  assert.deepEqual(await vault.status(), { exists: true, unlocked: true });
  await assert.rejects(vault.set("unexpected", { value: "must-not-recreate" }), /保存失败/);
  assert.equal(await vault.get("unexpected"), null);
  assert.deepEqual((await readdir(directory)).sort(), ["moved.enc"]);
  await rename(backup, file);
  assert.deepEqual(await vault.get("account:a"), { password: "still-here" });
});

async function legacySetup(t, records = { keep: { value: "original" } }) {
  const directory = await mkdtemp(join(tmpdir(), "zhiyu-vault-restore-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "vault.enc");
  await writeFile(file, writeLegacyVault(OLD_MASTER, records));
  const vault = new Vault(file);
  await vault.unlock(OLD_MASTER);
  return { directory, file, vault };
}

function patchFilesystem(t, name, implementation) {
  const original = fsPromises[name];
  const mocked = t.mock.method(fsPromises, name, (...args) => implementation(original, ...args));
  syncBuiltinESMExports();
  t.after(() => {
    mocked.mock.restore();
    syncBuiltinESMExports();
  });
}

function patchRename(t, implementation) {
  const original = fs.renameSync;
  const mocked = t.mock.method(fs, "renameSync", (...args) => implementation(original, ...args));
  syncBuiltinESMExports();
  t.after(() => {
    mocked.mock.restore();
    syncBuiltinESMExports();
  });
}

const temporaryRenameError = () =>
  Object.assign(new Error("synthetic rename blocked"), { code: "EPERM" });

test("非 EPERM 的替换错误立即失败并保留原库", async (t) => {
  const { file, vault } = await legacySetup(t);
  const originalContent = await readFile(file, "utf8");
  let attempts = 0;
  patchRename(t, (original, source, destination) => {
    if (destination !== file) return original(source, destination);
    attempts += 1;
    throw Object.assign(new Error("synthetic disk failure"), { code: "EIO" });
  });
  await assert.rejects(
    vault.set("new", { value: "never-committed" }),
    (error) => error.cause.code === "EIO",
  );
  assert.equal(attempts, 1);
  assert.equal(await readFile(file, "utf8"), originalContent);
  assert.equal(await vault.get("new"), null);
});

test(
  "Windows 暂时拒绝替换时重试原提交，记录和密钥一起生效",
  { skip: process.platform !== "win32" },
  async (t) => {
    const { file, vault } = await legacySetup(t);
    let attempts = 0;
    patchRename(t, (original, source, destination) => {
      if (destination === file && ++attempts <= 2) throw temporaryRenameError();
      return original(source, destination);
    });
    await vault.changePassword(OLD_MASTER, NEW_MASTER);
    assert.equal(attempts, 3);
    assert.deepEqual(await vault.get("keep"), { value: "original" });
    const reopened = new Vault(file);
    await reopened.unlock(NEW_MASTER);
    assert.deepEqual(await reopened.get("keep"), { value: "original" });
    await assert.rejects(reopened.unlock(OLD_MASTER), /主密码不正确/);
  },
);

test(
  "Windows 替换重试等待期间锁库、恢复备份或提交条件失效均取消写入",
  { skip: process.platform !== "win32" },
  async (t) => {
    for (const mode of ["lock", "restore", "guard"]) {
      await t.test(mode, async (t) => {
        const { directory, file, vault } = await legacySetup(t);
        const originalContent = await readFile(file, "utf8");
        const replacement = writeLegacyVault(OLD_MASTER, { restored: { value: "preserved" } });
        let attempts = 0;
        let invalid = false;
        patchRename(t, (original, source, destination) => {
          if (destination !== file) return original(source, destination);
          attempts += 1;
          if (attempts === 1) {
            setImmediate(() => {
              if (mode === "lock") vault.lock();
              else if (mode === "restore") writeFileSync(file, replacement);
              else invalid = true;
            });
            throw temporaryRenameError();
          }
          return original(source, destination);
        });
        await assert.rejects(
          vault.batch([{ id: "new", secret: { value: "never-committed" } }], {
            beforeCommit: () => {
              if (invalid) throw new Error("synthetic commit cancelled");
            },
          }),
          mode === "guard" ? /synthetic commit cancelled/ : /取消|变化/,
        );
        assert.equal(attempts, 1);
        assert.equal(
          await readFile(file, "utf8"),
          mode === "restore" ? replacement : originalContent,
        );
        assert.deepEqual(await readdir(directory), ["vault.enc"]);
        assert.equal(vault.unlocked, mode === "guard");
        if (mode === "guard") assert.equal(await vault.get("new"), null);
      });
    }
  },
);

test(
  "Windows 永久拒绝替换达到重试上限后仍报错，不污染磁盘或缓存",
  { skip: process.platform !== "win32" },
  async (t) => {
    const { directory, file, vault } = await legacySetup(t);
    const originalContent = await readFile(file, "utf8");
    let attempts = 0;
    patchRename(t, (original, source, destination) => {
      if (destination !== file) return original(source, destination);
      attempts += 1;
      throw temporaryRenameError();
    });
    await assert.rejects(vault.set("new", { value: "never-committed" }), (error) => {
      assert.match(error.message, /保存失败/);
      assert.equal(error.cause.code, "EPERM");
      return true;
    });
    assert.equal(attempts, 7);
    assert.equal(await readFile(file, "utf8"), originalContent);
    assert.deepEqual(await readdir(directory), ["vault.enc"]);
    assert.equal(await vault.get("new"), null);
    assert.deepEqual(await vault.get("keep"), { value: "original" });
  },
);

test("版本与 KDF 严格匹配，非法 v2 不能退回 legacy，运算量不能越过当前预算", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "zhiyu-vault-kdf-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "vault.enc");
  const legacy = JSON.parse(writeLegacyVault("123456", { keep: { value: "legacy" } }));
  for (const header of [
    { v: 2 },
    { v: 2, kdf: null },
    { v: 2, kdf: { N: 3, r: 8, p: 1 } },
    { v: 2, kdf: { N: 2 ** 17, r: 8, p: 16 } },
    { v: 2, kdf: { N: 2 ** 16, r: 8, p: 4 } },
    { v: 1, kdf: { N: 2 ** 15, r: 8, p: 1 } },
    { v: 3 },
    { v: undefined },
  ]) {
    await writeFile(file, JSON.stringify({ ...legacy, ...header }));
    const invalid = new Vault(file);
    await assert.rejects(invalid.unlock("123456"), /主密码不正确|格式不受支持/);
    assert.equal(invalid.unlocked, false);
  }
  // 旧六位密码仍能解锁；合法 v2 可以显式携带历史参数。
  for (const doc of [legacy, { ...legacy, v: 2, kdf: { N: 2 ** 15, r: 8, p: 1 } }]) {
    await writeFile(file, JSON.stringify(doc));
    const compatible = new Vault(file);
    await compatible.unlock("123456");
    assert.deepEqual(await compatible.get("keep"), { value: "legacy" });
  }
});

test("同密码但不同盐的外部备份使旧会话失效，全部修改入口都不能写入旧密钥密文", async (t) => {
  const mutations = {
    set: (vault) => vault.set("new", { value: "new" }),
    batch: (vault) => vault.batch([{ id: "new", secret: { value: "new" } }]),
    remove: (vault) => vault.remove("keep"),
    removeMany: (vault) => vault.removeMany(["keep"]),
    changePassword: (vault) => vault.changePassword(OLD_MASTER, NEW_MASTER),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async (t) => {
      const { file, vault } = await legacySetup(t);
      const replacement = writeLegacyVault(OLD_MASTER, { keep: { value: "restored" } });
      const session = vault.session;
      let lockCount = 0;
      vault.onLock(() => lockCount++);
      await writeFile(file, replacement);
      const pending = [mutate(vault), vault.set("queued", { value: "must-not-persist" })];
      assert.ok(
        (await Promise.allSettled(pending)).every((result) => result.status === "rejected"),
      );
      assert.equal(vault.unlocked, false);
      assert.notEqual(vault.session, session);
      assert.equal(lockCount, 1);
      assert.equal(await readFile(file, "utf8"), replacement);
      await vault.unlock(OLD_MASTER);
      assert.deepEqual(await vault.get("keep"), { value: "restored" });
      assert.equal(await vault.get("queued"), null);
      await vault.set("new", { value: "readable" });
      const restarted = new Vault(file);
      await restarted.unlock(OLD_MASTER);
      assert.deepEqual(await restarted.get("new"), { value: "readable" });
    });
  }
});

test("同密钥恢复即使保持文件大小和 mtime，也重新读取记录而非复用旧缓存", async (t) => {
  for (const mode of ["原地覆写", "替换文件"]) {
    await t.test(mode, async (t) => {
      const { directory, file, vault } = await legacySetup(t, { keep: { value: "before" } });
      const backup = await readFile(file, "utf8");
      await vault.set("keep", { value: "after!" });
      const latestStat = statSync(file);
      assert.equal(Buffer.byteLength(backup), latestStat.size);
      if (mode === "替换文件") {
        const restoredFile = join(directory, "restored.enc");
        await writeFile(restoredFile, backup);
        await utimes(restoredFile, latestStat.atime, latestStat.mtime);
        await rename(restoredFile, file);
      } else {
        await writeFile(file, backup);
        await utimes(file, latestStat.atime, latestStat.mtime);
      }
      assert.deepEqual(await vault.get("keep"), { value: "before" });
      assert.equal(vault.unlocked, true);
      await vault.set("added", { value: "after-restore" });
      const restarted = new Vault(file);
      await restarted.unlock(OLD_MASTER);
      assert.deepEqual(await restarted.get("keep"), { value: "before" });
      assert.deepEqual(await restarted.get("added"), { value: "after-restore" });
    });
  }
});

test("首次创建或改密派生过程中恢复的文件不会被旧快照覆盖", async (t) => {
  for (const mode of ["create", "changePassword", "unlock"]) {
    await t.test(mode, async (t) => {
      const { file, vault } = await legacySetup(t);
      const replacement = writeLegacyVault(OLD_MASTER, { restored: { value: "preserved" } });
      let target = vault;
      if (mode === "create") {
        await rm(file);
        target = new Vault(file);
      } else if (mode === "unlock") target.lock();
      const operation =
        mode === "create"
          ? target.create(NEW_MASTER)
          : mode === "unlock"
            ? target.unlock(OLD_MASTER)
            : target.changePassword(OLD_MASTER, NEW_MASTER);
      const rejected = assert.rejects(operation, /取消|变化/);
      await nextTurn();
      await writeFile(file, replacement);
      await rejected;
      assert.equal(target.unlocked, false);
      assert.equal(await readFile(file, "utf8"), replacement);
      await target.unlock(OLD_MASTER);
      assert.deepEqual(await target.get("restored"), { value: "preserved" });
      assert.equal(await target.get("keep"), null);
    });
  }
});

test("临时密文写入期间外部恢复的备份在所有提交入口均保留", async (t) => {
  const mutations = {
    create: (vault) => vault.create(NEW_MASTER),
    set: (vault) => vault.set("new", { value: "must-not-persist" }),
    batch: (vault) => vault.batch([{ id: "new", secret: { value: "must-not-persist" } }]),
    remove: (vault) => vault.remove("keep"),
    removeMany: (vault) => vault.removeMany(["keep"]),
    changePassword: (vault) => vault.changePassword(OLD_MASTER, NEW_MASTER),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async (t) => {
      const { directory, file, vault } = await legacySetup(t);
      const replacement = writeLegacyVault(OLD_MASTER, { keep: { value: "restored" } });
      let target = vault;
      if (name === "create") {
        await rm(file);
        target = new Vault(file);
      }
      let injected = false;
      patchFilesystem(t, "writeFile", async (original, path, ...args) => {
        const result = await original(path, ...args);
        if (!injected && String(path).startsWith(`${file}.`) && String(path).endsWith(".tmp")) {
          injected = true;
          await original(file, replacement);
        }
        return result;
      });
      await assert.rejects(mutate(target), /取消|变化/);
      assert.equal(injected, true);
      assert.equal(target.unlocked, false);
      assert.equal(await readFile(file, "utf8"), replacement);
      assert.deepEqual(await readdir(directory), ["vault.enc"]);
      await target.unlock(OLD_MASTER);
      assert.deepEqual(await target.get("keep"), { value: "restored" });
      assert.equal(await target.get("new"), null);
    });
  }
});

test("读取跨 await 期间文件变化不会缓存旧文档配新版本或继续使用旧密钥", async (t) => {
  const { file, vault } = await legacySetup(t);
  const originalFile = await readFile(file, "utf8");
  const replacement = writeLegacyVault(OLD_MASTER, { restored: { value: "readable" } });
  // 使下一次读取不能命中缓存，然后在 readFile 返回旧内容前恢复另一个文件。
  await writeFile(file, originalFile);
  let injected = false;
  patchFilesystem(t, "readFile", async (original, path, ...args) => {
    const result = await original(path, ...args);
    if (!injected && path === file) {
      injected = true;
      writeFileSync(file, replacement);
    }
    return result;
  });
  await assert.rejects(vault.get("keep"), /取消|变化/);
  assert.equal(injected, true);
  assert.equal(vault.unlocked, false);
  await vault.unlock(OLD_MASTER);
  assert.deepEqual(await vault.get("restored"), { value: "readable" });
  assert.equal(await vault.get("keep"), null);
});
