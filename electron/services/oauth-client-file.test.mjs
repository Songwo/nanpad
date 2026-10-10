import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { appendFile, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MAX_OAUTH_CLIENT_BYTES, readOAuthClientFile } from "./oauth-client-file.mjs";

const directories = [];
afterEach(async () => {
  mock.restoreAll();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture(content) {
  const directory = await mkdtemp(join(tmpdir(), "zhiyu-oauth-json-"));
  directories.push(directory);
  const path = join(directory, "client.json");
  await writeFile(path, content);
  return path;
}

test("客户端 JSON 支持标准配置与恰好 256 KB 的文件", async () => {
  const data = { installed: { client_id: "fixture-id", client_secret: "synthetic-secret" } };
  const path = await fixture(JSON.stringify(data).padEnd(MAX_OAUTH_CLIENT_BYTES, " "));
  assert.deepEqual(await readOAuthClientFile(path), data);
});

test("拒绝超限文件及目录", async () => {
  const path = await fixture(" ".repeat(MAX_OAUTH_CLIENT_BYTES + 1));
  await assert.rejects(readOAuthClientFile(path), /256 KB/);
  await assert.rejects(readOAuthClientFile(directories[0]));
});

test("无效 JSON 不将客户端密钥片段带入错误提示", async () => {
  const path = await fixture('{"client_secret":"synthetic-secret-do-not-echo"');
  await assert.rejects(readOAuthClientFile(path), (error) => {
    assert.equal(error.message, "客户端配置不是有效的 JSON 文件，请重新从服务商下载。");
    assert.equal(error.message.includes("synthetic-secret"), false);
    return true;
  });
});

test("检查大小后文件增长仍拒绝超限内容", async () => {
  const path = await fixture("{}");
  const handle = await open(path, "r");
  const prototype = Object.getPrototypeOf(handle);
  const originalStat = prototype.stat;
  await handle.close();
  mock.method(prototype, "stat", async function (...args) {
    const info = await originalStat.apply(this, args);
    await appendFile(path, " ".repeat(MAX_OAUTH_CLIENT_BYTES));
    return info;
  });
  await assert.rejects(readOAuthClientFile(path), /256 KB/);
});
