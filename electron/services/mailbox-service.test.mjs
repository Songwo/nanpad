import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MailboxService } from "./mailbox-service.mjs";
import { queryMailbox, validateMailboxConnection } from "./mail.mjs";

const connection = { host: "imap.example.com", port: 993, secure: true };
const credentials = { username: "fixture@example.com", password: "fixture-app-password" };
const mailbox = { id: "mail-1", kind: "mailbox", address: "fixture@example.com", imap: connection };
const raw = (changes = {}) => ({
  messages: 12,
  unseen: 3,
  uidValidity: "123",
  uidNext: 21,
  newMessages: 2,
  ...changes,
});

class FakeImap extends EventEmitter {
  calls = [];
  closed = 0;
  constructor({ status, uids, error, wait } = {}) {
    super();
    this.response = status ?? { messages: 12, unseen: 3, uidValidity: 123n, uidNext: 21 };
    this.uids = uids ?? [11, 15, 20];
    this.error = error;
    this.wait = wait;
  }
  async connect() {
    if (this.error) throw this.error;
    if (this.wait) await this.wait;
  }
  async mailboxOpen(...args) {
    this.calls.push(["open", ...args]);
  }
  async status(...args) {
    this.calls.push(["status", ...args]);
    return this.response;
  }
  async search(...args) {
    this.calls.push(["search", ...args]);
    return this.uids;
  }
  async getQuota() {
    return { storage: { usage: 2048, limit: 10240 } };
  }
  async logout() {
    this.calls.push(["logout"]);
  }
  close() {
    this.closed += 1;
  }
}

function run(client, changes = {}, options = {}) {
  return queryMailbox(
    { ...connection, ...credentials, address: mailbox.address, ...changes },
    { createClient: () => client, ...options },
  );
}

async function setup(t, query = async () => raw(), assets = [mailbox]) {
  const directory = await mkdtemp(join(tmpdir(), "nanpad-mailbox-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vault = {
    unlocked: true,
    async get(id) {
      assert.ok(id.startsWith("account:"));
      return credentials;
    },
  };
  const getSnapshot = () => ({ mailboxes: assets });
  const create = () => new MailboxService({ directory, vault, getSnapshot, queryMailbox: query });
  return { service: create(), create, vault, directory };
}

test("IMAP uses TLS, reads counts only and counts real UID hits across gaps", async () => {
  const client = new FakeImap({ uids: [9, 11, 15, 15, 20, 21, "secret-body"] });
  let options;
  const result = await queryMailbox(
    { ...connection, ...credentials, baseline: { uidValidity: "123", uidNext: 10 } },
    {
      createClient(value) {
        options = value;
        return client;
      },
    },
  );
  assert.equal(result.newMessages, 3);
  assert.equal(result.unseen, 3);
  assert.equal(result.usedMb, 2);
  assert.equal(result.quotaMb, 10);
  assert.deepEqual(
    client.calls.find(([name]) => name === "search"),
    ["search", { uid: "10:20" }, { uid: true }],
  );
  assert.deepEqual(
    client.calls.find(([name]) => name === "open"),
    ["open", "INBOX", { readOnly: true }],
  );
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.secure, true);
  assert.equal(options.logger, false);
  assert.ok(client.closed > 0);
});

test("initial and reset UIDVALIDITY checks return null instead of treating unread as new", async () => {
  for (const baseline of [
    undefined,
    { uidValidity: "other", uidNext: 10 },
    { uidValidity: "123", uidNext: 30 },
  ]) {
    const client = new FakeImap();
    const result = await run(client, { baseline });
    assert.equal(result.newMessages, null);
    assert.equal(
      client.calls.some(([name]) => name === "search"),
      false,
    );
  }
  const unchanged = new FakeImap();
  assert.equal(
    (await run(unchanged, { baseline: { uidValidity: "123", uidNext: 21 } })).newMessages,
    0,
  );
  assert.equal(
    unchanged.calls.some(([name]) => name === "search"),
    false,
  );
});

test("unsupported quota is omitted and malformed counts fail closed", async () => {
  const unsupported = new FakeImap();
  unsupported.getQuota = async () => {
    throw new Error("QUOTA unsupported");
  };
  const result = await run(unsupported);
  assert.equal("quotaMb" in result, false);
  await assert.rejects(
    run(new FakeImap({ status: { messages: undefined, unseen: 0 } })),
    /邮箱检查失败/,
  );
});

test("IMAP failures never return arbitrary server messages or credentials", async () => {
  const client = new FakeImap({ error: new Error(`PRIVATE SUBJECT ${credentials.password}`) });
  await assert.rejects(run(client), (error) => {
    assert.equal(error.message, "邮箱检查失败，请检查 IMAP 设置、网络及账号权限");
    return true;
  });
  assert.ok(client.closed > 0);
});

test("timeout and abort both close the IMAP client", async () => {
  const timed = new FakeImap({ wait: new Promise(() => {}) });
  await assert.rejects(run(timed, {}, { timeoutMs: 15 }), /超时/);
  assert.ok(timed.closed > 0);
  const aborted = new FakeImap({ wait: new Promise(() => {}) });
  const controller = new AbortController();
  const pending = run(aborted, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /取消/);
  assert.ok(aborted.closed > 0);
});

test("connection settings reject insecure and malformed targets", () => {
  assert.deepEqual(
    validateMailboxConnection({ host: " IMAP.EXAMPLE.COM ", port: "993", secure: true }),
    connection,
  );
  for (const value of [
    { ...connection, secure: false },
    { ...connection, host: "https://example.com" },
    { ...connection, host: "x\r\nLOGIN" },
    { ...connection, port: 0 },
    { ...connection, port: 1.5 },
  ]) {
    assert.throws(() => validateMailboxConnection(value));
  }
});

test("service uses vault credentials and persists a private baseline across restarts", async (t) => {
  const calls = [];
  const fixture = await setup(t, async (request) => {
    calls.push(request);
    return raw({ password: "should-not-return", body: "should-not-return" });
  });
  const first = await fixture.service.check(mailbox.id);
  assert.equal(first.newMessages, null);
  assert.deepEqual(Object.keys(first).sort(), [
    "address",
    "assetId",
    "checkedAt",
    "messages",
    "newMessages",
    "unseen",
  ]);
  const second = await fixture.create().check(mailbox.id);
  assert.equal(second.newMessages, 2);
  assert.equal(calls[0].password, credentials.password);
  assert.deepEqual(calls[1].baseline, { uidValidity: "123", uidNext: 21 });
  const disk = await readFile(join(fixture.directory, "mailbox-baselines.json"), "utf8");
  assert.equal(disk.includes(credentials.password), false);
  assert.equal(disk.includes(credentials.username), false);
  assert.equal(disk.includes(connection.host), false);
});

test("推送检查仅返回调用方游标，交互检查继续独立持久化", async (t) => {
  const fixture = await setup(t);
  assert.equal((await fixture.service.check(mailbox.id)).newMessages, null);
  const firstPush = await fixture.service.check(mailbox.id, { cursor: "push" });
  assert.equal(firstPush.newMessages, null);
  assert.equal(firstPush.checkpoint.version, 1);
  assert.match(firstPush.checkpoint.identity, /^[a-f0-9]{64}$/);
  assert.equal((await fixture.service.check(mailbox.id)).newMessages, 2);
  assert.equal((await fixture.create().check(mailbox.id, { cursor: "push" })).newMessages, null);
  assert.equal(
    (await fixture.create().check(mailbox.id, { cursor: "push", checkpoint: firstPush.checkpoint }))
      .newMessages,
    2,
  );
  assert.equal("checkpoint" in (await fixture.service.check(mailbox.id)), false);
});

test("推送游标不会单独写入磁盘，且必须匹配连接与凭据身份", async (t) => {
  const asset = structuredClone(mailbox);
  const fixture = await setup(t, async () => raw(), [asset]);
  const first = await fixture.service.check(asset.id, { cursor: "push" });
  await assert.rejects(readFile(join(fixture.directory, "mailbox-baselines.json")), {
    code: "ENOENT",
  });
  asset.imap.host = "imap.changed.example";
  assert.equal(
    (await fixture.service.check(asset.id, { cursor: "push", checkpoint: first.checkpoint }))
      .newMessages,
    null,
  );
  asset.imap.host = mailbox.imap.host;
  fixture.vault.get = async () => ({ ...credentials, username: "different@example.com" });
  assert.equal(
    (await fixture.service.check(asset.id, { cursor: "push", checkpoint: first.checkpoint }))
      .newMessages,
    null,
  );
  fixture.vault.get = async () => credentials;
  assert.equal(
    (
      await fixture.service.check(asset.id, {
        cursor: "push",
        checkpoint: { ...first.checkpoint, uidNext: -1 },
      })
    ).newMessages,
    null,
  );
});

test("server or credential identity changes reset the baseline", async (t) => {
  const entry = structuredClone(mailbox);
  const fixture = await setup(t, async () => raw(), [entry]);
  await fixture.service.check(entry.id);
  entry.imap.host = "imap.other.example";
  assert.equal((await fixture.service.check(entry.id)).newMessages, null);
});

test("unknown, demo, alias, missing settings and locked mailboxes cannot connect", async (t) => {
  let calls = 0;
  const fixture = await setup(t, async () => {
    calls += 1;
    return raw();
  }, [
    mailbox,
    { ...mailbox, id: "demo", demo: true },
    { ...mailbox, id: "alias", kind: "alias" },
    { ...mailbox, id: "missing-settings", imap: undefined },
  ]);
  for (const id of ["missing", "demo", "alias", "missing-settings"])
    await assert.rejects(fixture.service.check(id));
  fixture.vault.unlocked = false;
  await assert.rejects(fixture.service.check(mailbox.id), /解锁/);
  assert.equal(calls, 0);
});

test("same mailbox queries are serialized and observe the committed baseline", async (t) => {
  let active = 0;
  let high = 0;
  const seen = [];
  const fixture = await setup(t, async (request) => {
    active += 1;
    high = Math.max(active, high);
    seen.push(request.baseline);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return raw();
  });
  const results = await Promise.all([
    fixture.service.check(mailbox.id),
    fixture.service.check(mailbox.id),
  ]);
  assert.equal(high, 1);
  assert.equal(results[0].newMessages, null);
  assert.equal(results[1].newMessages, 2);
  assert.deepEqual(seen[1], { uidValidity: "123", uidNext: 21 });
});

test("different mailbox baseline writes do not overwrite each other", async (t) => {
  const fixture = await setup(t, async () => raw(), [mailbox, { ...mailbox, id: "mail-2" }]);
  await Promise.all([fixture.service.check(mailbox.id), fixture.service.check("mail-2")]);
  const restarted = fixture.create();
  assert.equal((await restarted.check(mailbox.id)).newMessages, 2);
  assert.equal((await restarted.check("mail-2")).newMessages, 2);
});

test("locking the vault aborts an active query and does not commit its baseline", async (t) => {
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const fixture = await setup(
    t,
    ({ signal }) =>
      new Promise((_, reject) => {
        entered();
        signal.addEventListener("abort", () => reject(new Error("private upstream abort")), {
          once: true,
        });
      }),
  );
  const pending = fixture.service.check(mailbox.id);
  await started;
  fixture.vault.unlocked = false;
  await assert.rejects(pending, /取消|锁定/);
  await assert.rejects(readFile(join(fixture.directory, "mailbox-baselines.json")), {
    code: "ENOENT",
  });
});

test("service sanitizes custom transport failures and pre-aborted checks never connect", async (t) => {
  let calls = 0;
  const fixture = await setup(t, async () => {
    calls += 1;
    throw new Error("邮箱检查: PRIVATE BODY fixture-app-password");
  });
  await assert.rejects(fixture.service.check(mailbox.id), {
    message: "邮箱检查失败，请检查 IMAP 设置、网络及账号权限",
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fixture.service.check(mailbox.id, { signal: controller.signal }), /取消/);
  assert.equal(calls, 1);
});

test("stop cancels active and already queued mailbox checks", async (t) => {
  let entered;
  let calls = 0;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const fixture = await setup(
    t,
    ({ signal }) =>
      new Promise((_, reject) => {
        calls += 1;
        entered();
        signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      }),
  );
  const active = fixture.service.check(mailbox.id);
  const queued = fixture.service.check(mailbox.id);
  const activeRejected = assert.rejects(active, /取消/);
  const queuedRejected = assert.rejects(queued, /取消/);
  await started;
  fixture.service.stop();
  await Promise.all([activeRejected, queuedRejected]);
  assert.equal(calls, 1);
});
