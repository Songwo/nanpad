import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import ssh2 from "ssh2";
import { SshManager } from "./ssh.mjs";
import { remotePath } from "./sftp.mjs";

test("SFTP 通过真实 SSH 协议列目录、下载文件并处理拒绝访问", { timeout: 30000 }, async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const { STATUS_CODE } = ssh2.utils.sftp;
  const payload = Buffer.from("Nanpad SFTP fixture\n中文文件内容\n");
  const attrs = (directory = false) => ({
    mode: directory ? 0o40755 : 0o100644,
    size: directory ? 0 : payload.length,
    uid: 1000,
    gid: 1000,
    atime: 1700000000,
    mtime: 1700000000,
  });
  const connections = new Set();
  const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
    connections.add(client);
    client.on("close", () => connections.delete(client));
    client.on("error", () => {});
    client.on("authentication", (ctx) =>
      ctx.method === "password" && ctx.username === "tester" && ctx.password === "fixture"
        ? ctx.accept()
        : ctx.reject(),
    );
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        session.on("sftp", (acceptSftp) => {
          const stream = acceptSftp();
          const readDirs = new Set();
          stream.on("REALPATH", (id, path) =>
            stream.name(id, [
              { filename: posix.resolve("/home/tester", path), longname: "", attrs: attrs(true) },
            ]),
          );
          stream.on("OPENDIR", (id, path) =>
            path === "/denied"
              ? stream.status(id, STATUS_CODE.PERMISSION_DENIED)
              : stream.handle(id, Buffer.from(path)),
          );
          stream.on("READDIR", (id, handle) => {
            const path = handle.toString();
            if (readDirs.has(path)) {
              stream.status(id, STATUS_CODE.EOF);
              return;
            }
            readDirs.add(path);
            stream.name(id, [
              { filename: "readme.txt", longname: "", attrs: attrs() },
              { filename: "folder", longname: "", attrs: attrs(true) },
            ]);
          });
          stream.on("STAT", (id, path) =>
            path.endsWith("readme.txt")
              ? stream.attrs(id, attrs())
              : stream.status(id, STATUS_CODE.NO_SUCH_FILE),
          );
          stream.on("OPEN", (id, path) =>
            path.endsWith("readme.txt")
              ? stream.handle(id, Buffer.from("file"))
              : stream.status(id, STATUS_CODE.NO_SUCH_FILE),
          );
          stream.on("READ", (id, _handle, offset, length) =>
            offset >= payload.length
              ? stream.status(id, STATUS_CODE.EOF)
              : stream.data(id, payload.subarray(offset, offset + length)),
          );
          stream.on("CLOSE", (id) => stream.status(id, STATUS_CODE.OK));
        });
      }),
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const dir = await mkdtemp(join(tmpdir(), "nanpad-sftp-"));
  const target = {
    id: "fixture",
    host: "127.0.0.1",
    port: server.address().port,
    username: "tester",
  };
  const credential = { kind: "password", password: "fixture" };
  const manager = new SshManager(() => {});
  try {
    const result = await manager.sftp.list(target, credential, ".");
    assert.equal(result.path, "/home/tester");
    assert.equal(result.entries[0].name, "folder");
    assert.equal(result.entries[1].size, payload.length);
    const destination = join(dir, "download.txt");
    await manager.sftp.download(target, credential, "/home/tester/readme.txt", destination);
    assert.deepEqual(await readFile(destination), payload);
    await assert.rejects(manager.sftp.list(target, credential, "/denied"));
    await assert.rejects(
      manager.sftp.download(target, credential, "/missing", join(dir, "missing.txt")),
    );
    assert.deepEqual(await readdir(dir), ["download.txt"]);
    assert.throws(() => remotePath("/invalid\npath"));
  } finally {
    manager.closeAll();
    for (const client of connections) client.end();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
