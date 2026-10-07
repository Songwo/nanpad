import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "./vault.mjs";
import { BrowserPasswords } from "./browser-passwords.mjs";

const MASTER = "browser-migration-isolated-test";
const header = "name,url,username,password,note\r\n";
const csvRow = (...fields) =>
  fields.map((field) => `"${field.replaceAll('"', '""')}"`).join(",") + "\r\n";

async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "zhiyu-browser-passwords-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const file = join(directory, "vault.enc");
  const vault = new Vault(file);
  await vault.create(MASTER);
  const assets = [];
  const passwords = new BrowserPasswords({ vault, getAssets: () => assets, ...options });
  t.after(() => passwords.clear());
  return { directory, file, vault, assets, passwords };
}

test("Chrome/Edge CSV 支持 BOM、引号、换行和同站多账号，预览不含密码", async (t) => {
  const { file, vault, passwords } = await setup(t);
  const csv =
    "\ufeff" +
    header +
    csvRow("工作账号", "https://example.test/login", "alice", 'p,"\nword', "第一行\r\n第二行") +
    csvRow("私人账号", "https://example.test/", "bob", "=formula-secret", "");
  const preview = await passwords.preview(csv);
  assert.equal(preview.total, 2);
  assert.equal(preview.added, 2);
  assert.deepEqual(
    preview.rows.map((row) => row.status),
    ["new", "new"],
  );
  assert.ok(preview.rows.every((row) => !Object.hasOwn(row, "password")));
  assert.doesNotMatch(JSON.stringify(preview), /formula-secret/);
  const committed = await passwords.commit(preview.ticket);
  assert.equal(committed.imported, 2);
  assert.equal(committed.skipped, 0);
  assert.equal(committed.assets.length, 2);
  for (const asset of committed.assets) {
    assert.equal(asset.kind, "account");
    assert.equal(asset.value, "");
    assert.equal(asset.notes, "");
    assert.ok(!Object.hasOwn(asset, "username"));
    assert.ok(!Object.hasOwn(asset, "url"));
  }
  const stored = await vault.readAll("account:");
  assert.equal(Object.values(stored)[0].password, 'p,"\nword');
  assert.equal(Object.values(stored)[0].note, "第一行\r\n第二行");
  assert.doesNotMatch(await readFile(file, "utf8"), /formula-secret|alice|bob|example\.test/);
  await assert.rejects(passwords.commit(preview.ticket), /失效|过期/);
});

test("同一 origin 同用户名精确去重，不同密码冲突跳过，不影响其他账号", async (t) => {
  const { vault, passwords } = await setup(t);
  await vault.set("account:website", {
    url: "https://example.test/original",
    username: "alice",
    password: "keep",
  });
  const preview = await passwords.preview(
    header +
      csvRow("", "https://example.test/new", "alice", "keep", "") +
      csvRow("", "https://example.test/", "alice", "different", "") +
      csvRow("", "https://example.test/", "bob", "new", "") +
      csvRow("", "https://example.test/", "bob", "new", "") +
      csvRow("", "https://example.test/", "bob", "other", ""),
  );
  assert.deepEqual([preview.added, preview.duplicates, preview.conflicts], [1, 2, 2]);
  assert.deepEqual(
    preview.rows.map((row) => row.status),
    ["duplicate", "conflict", "new", "duplicate", "conflict"],
  );
  const committed = await passwords.commit(preview.ticket);
  assert.deepEqual([committed.imported, committed.skipped], [1, 4]);
  assert.equal((await vault.get("account:website")).password, "keep");
  assert.equal((await passwords.listForOrigin("https://example.test/login")).length, 2);
});

test("预览与提交之间重新检查重复，多个并发保存不会重复创建", async (t) => {
  const { passwords } = await setup(t);
  const capture = {
    title: "站点",
    url: "https://example.test/login",
    username: "alice",
    password: "secret",
  };
  const preview = await passwords.preview(
    header + csvRow("站点", capture.url, capture.username, capture.password, ""),
  );
  const results = await Promise.all(
    Array.from({ length: 5 }, () => passwords.saveCapture(capture)),
  );
  assert.equal(results.filter((result) => result.status === "created").length, 1);
  assert.equal(new Set(results.map((result) => result.id)).size, 1);
  assert.deepEqual(await passwords.commit(preview.ticket), { imported: 0, skipped: 1, assets: [] });
  const changed = await passwords.saveCapture({ ...capture, password: "new-secret" });
  assert.equal(changed.status, "created");
  assert.notEqual(changed.id, results[0].id);
  assert.match(changed.assets[0].name, /密码版本 2/);
  assert.equal((await passwords.listForOrigin(capture.url)).length, 2);
});

test("账号填写严格绑定 HTTPS origin，不跨子域、不降级 HTTP，支持本机测试页", async (t) => {
  const { passwords } = await setup(t);
  const created = await passwords.saveCapture({
    url: "https://example.test/",
    title: "站点",
    username: "alice",
    password: "secret",
  });
  assert.deepEqual(await passwords.getForOrigin(created.id, "https://example.test/login"), {
    username: "alice",
    password: "secret",
  });
  for (const url of [
    "https://sub.example.test/",
    "https://example.test:444/",
    "https://example.test.evil/",
    "http://example.test/",
    "https://user@example.test/",
  ]) {
    await assert.rejects(passwords.getForOrigin(created.id, url), /站点|网址|安全/);
  }
  assert.deepEqual(await passwords.listForOrigin("https://other.test/"), []);
  await assert.rejects(passwords.listForOrigin("http://example.test/"), /安全/);
  const local = await passwords.saveCapture({
    url: "http://127.0.0.1:8080/",
    title: "本机",
    username: "",
    password: "local-secret",
  });
  assert.equal(
    (await passwords.getForOrigin(local.id, "http://127.0.0.1:8080/login")).password,
    "local-secret",
  );
});

test("导出可再次导入浏览器格式，保留逗号、换行、公式前缀与空用户名", async (t) => {
  const { vault, passwords } = await setup(t);
  await vault.set("account:a", {
    url: "http://legacy.test/login",
    username: "",
    password: '=SUM(1,2)\r\n"quoted"',
    note: "+private-note",
  });
  await vault.set("account:api", { password: "not-a-website" });
  const exported = await passwords.exportCsv();
  assert.equal(exported.count, 1);
  assert.match(exported.csv, /name,url,username,password,note/);
  const other = await setup(t);
  const preview = await other.passwords.preview(exported.csv);
  assert.equal(preview.added, 1);
  const result = await other.passwords.commit(preview.ticket);
  const restored = await other.vault.get(`account:${result.assets[0].id}`);
  assert.equal(restored.password, '=SUM(1,2)\r\n"quoted"');
  assert.equal(restored.username, "");
  assert.equal(restored.note, "+private-note");
});

test("拒绝格式损坏与超限 CSV，单条无效凭据可预览后跳过", async (t) => {
  const { passwords } = await setup(t);
  for (const csv of [
    "username,password\na,b",
    header + '"unterminated',
    header + '"x"oops,a,b,c,d',
    "url,username,password,password\na,b,c,d",
  ])
    await assert.rejects(passwords.preview(csv), /CSV|字段|格式/);
  await assert.rejects(passwords.preview("x".repeat(10 * 1024 * 1024 + 1)), /10 MiB|大小|过大/);
  await assert.rejects(
    passwords.preview(header + csvRow("", "https://a.test", "a", "b", "").repeat(10001)),
    /10000|数量/,
  );
  const preview = await passwords.preview(
    header +
      csvRow("bad", "javascript:alert(1)", "a", "b", "") +
      csvRow("bad", "https://example.test", "a", "", "") +
      csvRow("bad", "https://example.test", "a", "x".repeat(4097), "") +
      csvRow("ok", "https://example.test", "a", "valid", ""),
  );
  assert.deepEqual([preview.total, preview.invalid, preview.added], [4, 3, 1]);
  const result = await passwords.commit(preview.ticket);
  assert.deepEqual([result.imported, result.skipped], [1, 3]);
});

test("取消、超时与锁库清除票据；锁前排队任务不能在重新解锁后执行", async (t) => {
  let time = 1000;
  const { vault, passwords } = await setup(t, { now: () => time });
  const csv = header + csvRow("", "https://example.test/", "alice", "secret", "");
  const canceled = await passwords.preview(csv);
  passwords.cancel(canceled.ticket);
  await assert.rejects(passwords.commit(canceled.ticket), /失效|过期/);
  const expired = await passwords.preview(csv);
  time += 5 * 60 * 1000 + 1;
  await assert.rejects(passwords.commit(expired.ticket), /失效|过期/);
  const locked = await passwords.preview(csv);
  const queued = passwords.saveCapture({
    url: "https://example.test",
    username: "queued",
    password: "secret",
  });
  vault.lock();
  await assert.rejects(queued, /锁定|取消/);
  await assert.rejects(passwords.exportCsv(), /锁定/);
  await vault.unlock(MASTER);
  await assert.rejects(passwords.commit(locked.ticket), /失效|过期/);
  assert.deepEqual(await vault.readAll("account:"), {});
});

test("导入落盘失败无部分凭据，票据可重试，重启从加密记录恢复资产", async (t) => {
  const { directory, file, vault, passwords } = await setup(t);
  const preview = await passwords.preview(
    header +
      csvRow("工作", "https://example.test/", "alice", "first", "") +
      csvRow("私人", "https://example.test/", "bob", "second", ""),
  );
  const backup = join(directory, "backup.enc");
  await rename(file, backup);
  await mkdir(file);
  await assert.rejects(passwords.commit(preview.ticket), /保存失败/);
  assert.deepEqual(await vault.readAll("account:"), {});
  await rm(file, { recursive: true });
  await rename(backup, file);
  const committed = await passwords.commit(preview.ticket);
  const restarted = new Vault(file);
  await restarted.unlock(MASTER);
  const restored = new BrowserPasswords({ vault: restarted, getAssets: () => [] });
  t.after(() => restored.clear());
  assert.deepEqual(await restored.managedAssets(), committed.assets);
  await restarted.remove(`account:${committed.assets[0].id}`);
  assert.equal((await restored.managedAssets()).length, 1);
});

test("等待资产快照期间取消预览，提交不再写入", async (t) => {
  let resolveAssets;
  let waitForAssets = false;
  const { vault, passwords } = await setup(t, {
    getAssets: () =>
      waitForAssets
        ? new Promise((resolve) => {
            resolveAssets = resolve;
          })
        : [],
  });
  const preview = await passwords.preview(
    header + csvRow("", "https://example.test/", "alice", "secret", ""),
  );
  waitForAssets = true;
  const committing = passwords.commit(preview.ticket);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof resolveAssets, "function");
  passwords.cancel(preview.ticket);
  resolveAssets([]);
  await assert.rejects(committing, /失效|过期/);
  assert.deepEqual(await vault.readAll("account:"), {});
});

test("浏览器保存拒绝不安全来源和超长秘密，来源账号标题与导出一致", async (t) => {
  const { vault, assets, passwords } = await setup(t);
  const capture = { url: "https://example.test/", username: "alice", password: "secret" };
  for (const changed of [
    { url: "http://public.test/" },
    { url: "https://alice:secret@example.test/" },
    { password: "x".repeat(4097) },
    { username: "alice\nother" },
    { title: "bad\0title" },
  ])
    await assert.rejects(passwords.saveCapture({ ...capture, ...changed }));
  assert.deepEqual(await vault.readAll("account:"), {});
  await vault.set("account:website", capture);
  assets.push({ id: "website", name: "账号名称" });
  assert.deepEqual(await passwords.listForOrigin(capture.url), [
    { id: "website", title: "账号名称", username: "alice" },
  ]);
  assert.match((await passwords.exportCsv()).csv, /账号名称/);
});

test("导入批量写入排在换主密码之后时，取消预览仍阻止提交", async (t) => {
  let waitOnRekey = false;
  let rekey;
  let vaultRef;
  const { vault, passwords } = await setup(t, {
    getAssets: () => {
      if (waitOnRekey) {
        waitOnRekey = false;
        rekey = vaultRef.changePassword(MASTER, "browser-next-master-for-test");
      }
      return [];
    },
  });
  vaultRef = vault;
  const preview = await passwords.preview(
    header + csvRow("", "https://example.test/", "alice", "secret", ""),
  );
  waitOnRekey = true;
  const committing = passwords.commit(preview.ticket);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(rekey);
  passwords.cancel(preview.ticket);
  await assert.rejects(committing, /失效|过期/);
  await rekey;
  assert.deepEqual(await vault.readAll("account:"), {});
});

test("浏览器保存入口拒绝已撤销授权，不读取资产或写入凭据", async (t) => {
  let snapshots = 0;
  const { vault, passwords } = await setup(t, {
    getAssets: () => {
      snapshots += 1;
      return [];
    },
  });
  const assertCurrent = () => {
    throw new Error("插件授权已撤销");
  };
  await assert.rejects(
    passwords.saveCapture(
      { url: "https://example.test/", username: "alice", password: "secret" },
      assertCurrent,
    ),
    /授权已撤销/,
  );
  assert.equal(snapshots, 0);
  assert.deepEqual(await vault.readAll("account:"), {});
});

test("浏览器保存等待资产快照时撤销授权，已有账号也不返回保存结果", async (t) => {
  let resolveAssets;
  let authorized = true;
  const { vault, passwords } = await setup(t, {
    getAssets: () =>
      new Promise((resolve) => {
        resolveAssets = resolve;
      }),
  });
  const capture = { url: "https://example.test/", username: "alice", password: "secret" };
  await vault.set("account:existing", capture);
  const saving = passwords.saveCapture(capture, () => {
    if (!authorized) throw new Error("插件授权已撤销");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof resolveAssets, "function");
  authorized = false;
  resolveAssets([]);
  await assert.rejects(saving, /授权已撤销/);
  assert.deepEqual(Object.keys(await vault.readAll("account:")), ["account:existing"]);
});

test("真实 Vault 换密队列中撤销并重新配对插件，旧保存请求不能在解锁状态落盘", async (t) => {
  let session = 1;
  let rekey;
  let vaultRef;
  let waitOnRekey = true;
  const nextMaster = "browser-revoked-pairing-next-master";
  const { file, vault, passwords } = await setup(t, {
    getAssets: () => {
      if (waitOnRekey) {
        waitOnRekey = false;
        rekey = vaultRef.changePassword(MASTER, nextMaster);
      }
      return [];
    },
  });
  vaultRef = vault;
  const capture = {
    url: "https://example.test/",
    username: "old-client",
    password: "never-committed",
  };
  const saving = passwords.saveCapture(capture, () => {
    if (session !== 1) throw new Error("插件授权已撤销");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(rekey);
  assert.equal(vault.unlocked, true);
  session = 2;
  await assert.rejects(saving, /授权已撤销/);
  await rekey;
  assert.equal(vault.unlocked, true);
  assert.deepEqual(await vault.readAll("account:"), {});
  const restarted = new Vault(file);
  await restarted.unlock(nextMaster);
  assert.deepEqual(await restarted.readAll("account:"), {});
  const newRequest = await passwords.saveCapture(
    { ...capture, username: "new-client", password: "new-session-secret" },
    () => {
      if (session !== 2) throw new Error("插件授权已撤销");
    },
  );
  assert.equal(newRequest.status, "created");
  assert.equal((await passwords.listForOrigin(capture.url))[0].username, "new-client");
});
