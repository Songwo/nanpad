import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  appendFile,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { LOCAL_USAGE_LIMITS, LocalUsageMonitor } from "./local-usage.mjs";

const TIME = "2026-10-06T10:00:00.000Z";
const line = (value) => `${JSON.stringify(value)}\n`;
const codexMeta = (session = "synthetic-session") =>
  line({ type: "session_meta", payload: { id: session, cwd: "PRIVATE_WORKSPACE_MARKER" } });
const context = (model = "gpt-5.4") => line({ type: "turn_context", payload: { model } });
const codex = (input, output, cached = 0, timestamp = TIME) =>
  line({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          output_tokens: output,
          cached_input_tokens: cached,
          reasoning_output_tokens: output,
        },
        last_token_usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0 },
      },
    },
  });
const claude = ({
  id = "msg-synthetic",
  input = 100,
  output = 20,
  cached = 30,
  cacheWrite = 40,
  model = "claude-sonnet-4-6",
  time = TIME,
  requestId = "req-synthetic",
} = {}) =>
  line({
    type: "assistant",
    timestamp: time,
    sessionId: "claude-session",
    requestId,
    message: {
      id,
      model,
      content: [{ text: "PRIVATE_CONVERSATION_MARKER" }],
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: cached,
        cache_creation_input_tokens: cacheWrite,
      },
    },
  });

async function fixture(t, createRoots = true) {
  const root = await mkdtemp(join(tmpdir(), "nanpad-local-usage-test-"));
  const roots = {
    codex: [join(root, "codex", "sessions"), join(root, "codex", "archived_sessions")],
    claude: [join(root, "claude", "projects")],
    grok: [join(root, "grok", "sessions")],
    gemini: [join(root, "gemini", "tmp")],
  };
  if (createRoots)
    await Promise.all(
      Object.values(roots)
        .flat()
        .map((path) => mkdir(path, { recursive: true })),
    );
  const file = join(root, "cache", "usage.json");
  const monitors = [];
  const monitor = (options = {}) => {
    const instance = new LocalUsageMonitor({
      file,
      roots,
      now: () => Date.parse(TIME),
      ...options,
    });
    monitors.push(instance);
    return instance;
  };
  t.after(async () => {
    for (const instance of monitors) await instance.configure({ enabled: false }).catch(() => {});
    const child = relative(resolve(tmpdir()), resolve(root));
    assert.ok(child && !child.startsWith("..") && !isAbsolute(child));
    await rm(root, { recursive: true, force: true });
  });
  return { root, roots, file, monitor };
}

async function enabled(f) {
  const monitor = f.monitor();
  await monitor.configure({ enabled: true });
  await monitor.refresh();
  return monitor;
}

test("默认开启并采集；主动关闭后重启仍关闭，接口拒绝目录等附加参数", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.roots.codex[0], "session.jsonl"),
    codexMeta() + context() + codex(100, 20),
  );
  const monitor = f.monitor();
  assert.equal((await monitor.status()).enabled, true);
  await monitor.refresh();
  assert.equal((await monitor.list()).records.length, 1);
  assert.equal((await monitor.status()).sources[0].available, true);
  await monitor.configure({ enabled: false });
  assert.equal((await f.monitor().status()).enabled, false);
  await assert.rejects(monitor.configure({ enabled: true, roots: [f.root] }), /只接受/);
});

test("不存在的客户端目录显示未检测到，不生成虚假的零用量", async (t) => {
  const f = await fixture(t, false);
  const monitor = await enabled(f);
  assert.equal((await monitor.list()).records.length, 0);
  assert.ok((await monitor.status()).sources.every((source) => !source.available && !source.error));
});

test("只有统计增量改变版本号，重复扫描或状态切换不误报记录变化", async (t) => {
  const f = await fixture(t);
  const path = join(f.roots.codex[0], "session.jsonl");
  await writeFile(path, codexMeta() + context() + codex(100, 20));
  const monitor = await enabled(f);
  const version = monitor.recordsRevision;
  assert.ok(version > 0);
  await monitor.refresh();
  assert.equal(monitor.recordsRevision, version);
  await appendFile(path, codex(120, 25));
  await monitor.refresh();
  assert.equal(monitor.recordsRevision, version + 1);
  await monitor.configure({ enabled: false });
  await monitor.refresh();
  assert.equal(monitor.recordsRevision, version + 1);
});

test("Codex 累计差分、重复快照、归档副本和计数重置不会重复计数", async (t) => {
  const f = await fixture(t);
  const body =
    codexMeta() +
    context() +
    codex(100, 30, 40) +
    codex(160, 50, 70, "2026-10-06T10:01:00Z") +
    codex(160, 50, 70, "2026-10-06T10:02:00Z") +
    codex(20, 10, 5, "2026-10-06T10:03:00Z") +
    codex(60, 20, 10, "2026-10-06T10:04:00Z");
  await writeFile(join(f.roots.codex[0], "rollout-session.jsonl"), body);
  await writeFile(join(f.roots.codex[1], "rollout-session.jsonl"), body);
  const monitor = await enabled(f);
  const [row] = (await monitor.list()).records;
  assert.equal(row.input, 220);
  assert.equal(row.output, 70);
  assert.equal(row.cached, 80);
  assert.equal(row.cacheWrite, 0);
  assert.equal(row.origin, "local");
  assert.equal(row.model, "gpt-5.4");
  assert.equal(row.sourceId, "local:codex");
  await monitor.refresh();
  assert.deepEqual((await monitor.list()).records, [row]);
});

test("Codex last_token_usage 后备按事件去重，模型切换分开汇总", async (t) => {
  const f = await fixture(t);
  const event = line({
    timestamp: TIME,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 12,
          output_tokens: 5,
          cached_input_tokens: 3,
          reasoning_output_tokens: 4,
        },
      },
    },
  });
  await writeFile(
    join(f.roots.codex[0], "session.jsonl"),
    codexMeta() +
      context() +
      event +
      event +
      context("gpt-5.5") +
      codex(20, 10, 5, "2026-10-07T10:00:00Z"),
  );
  const monitor = await enabled(f);
  const rows = (await monitor.list()).records;
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.model === "gpt-5.4").output, 5);
  assert.equal(rows.find((row) => row.model === "gpt-5.5").input, 8);
});

test("Claude 缓存读写计入输入且为子集，流式重复块只累计 usage 的增加", async (t) => {
  const f = await fixture(t);
  const folder = join(f.roots.claude[0], "synthetic-project");
  await mkdir(folder);
  await writeFile(
    join(folder, "session.jsonl"),
    claude() +
      claude() +
      claude({ output: 35 }) +
      claude({ output: 25 }) +
      claude({ id: "second-message", input: 10, output: 5, cached: 2, cacheWrite: 3 }),
  );
  const monitor = await enabled(f);
  const [row] = (await monitor.list()).records;
  assert.deepEqual(
    { input: row.input, output: row.output, cached: row.cached, cacheWrite: row.cacheWrite },
    { input: 185, output: 40, cached: 32, cacheWrite: 43 },
  );
});

test("部分写入仅在换行完成后计入；重启从安全偏移继续且缓存不含会话内容和路径", async (t) => {
  const f = await fixture(t);
  const path = join(f.roots.claude[0], "PRIVATE_FILENAME_MARKER.jsonl");
  const body = claude();
  await writeFile(path, body.slice(0, -20));
  const first = await enabled(f);
  assert.equal((await first.list()).records.length, 0);
  await appendFile(path, body.slice(-20));
  await first.refresh();
  assert.equal((await first.list()).records[0].input, 170);
  const second = f.monitor();
  assert.equal((await second.status()).enabled, true);
  await second.refresh();
  assert.equal((await second.list()).records[0].input, 170);
  const saved = await readFile(f.file, "utf8");
  assert.ok(
    !saved.includes("PRIVATE_") &&
      !saved.includes(f.root) &&
      !saved.includes("claude-session") &&
      !saved.includes("msg-synthetic") &&
      !saved.includes("req-synthetic"),
  );
});

test("暂停保留历史、停止新采集，恢复后补录暂停期间增量", async (t) => {
  const f = await fixture(t);
  const path = join(f.roots.codex[0], "session.jsonl");
  await writeFile(path, codexMeta() + context() + codex(100, 20));
  const monitor = await enabled(f);
  await monitor.configure({ enabled: false });
  await appendFile(path, codex(150, 40, 0, "2026-10-06T11:00:00Z"));
  await monitor.refresh();
  assert.equal((await monitor.list()).records[0].input, 100);
  await monitor.configure({ enabled: true });
  await monitor.refresh();
  assert.equal((await monitor.list()).records[0].input, 150);
});

test("截断后重新写入、更大文件替换及移入归档均保留去重", async (t) => {
  const f = await fixture(t);
  const path = join(f.roots.codex[0], "session.jsonl");
  const original = codexMeta() + context() + codex(100, 20);
  await writeFile(path, original);
  const monitor = await enabled(f);
  await writeFile(path, codexMeta());
  await monitor.refresh();
  await appendFile(path, context() + codex(100, 20) + codex(150, 40, 0, "2026-10-06T11:00:00Z"));
  await monitor.refresh();
  assert.equal((await monitor.list()).records[0].input, 150);
  const alternate =
    codexMeta("another-session") +
    context() +
    codex(60, 12) +
    line({ type: "user", text: "x".repeat(500) });
  await writeFile(path, alternate);
  await monitor.refresh();
  assert.equal(
    (await monitor.list()).records.reduce((sum, row) => sum + row.input, 0),
    210,
  );
  await rename(path, join(f.roots.codex[1], "archived.jsonl"));
  await writeFile(path, codexMeta("third-session") + context() + codex(30, 8));
  await monitor.refresh();
  assert.equal(
    (await monitor.list()).records.reduce((sum, row) => sum + row.input, 0),
    240,
  );
});

test("损坏 JSON、无效数字、提示词和非日志凭据文件均不转成用量", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.roots.codex[0], "auth.json"), "CREDENTIAL_MARKER");
  await writeFile(join(f.roots.codex[0], "config.toml"), "CREDENTIAL_MARKER");
  await writeFile(
    join(f.roots.codex[0], "session.jsonl"),
    "{broken PRIVATE_ERROR_MARKER\n" +
      line({ type: "user", message: "PRIVATE_CONVERSATION_MARKER" }) +
      codexMeta() +
      context("C:/private/path") +
      codex(-5, 10) +
      codex(10, Number.MAX_SAFE_INTEGER + 1) +
      codex(10, 5, 30) +
      codex(40, 6, 10),
  );
  const monitor = await enabled(f);
  const [row] = (await monitor.list()).records;
  assert.equal(row.input, 40);
  assert.equal(row.output, 6);
  assert.equal(row.model, "unknown");
  const status = JSON.stringify(await monitor.status());
  assert.ok(status.includes("损坏日志行"));
  assert.ok(!status.includes("PRIVATE_") && !status.includes(f.root));
  const saved = await readFile(f.file, "utf8");
  assert.ok(
    !saved.includes("PRIVATE_") &&
      !saved.includes("CREDENTIAL_MARKER") &&
      !saved.includes("C:/private"),
  );
});

test("超长日志逐轮跳过，不阻塞后续合法用量，单轮读取有上限", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.roots.codex[0], "session.jsonl"),
    "x".repeat(LOCAL_USAGE_LIMITS.bytesPerFile + 100) +
      "\n" +
      codexMeta() +
      context() +
      codex(55, 11),
  );
  const monitor = await enabled(f);
  assert.equal((await monitor.list()).records.length, 0);
  let saved = JSON.parse(await readFile(f.file, "utf8"));
  assert.ok(saved.checkpoints[0][1].offset <= LOCAL_USAGE_LIMITS.bytesPerFile);
  const restarted = f.monitor();
  await restarted.refresh();
  assert.equal((await restarted.list()).records[0].input, 55);
  saved = await readFile(f.file, "utf8");
  assert.ok(saved.length < 5000);
  assert.ok(
    (await restarted.status()).sources[0].warnings.some((warning) =>
      warning.includes("超长日志行"),
    ),
  );
});

test("文件轮询采用有界轮转，大目录后续刷新仍能采集新文件", async (t) => {
  const f = await fixture(t);
  const count = LOCAL_USAGE_LIMITS.filesPerRefresh + 3;
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      writeFile(
        join(f.roots.codex[0], `${index}.jsonl`),
        codexMeta(`session-${index}`) + context() + codex(1, 1),
      ),
    ),
  );
  const monitor = await enabled(f);
  assert.equal((await monitor.list()).records.length, LOCAL_USAGE_LIMITS.filesPerRefresh);
  await monitor.refresh();
  assert.equal((await monitor.list()).records.length, count);
});

test("子目录 junction 不得逃出日志根，可信根 junction 只解析一次并固定目标", async (t) => {
  const f = await fixture(t);
  const outside = join(f.root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "session.jsonl"), codexMeta() + context() + codex(9999, 9999));
  await symlink(
    outside,
    join(f.roots.codex[0], "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const monitor = await enabled(f);
  assert.equal((await monitor.list()).records.length, 0);
  assert.ok(
    (await monitor.status()).sources[0].warnings.some((warning) => warning.includes("链接")),
  );
  const linkedRoot = join(f.root, "linked-root");
  await symlink(outside, linkedRoot, process.platform === "win32" ? "junction" : "dir");
  const second = new LocalUsageMonitor({
    file: join(f.root, "alternate-cache.json"),
    roots: { codex: [linkedRoot] },
  });
  await second.configure({ enabled: true });
  await second.refresh();
  assert.equal((await second.list()).records[0].input, 9999);
  assert.equal((await second.status()).sources[0].available, true);
  const redirected = join(f.root, "redirected");
  await mkdir(redirected);
  await writeFile(
    join(redirected, "redirected.jsonl"),
    codexMeta("redirected-session") + context() + codex(50000, 1),
  );
  await rename(linkedRoot, join(f.root, "old-link"));
  await symlink(redirected, linkedRoot, process.platform === "win32" ? "junction" : "dir");
  await second.refresh();
  assert.equal(
    (await second.list()).records.reduce((sum, row) => sum + row.input, 0),
    9999,
  );
  await second.configure({ enabled: false });
});

test("系统将缓存文件透明重定向时可重启读取，保留历史和去重状态", async (t) => {
  const f = await fixture(t);
  const log = join(f.roots.codex[0], "session.jsonl");
  await writeFile(log, codexMeta() + context() + codex(100, 20));
  const initial = await enabled(f);
  const backing = join(f.root, "package-cache", "usage.json");
  await mkdir(join(f.root, "package-cache"));
  await rename(f.file, backing);
  // 模拟 Windows 包应用文件虚拟化：目录没有链接，逻辑文件的元信息与句柄均指向系统映射后的文件。
  const redirect = (path) =>
    typeof path === "string" && (path === f.file || path.startsWith(`${f.file}.`))
      ? backing + path.slice(f.file.length)
      : path;
  const originals = Object.fromEntries(
    ["lstat", "open", "realpath", "rename", "unlink"].map((key) => [key, fs.promises[key]]),
  );
  for (const key of ["lstat", "open", "realpath", "unlink"])
    fs.promises[key] = (path, ...args) => originals[key](redirect(path), ...args);
  fs.promises.rename = (from, to) => originals.rename(redirect(from), redirect(to));
  syncBuiltinESMExports();
  try {
    const restarted = f.monitor();
    assert.equal((await restarted.status()).error, undefined);
    assert.equal((await restarted.status()).enabled, true);
    assert.equal((await restarted.list()).records[0].input, 100);
    await restarted.refresh();
    assert.equal((await restarted.list()).records[0].input, 100, "重启不重放已有用量");
    await appendFile(log, codex(150, 30));
    await restarted.refresh();
    assert.equal((await restarted.list()).records[0].input, 150);
    const again = f.monitor();
    assert.equal((await again.status()).error, undefined);
    assert.equal((await again.list()).records[0].input, 150, "映射后的写入能再次读取");
    assert.equal((await initial.list()).records[0].input, 100);
  } finally {
    Object.assign(fs.promises, originals);
    syncBuiltinESMExports();
  }
});

test("缓存 realpath 指向不同文件或缓存为硬链接时仍拒绝读取", async (t) => {
  const f = await fixture(t);
  await enabled(f);
  const other = join(f.root, "other.json");
  await copyFile(f.file, other);
  const original = fs.promises.realpath;
  fs.promises.realpath = (path, ...args) => original(path === f.file ? other : path, ...args);
  syncBuiltinESMExports();
  try {
    const monitor = f.monitor();
    assert.ok((await monitor.status()).error);
    assert.equal((await monitor.status()).enabled, false);
  } finally {
    fs.promises.realpath = original;
    syncBuiltinESMExports();
  }
  const alias = join(f.root, "hardlink.json");
  await link(f.file, alias);
  const linked = f.monitor({ file: alias });
  assert.ok((await linked.status()).error);
  assert.equal((await linked.status()).enabled, false);
});

test("缓存父目录使用同身份路径别名时可首次写入并重启恢复", async (t) => {
  const f = await fixture(t);
  const alias = join(f.root, "short-cache-alias");
  const canonical = join(f.root, "cache");
  const file = join(alias, "usage.json");
  const remap = (path) =>
    typeof path === "string" &&
    (path === alias || path.startsWith(alias + (process.platform === "win32" ? "\\" : "/")))
      ? canonical + path.slice(alias.length)
      : path;
  const names = ["mkdir", "lstat", "open", "realpath", "rename", "unlink"];
  const originals = Object.fromEntries(names.map((name) => [name, fs.promises[name]]));
  for (const name of names.filter((name) => name !== "rename"))
    fs.promises[name] = (path, ...args) => originals[name](remap(path), ...args);
  fs.promises.rename = (from, to) => originals.rename(remap(from), remap(to));
  syncBuiltinESMExports();
  try {
    await writeFile(
      join(f.roots.codex[0], "session.jsonl"),
      codexMeta() + context() + codex(100, 20),
    );
    const monitor = f.monitor({ file });
    await monitor.configure({ enabled: true });
    await monitor.refresh();
    assert.equal((await monitor.list()).records[0].input, 100);
    const restarted = f.monitor({ file });
    assert.equal((await restarted.status()).enabled, true);
    assert.equal((await restarted.status()).error, undefined);
    await restarted.refresh();
    assert.equal((await restarted.list()).records[0].input, 100, "目录别名重启不重复累计");
  } finally {
    Object.assign(fs.promises, originals);
    syncBuiltinESMExports();
  }
});

test("缓存父目录别名指向不同身份或显式 junction 时仍拒绝写入", async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, "cache");
  const different = join(f.root, "other-cache");
  await mkdir(directory);
  await mkdir(different);
  const original = fs.promises.realpath;
  fs.promises.realpath = (path, ...args) =>
    original(path === directory ? different : path, ...args);
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.monitor().configure({ enabled: true }), /缓存保存失败/);
    await assert.rejects(readFile(f.file), { code: "ENOENT" });
  } finally {
    fs.promises.realpath = original;
    syncBuiltinESMExports();
  }
  const linked = join(f.root, "linked-cache");
  await symlink(directory, linked, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    f.monitor({ file: join(linked, "usage.json") }).configure({ enabled: true }),
    /缓存无法安全读取|缓存保存失败/,
  );
  await assert.rejects(readFile(f.file), { code: "ENOENT" });
});

test("并发刷新和暂停串行化，缓存损坏时停止而不重放历史", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.roots.claude[0], "session.jsonl"), claude());
  const monitor = f.monitor();
  await monitor.configure({ enabled: true });
  await Promise.all([
    monitor.refresh(),
    monitor.refresh(),
    monitor.configure({ enabled: false }),
    monitor.refresh(),
  ]);
  assert.equal((await monitor.list()).records[0].input, 170);
  assert.equal((await monitor.status()).enabled, false);
  await writeFile(f.file, "{ corrupt PRIVATE_STATE_MARKER");
  const restarted = f.monitor();
  assert.equal((await restarted.status()).enabled, false);
  assert.ok((await restarted.status()).error.includes("缓存无法安全读取"));
  await assert.rejects(restarted.configure({ enabled: true }), /缓存无法安全读取/);
  assert.equal((await restarted.list()).records.length, 0);
});

test("复制到新的归档文件后重启，已持久化的事件指纹仍能去重", async (t) => {
  const f = await fixture(t);
  const path = join(f.roots.claude[0], "session.jsonl");
  await writeFile(path, claude());
  const monitor = await enabled(f);
  await copyFile(path, join(f.roots.claude[0], "copy.jsonl"));
  const restarted = f.monitor();
  await restarted.refresh();
  assert.equal((await restarted.list()).records[0].input, 170);
  assert.equal((await monitor.list()).records[0].input, 170);
});

test("Claude 不同 requestId 的请求各计一次，日期按本地日分桶", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.roots.claude[0], "session.jsonl"),
    claude() + claude({ requestId: "second-request", time: "2026-10-07T10:00:00Z" }),
  );
  const monitor = await enabled(f);
  const rows = (await monitor.list()).records;
  assert.equal(rows.length, 2);
  assert.equal(
    rows.reduce((sum, row) => sum + row.input, 0),
    340,
  );
  for (const row of rows) {
    const time = new Date(row.sampleAt);
    assert.equal(
      row.bucketStart,
      new Date(time.getFullYear(), time.getMonth(), time.getDate()).toISOString(),
    );
  }
});

test("硬链接日志拒绝读取，缓存写入失败不会暴露系统路径", async (t) => {
  const f = await fixture(t);
  const outside = join(f.root, "outside.jsonl");
  await writeFile(outside, codexMeta() + context() + codex(999, 99));
  await link(outside, join(f.roots.codex[0], "linked.jsonl"));
  const monitor = await enabled(f);
  assert.equal((await monitor.list()).records.length, 0);
  assert.ok(
    (await monitor.status()).sources[0].warnings.some((warning) =>
      warning.includes("不可安全读取"),
    ),
  );
  const blocked = join(f.root, "PRIVATE_BLOCKED_LOCATION");
  const failure = new LocalUsageMonitor({ file: join(blocked, "usage.json"), roots: {} });
  await failure.status();
  await writeFile(blocked, "not a directory");
  await assert.rejects(failure.configure({ enabled: true }), (error) => {
    assert.ok(!error.message.includes("PRIVATE_") && !error.message.includes(f.root));
    assert.ok(error.message.includes("保存失败"));
    return true;
  });
  assert.equal((await failure.status()).enabled, false);
});

test("刷新排队后锁屏，在队列实际执行时复验采集权限；解锁继续但不改 enabled", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.roots.codex[0], "session.jsonl"), codexMeta() + context() + codex(10, 2));
  let unlocked = true;
  const monitor = f.monitor({ shouldCollect: () => unlocked });
  await monitor.configure({ enabled: true });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ahead = monitor.serialize(() => gate);
  const refresh = monitor.refresh();
  unlocked = false;
  release();
  await Promise.all([ahead, refresh]);
  assert.equal((await monitor.status()).enabled, true);
  assert.equal((await monitor.status()).lastScannedAt, null);
  assert.equal((await monitor.status()).sources[0].available, false);
  assert.equal((await monitor.list()).records.length, 0);
  unlocked = true;
  await monitor.refresh();
  assert.equal((await monitor.list()).records[0].input, 10);
});

test("正在采集中锁屏，停止后续数据块与文件，已提取数字保存且解锁后增量恢复", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.roots.codex[0], "session.jsonl"),
    codexMeta() +
      context() +
      codex(10, 2) +
      line({ type: "user", content: "x".repeat(90_000) }) +
      codex(20, 4, 0, "2026-10-06T11:00:00Z"),
  );
  await writeFile(join(f.roots.claude[0], "session.jsonl"), claude());
  let pauseAfterFirst = true;
  let monitor;
  monitor = f.monitor({ shouldCollect: () => !pauseAfterFirst || monitor.records.size === 0 });
  await monitor.configure({ enabled: true });
  await monitor.refresh();
  let rows = (await monitor.list()).records;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].input, 10);
  assert.equal((await monitor.status()).enabled, true);
  const saved = JSON.parse(await readFile(f.file, "utf8"));
  assert.equal(saved.enabled, true);
  assert.equal(saved.records[0][1].input, 10);
  assert.ok(saved.checkpoints[0][1].offset < 64 * 1024);
  await monitor.refresh();
  assert.equal((await monitor.list()).records[0].input, 10);
  pauseAfterFirst = false;
  await monitor.refresh();
  rows = (await monitor.list()).records;
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.sourceId === "local:codex").input, 20);
  assert.equal(rows.find((row) => row.sourceId === "local:claude").input, 170);
});

test("Codex 配置父目录为 junction 时读取标准 sessions，真实根替换后拒绝继续", async (t) => {
  const f = await fixture(t);
  const actual = join(f.root, "installed-codex");
  await mkdir(join(actual, "sessions"), { recursive: true });
  await writeFile(
    join(actual, "sessions", "session.jsonl"),
    codexMeta() + context() + codex(50, 10),
  );
  const alias = join(f.root, "codex-home-link");
  await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir");
  const monitor = f.monitor({ roots: { codex: [join(alias, "sessions")] } });
  await monitor.configure({ enabled: true });
  await monitor.refresh();
  assert.equal((await monitor.list()).records[0].input, 50);
  assert.equal((await monitor.status()).sources[0].files, 1);
  await rename(join(actual, "sessions"), join(actual, "original-sessions"));
  await mkdir(join(actual, "sessions"));
  await writeFile(
    join(actual, "sessions", "session.jsonl"),
    codexMeta("replaced") + context() + codex(10000, 10),
  );
  await monitor.refresh();
  assert.equal((await monitor.list()).records[0].input, 50);
  assert.equal((await monitor.status()).sources[0].status, "error");
});

const grokUsage = (turns) => ({
  sessionId: "grok-synthetic",
  updatedAt: TIME,
  session: { inputTokens: 999999, outputTokens: 999999, primaryModelId: "grok-4.6-build" },
  turns,
});
const grokTurn = (number, input = 100, output = 20, time = TIME) => ({
  turnNumber: number,
  endedAt: time,
  modelUsage: {
    "grok-4.6-build": {
      inputTokens: input,
      outputTokens: output,
      cachedReadTokens: 30,
      cacheCreationTokens: 5,
      reasoningTokens: 10,
    },
  },
});
const geminiSession = (messages) => ({
  sessionId: "gemini-synthetic",
  projectHash: "PRIVATE_PROJECT_MARKER",
  startTime: TIME,
  lastUpdated: TIME,
  messages,
});
const geminiMessage = (id, output = 20) => ({
  id,
  type: "gemini",
  model: "gemini-2.5-pro",
  timestamp: TIME,
  content: "PRIVATE_CONVERSATION_MARKER",
  tokens: { input: 100, output, cached: 40, thoughts: 15, tool: 5, total: 140 },
});

test("Grok 只读取 usage.json，按轮次模型去重且缓存与推理不重复计入", async (t) => {
  const f = await fixture(t);
  const directory = join(f.roots.grok[0], "synthetic-session");
  await mkdir(directory);
  const path = join(directory, "usage.json");
  await writeFile(
    path,
    JSON.stringify(grokUsage([grokTurn(1), grokTurn(2, 50, 10, "2026-10-07T10:00:00Z")])),
  );
  await writeFile(
    join(directory, "conversation.json"),
    JSON.stringify(grokUsage([grokTurn(999, 9999999)])),
  );
  const monitor = await enabled(f);
  let rows = (await monitor.list()).records.filter((row) => row.sourceId === "local:grok");
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.reduce(
      (sum, row) => ({
        input: sum.input + row.input,
        output: sum.output + row.output,
        cached: sum.cached + row.cached,
      }),
      { input: 0, output: 0, cached: 0 },
    ),
    { input: 150, output: 30, cached: 60 },
  );
  await writeFile(
    path,
    JSON.stringify(grokUsage([grokTurn(1, 120, 25), grokTurn(2, 50, 10, "2026-10-07T10:00:00Z")])),
  );
  await monitor.refresh();
  const copied = join(f.roots.grok[0], "copied-session");
  await mkdir(copied);
  await copyFile(path, join(copied, "usage.json"));
  const restarted = f.monitor();
  await restarted.refresh();
  rows = (await restarted.list()).records.filter((row) => row.sourceId === "local:grok");
  assert.equal(
    rows.reduce((sum, row) => sum + row.input, 0),
    170,
  );
  assert.equal(
    (await restarted.status()).sources.find((source) => source.id === "local:grok").lastUsageAt,
    "2026-10-07T10:00:00.000Z",
  );
});

test("Gemini CLI 会话 JSON 计入独立 thoughts/tool，用量重复及文件改写不双计", async (t) => {
  const f = await fixture(t);
  const directory = join(f.roots.gemini[0], "synthetic-project", "chats");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "session-synthetic.json");
  await writeFile(
    path,
    JSON.stringify(
      geminiSession([
        geminiMessage("one"),
        geminiMessage("one"),
        { ...geminiMessage("user"), type: "user" },
      ]),
    ),
  );
  await writeFile(
    join(directory, "settings.json"),
    JSON.stringify(geminiSession([geminiMessage("never-read")])),
  );
  const monitor = await enabled(f);
  let rows = (await monitor.list()).records.filter((row) => row.sourceId === "local:gemini");
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { input: rows[0].input, output: rows[0].output, cached: rows[0].cached },
    { input: 105, output: 35, cached: 40 },
  );
  await writeFile(path, '{"sessionId":');
  await monitor.refresh();
  assert.equal(
    (await monitor.status()).sources.find((source) => source.id === "local:gemini").error,
    undefined,
  );
  await writeFile(
    path,
    JSON.stringify(geminiSession([geminiMessage("one", 25), geminiMessage("two")])),
  );
  await monitor.refresh();
  rows = (await monitor.list()).records.filter((row) => row.sourceId === "local:gemini");
  assert.equal(rows[0].input, 210);
  assert.equal(rows[0].output, 75);
  const saved = await readFile(f.file, "utf8");
  assert.ok(!saved.includes("PRIVATE_") && !saved.includes("gemini-synthetic"));
});

test("来源状态区分没有用量、导入中、缺失目录，批量导入不作为错误", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.roots.codex[0], "large.jsonl"),
    codexMeta() + context() + codex(10, 2) + "x".repeat(LOCAL_USAGE_LIMITS.bytesPerFile + 100),
  );
  const monitor = await enabled(f);
  const status = await monitor.status();
  const codexStatus = status.sources.find((source) => source.id === "local:codex");
  assert.equal(codexStatus.status, "importing");
  assert.ok(codexStatus.progress.pendingFiles > 0);
  assert.equal(codexStatus.error, undefined);
  assert.equal(status.sources.find((source) => source.id === "local:gemini").status, "no-usage");
  const missing = f.monitor({ roots: { gemini: [join(f.root, "missing")] } });
  await missing.configure({ enabled: true });
  await missing.refresh();
  assert.equal(
    (await missing.status()).sources.find((source) => source.id === "local:gemini").status,
    "not-found",
  );
});

test("Codex 首轮优先近期日期目录，历史回填有界但不阻塞最近用量", async (t) => {
  const f = await fixture(t);
  const old = join(f.roots.codex[0], "2026", "04", "01");
  const recent = join(f.roots.codex[0], "2026", "10", "07");
  await mkdir(old, { recursive: true });
  await mkdir(recent, { recursive: true });
  await Promise.all(
    Array.from({ length: 70 }, (_, i) =>
      writeFile(
        join(old, `old-${i}.jsonl`),
        codexMeta(`old-${i}`) + context() + codex(1, 1, 0, "2026-04-01T10:00:00Z"),
      ),
    ),
  );
  await writeFile(
    join(recent, "recent.jsonl"),
    codexMeta("recent") + context() + codex(20, 5, 0, "2026-10-07T10:00:00Z"),
  );
  const monitor = await enabled(f);
  assert.ok((await monitor.list()).records.some((row) => row.input === 20));
  assert.equal(
    (await monitor.status()).sources.find((source) => source.id === "local:codex").lastUsageAt,
    "2026-10-07T10:00:00.000Z",
  );
});

test("JSON 快照限额与格式异常给出警告，不读取链接文件或伪造用量", async (t) => {
  const f = await fixture(t);
  const large = join(f.roots.grok[0], "large");
  const unknown = join(f.roots.grok[0], "unknown");
  const linked = join(f.roots.grok[0], "linked");
  await Promise.all([large, unknown, linked].map((path) => mkdir(path)));
  await writeFile(join(large, "usage.json"), " ".repeat(LOCAL_USAGE_LIMITS.snapshotBytes + 1));
  await writeFile(
    join(unknown, "usage.json"),
    JSON.stringify({ sessionId: "unknown", conversation: "PRIVATE_CONVERSATION_MARKER" }),
  );
  const outside = join(f.root, "outside-usage.json");
  await writeFile(outside, JSON.stringify(grokUsage([grokTurn(1)])));
  await link(outside, join(linked, "usage.json"));
  const monitor = await enabled(f);
  assert.equal((await monitor.list()).records.length, 0);
  const source = (await monitor.status()).sources.find((row) => row.id === "local:grok");
  assert.equal(source.status, "no-usage");
  assert.equal(source.error, undefined);
  assert.ok(source.warnings.some((value) => value.includes("4 MiB")));
  assert.ok(source.warnings.some((value) => value.includes("格式不受支持")));
  assert.ok(source.warnings.some((value) => value.includes("不可安全读取")));
  assert.ok(!(await readFile(f.file, "utf8")).includes("PRIVATE_"));
});

test("Gemini 与 Grok 无效缓存、负数和缺失时间不生成 Token", async (t) => {
  const f = await fixture(t);
  const chats = join(f.roots.gemini[0], "project", "chats");
  await mkdir(chats, { recursive: true });
  const message = geminiMessage("bad");
  await writeFile(
    join(chats, "session-bad.json"),
    JSON.stringify(
      geminiSession([
        { ...message, tokens: { ...message.tokens, cached: 9999 } },
        { ...message, id: "negative", tokens: { ...message.tokens, thoughts: -1 } },
        { ...message, id: "no-time", timestamp: undefined },
      ]),
    ),
  );
  await writeFile(
    join(f.roots.grok[0], "usage.json"),
    JSON.stringify(
      grokUsage([
        {
          ...grokTurn(1),
          modelUsage: {
            "grok-4.6-build": { inputTokens: 1, outputTokens: 2, cachedReadTokens: 100 },
          },
        },
        { ...grokTurn(2), endedAt: undefined },
      ]),
    ),
  );
  const monitor = await enabled(f);
  assert.equal((await monitor.list()).records.length, 0);
});

test("读取 JSON 快照中途锁屏时丢弃未完成内容，解锁后完整重读且不双计", async (t) => {
  const f = await fixture(t);
  const chats = join(f.roots.gemini[0], "project", "chats");
  await mkdir(chats, { recursive: true });
  await writeFile(
    join(chats, "session-large.json"),
    JSON.stringify(
      geminiSession([{ ...geminiMessage("one"), content: "PRIVATE_MARKER".repeat(20_000) }]),
    ),
  );
  const monitor = f.monitor();
  await monitor.configure({ enabled: true });
  const original = monitor.readSnapshot.bind(monitor);
  monitor.readSnapshot = async (item, budget) => {
    let checks = 0;
    monitor.shouldCollect = () => ++checks < 4;
    return original(item, budget);
  };
  await monitor.refresh();
  assert.equal((await monitor.list()).records.length, 0);
  assert.equal((await monitor.status()).enabled, true);
  monitor.readSnapshot = original;
  monitor.shouldCollect = () => true;
  await monitor.refresh();
  assert.equal((await monitor.list()).records[0].input, 105);
  await monitor.refresh();
  assert.equal((await monitor.list()).records[0].input, 105);
  assert.ok(!(await readFile(f.file, "utf8")).includes("PRIVATE_MARKER"));
});

test("Codex 大量历史日志不会阻塞其他客户端的目录发现与首轮用量读取", async (t) => {
  const f = await fixture(t);
  await Promise.all(
    Array.from({ length: LOCAL_USAGE_LIMITS.entriesPerRefresh + 10 }, (_, index) =>
      writeFile(
        join(f.roots.codex[0], `${index}.jsonl`),
        codexMeta(`session-${index}`) + context() + codex(1, 1),
      ),
    ),
  );
  await writeFile(join(f.roots.grok[0], "usage.json"), JSON.stringify(grokUsage([grokTurn(1)])));
  const monitor = await enabled(f);
  const source = (await monitor.status()).sources.find((item) => item.id === "local:grok");
  assert.equal(source.files, 1);
  assert.equal(source.status, "ready");
  assert.equal(
    (await monitor.list()).records.find((row) => row.sourceId === "local:grok").input,
    100,
  );
  assert.ok(
    (await monitor.status()).sources.find((item) => item.id === "local:codex").files <
      LOCAL_USAGE_LIMITS.entriesPerRefresh,
  );
});
