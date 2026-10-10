import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, realpath, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { snapshotUsage } from "./local-usage-parsers.mjs";
import { EVENT_INDEX_LIMITS, openEventIndex } from "./local-usage-event-index.mjs";

const CLIENTS = { codex: "Codex", claude: "Claude Code", grok: "Grok Build", gemini: "Gemini CLI" };
const FIELDS = ["input", "output", "cached", "cacheWrite"];
export const LOCAL_USAGE_LIMITS = Object.freeze({
  intervalMs: 10_000,
  entriesPerRefresh: 512,
  filesPerRefresh: 64,
  bytesPerRefresh: 8 * 1024 * 1024,
  bytesPerFile: 1024 * 1024,
  snapshotBytes: 4 * 1024 * 1024,
  lineBytes: 256 * 1024,
  files: 4096,
  directories: 4096,
  events: 100_000,
  records: 20_000,
  stateBytes: 48 * 1024 * 1024,
});
const hash = (value) => createHash("sha256").update(value).digest("hex");
const isHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const blank = () => ({ input: 0, output: 0, cached: 0, cacheWrite: 0 });
const modelName = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,95}$/.test(value) &&
  !/^sk-/i.test(value)
    ? value
    : "unknown";
const validTime = (value) => {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= 946684800000 && time < 4133980800000
    ? new Date(time).toISOString()
    : null;
};
function localDay(time) {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}
function tokens(usage, client) {
  if (!usage || typeof usage !== "object") return null;
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  if (input === null || output === null) return null;
  const cached = count(
    client === "codex" ? (usage.cached_input_tokens ?? 0) : (usage.cache_read_input_tokens ?? 0),
  );
  const cacheWrite = count(client === "codex" ? 0 : (usage.cache_creation_input_tokens ?? 0));
  if (cached === null || cacheWrite === null) return null;
  // Codex 的输入已含缓存、输出已含推理；Claude 的两种缓存输入需合并进输入总数。
  const inclusiveInput = client === "claude" ? input + cached + cacheWrite : input;
  if (!Number.isSafeInteger(inclusiveInput) || cached + cacheWrite > inclusiveInput) return null;
  return { input: inclusiveInput, output, cached, cacheWrite };
}
function validTokens(value) {
  return (
    value &&
    FIELDS.every((key) => count(value[key]) !== null) &&
    value.cached + value.cacheWrite <= value.input
  );
}
function subtract(current, previous) {
  const delta = Object.fromEntries(
    FIELDS.map((key) => [key, Math.max(0, current[key] - previous[key])]),
  );
  delta.cached = Math.min(delta.input, delta.cached);
  delta.cacheWrite = Math.min(delta.input - delta.cached, delta.cacheWrite);
  return delta;
}
function defaultRoots() {
  const codex = resolve(process.env.CODEX_HOME || join(homedir(), ".codex"));
  const claude = resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
  return {
    codex: [join(codex, "sessions"), join(codex, "archived_sessions")],
    claude: [join(claude, "projects")],
    grok: [join(resolve(process.env.GROK_HOME || join(homedir(), ".grok")), "sessions")],
    gemini: [join(resolve(process.env.GEMINI_CLI_HOME || homedir()), ".gemini", "tmp")],
  };
}
function within(root, path) {
  const part = relative(root, path);
  return part === "" || (!part.startsWith(`..${sep}`) && part !== ".." && !isAbsolute(part));
}
// 可信配置根在发现阶段只解析一次；后续真实路径及子路径仍禁止链接或 junction。
async function safePath(path, { allowSystemMapping = false } = {}) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of relative(current, absolute).split(sep).filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("UNSAFE_PATH");
  }
  const canonical = await realpath(absolute);
  const stat = await lstat(absolute, { bigint: true });
  if (stat.isSymbolicLink()) throw new Error("UNSAFE_PATH");
  if (relative(absolute, canonical) !== "") {
    if (!allowSystemMapping) throw new Error("UNSAFE_PATH");
    // Windows 包应用可能透明重定向 AppData 文件；仅应用自己的缓存允许此映射。
    // 两侧都不得含链接，且必须指向同一文件身份，不能借 realpath 替换成别的文件。
    const mapped = await safePath(canonical);
    if (fileIdentity(stat) !== fileIdentity(mapped) || stat.isDirectory() !== mapped.isDirectory())
      throw new Error("UNSAFE_PATH");
  }
  return stat;
}
// NTFS 文件 ID 可能超过 Number 的安全整数范围，安全校验必须保持原始整数精度。
const fileIdentity = (stat) => hash(`${stat.dev}:${stat.ino}:${stat.birthtimeNs}`);
// 已保存的日志断点沿用旧哈希；它只负责增量位置，不用于路径或打开句柄的安全校验。
const logCheckpointIdentity = (stat) => hash(`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`);
async function verifyRoot(anchor) {
  if (!anchor) return;
  const stat = await safePath(anchor.path);
  if (!stat.isDirectory() || fileIdentity(stat) !== anchor.identity) throw new Error("UNSAFE_ROOT");
}
async function safeOpen(path, anchor, options) {
  await verifyRoot(anchor);
  const before = await safePath(path, options);
  if (!before.isFile() || before.nlink !== 1n) throw new Error("UNSAFE_PATH");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const after = await handle.stat({ bigint: true });
    const current = await safePath(path, options);
    await verifyRoot(anchor);
    if (
      !after.isFile() ||
      after.nlink !== 1n ||
      fileIdentity(before) !== fileIdentity(after) ||
      fileIdentity(current) !== fileIdentity(after)
    )
      throw new Error("UNSAFE_PATH");
    // 通过路径与句柄精确校验后，再提供读取预算和既有断点需要的 Number 元数据。
    return { handle, stat: await handle.stat() };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
async function digestAt(handle, start, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, start);
  return { hash: hash(buffer.subarray(0, bytesRead)), length: bytesRead };
}

/** 仅在主进程使用。roots 是可信调用方/测试注入项，不得接受渲染进程提供的路径。 */
export class LocalUsageMonitor {
  constructor({ file, roots, now = Date.now, shouldCollect = () => true } = {}) {
    if (typeof file !== "string" || !isAbsolute(file)) throw new Error("本地统计缓存位置无效");
    this.file = file;
    this.now = now;
    this.shouldCollect = shouldCollect;
    this.enabled = true;
    this.lastScannedAt = null;
    this.error = null;
    this.files = new Map();
    this.checkpoints = new Map();
    this.events = new Map();
    this.indexPath = null;
    this.eventIndex = null;
    this.records = new Map();
    this.recordsRevision = 0;
    this.directoryKeys = new Set();
    this.scannedDirectories = new Set();
    this.directories = [];
    this.activeDirectories = new Map();
    this.currentDirectories = new Map();
    this.fileCursors = new Map();
    this.clientCursor = 0;
    this.queue = Promise.resolve();
    this.dirty = false;
    const selected = roots ?? defaultRoots();
    this.sources = Object.fromEntries(
      Object.keys(CLIENTS).map((id) => [
        id,
        { available: false, warnings: new Set(), error: null },
      ]),
    );
    this.roots = Object.entries(CLIENTS).flatMap(([client]) =>
      (selected[client] ?? [])
        .filter((path) => typeof path === "string" && isAbsolute(path))
        .map((path) => ({ client, path: resolve(path) })),
    );
    this.ready = this.load();
  }

  async load() {
    let handle;
    try {
      ({ handle } = await safeOpen(this.file, undefined, { allowSystemMapping: true }));
      const stat = await handle.stat();
      if (stat.size > LOCAL_USAGE_LIMITS.stateBytes) throw new Error("STATE_LIMIT");
      const buffer = Buffer.alloc(stat.size);
      let position = 0;
      while (position < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          position,
          buffer.length - position,
          position,
        );
        if (!bytesRead) break;
        position += bytesRead;
      }
      let data = JSON.parse(buffer.subarray(0, position).toString("utf8"));
      if (data.version === 2) {
        if (!/^usage-events-[a-f0-9-]{36}\.sqlite$/.test(data.index))
          throw new Error("STATE_INVALID");
        this.indexPath = join(dirname(await realpath(this.file)), data.index);
        await this.openIndex();
        data = JSON.parse(this.eventIndex.load());
      }
      if (
        data.version !== 1 ||
        !Array.isArray(data.checkpoints) ||
        !Array.isArray(data.events) ||
        !Array.isArray(data.records) ||
        data.checkpoints.length > LOCAL_USAGE_LIMITS.files ||
        data.events.length > LOCAL_USAGE_LIMITS.events ||
        data.records.length > LOCAL_USAGE_LIMITS.records
      )
        throw new Error("STATE_INVALID");
      for (const [key, item] of data.checkpoints) {
        if (
          !isHash(key) ||
          !item ||
          count(item.offset) === null ||
          !isHash(item.session) ||
          !isHash(item.identity) ||
          count(item.epoch) === null ||
          (item.total !== null && !validTokens(item.total))
        )
          throw new Error("STATE_INVALID");
        const clean = {
          offset: item.offset,
          session: item.session,
          identity: item.identity,
          epoch: item.epoch,
          model: modelName(item.model),
          total: item.total ? Object.fromEntries(FIELDS.map((f) => [f, item.total[f]])) : null,
          skipping: item.skipping === true,
        };
        if (isHash(item.lastEvent)) clean.lastEvent = item.lastEvent;
        if (isHash(item.snapshotStamp)) clean.snapshotStamp = item.snapshotStamp;
        for (const name of ["prefix", "guard"]) {
          if (
            item[name] &&
            isHash(item[name].hash) &&
            count(item[name].length) !== null &&
            item[name].length <= 512
          )
            clean[name] = { hash: item[name].hash, length: item[name].length };
        }
        this.checkpoints.set(key, clean);
      }
      for (const [key, value] of data.events) {
        if (
          !isHash(key) ||
          (value !== true && (!validTokens(value?.total) || !isHash(value?.record)))
        )
          throw new Error("STATE_INVALID");
        this.events.set(
          key,
          value === true
            ? true
            : {
                record: value.record,
                total: Object.fromEntries(FIELDS.map((f) => [f, value.total[f]])),
              },
        );
      }
      for (const [key, row] of data.records) {
        if (
          !isHash(key) ||
          !row ||
          !Object.hasOwn(CLIENTS, row.client) ||
          !isHash(row.session) ||
          !validTokens(row) ||
          !validTime(row.bucketStart) ||
          !validTime(row.sampleAt)
        )
          throw new Error("STATE_INVALID");
        this.records.set(key, {
          client: row.client,
          session: row.session,
          model: modelName(row.model),
          bucketStart: validTime(row.bucketStart),
          sampleAt: validTime(row.sampleAt),
          ...Object.fromEntries(FIELDS.map((f) => [f, row[f]])),
        });
      }
      this.enabled = data.enabled === true;
      this.lastScannedAt = validTime(data.lastScannedAt);
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.enabled = false;
        this.checkpoints.clear();
        this.events = new Map();
        this.records.clear();
        this.error = "本地统计缓存无法安全读取，已停止采集；请检查应用数据目录权限或恢复缓存";
      }
    } finally {
      await handle?.close();
      this.closeIndex();
    }
  }

  serialize(action) {
    const run = this.queue.then(() => this.ready).then(action);
    this.queue = run.catch(() => {});
    return run;
  }

  snapshot() {
    return {
      enabled: this.enabled,
      intervalMs: LOCAL_USAGE_LIMITS.intervalMs,
      lastScannedAt: this.lastScannedAt,
      sources: Object.entries(CLIENTS).map(([id, name]) => {
        const source = this.sources[id];
        const files = [...this.files.values()].filter((item) => item.client === id);
        const records = [...this.records.values()].filter((item) => item.client === id);
        const directories = [...this.directoryKeys].filter((key) => key.startsWith(`${id}:`));
        const discoveryComplete = directories.every((key) => this.scannedDirectories.has(key));
        const pendingFiles = files.filter((item) => item.pendingWork).length;
        const status =
          source.error && !source.available
            ? "error"
            : !source.available
              ? "not-found"
              : !discoveryComplete
                ? "discovering"
                : pendingFiles
                  ? "importing"
                  : records.length
                    ? "ready"
                    : "no-usage";
        return {
          id: `local:${id}`,
          name,
          available: source.available,
          files: files.length,
          records: records.length,
          status,
          progress: {
            discoveryComplete,
            pendingFiles,
            processedFiles: files.filter((item) => item.scanned).length,
          },
          lastUsageAt: records.reduce(
            (last, row) => (!last || row.sampleAt > last ? row.sampleAt : last),
            null,
          ),
          warnings: [...source.warnings],
          ...(source.error ? { error: source.error } : {}),
        };
      }),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  async status() {
    await this.ready;
    await this.queue;
    return this.snapshot();
  }

  configure(input) {
    return this.serialize(async () => {
      if (
        !input ||
        typeof input.enabled !== "boolean" ||
        Object.keys(input).some((key) => key !== "enabled")
      )
        throw new Error("本地监控设置只接受 enabled 布尔值");
      if (this.error) throw new Error(this.error);
      this.enabled = input.enabled;
      this.dirty = true;
      if (!this.enabled) {
        for (const active of this.activeDirectories.values()) {
          const { handle, ...directory } = active;
          await handle.close().catch(() => {});
          this.directories.push(directory);
        }
        this.activeDirectories.clear();
        for (const directory of this.currentDirectories.values())
          await directory.handle.close().catch(() => {});
        this.currentDirectories.clear();
      }
      try {
        await this.persist();
      } catch {
        this.enabled = false;
        this.error = "本地统计缓存保存失败，已停止采集；请检查可用空间和应用数据目录权限";
        throw new Error(this.error);
      }
      return this.snapshot();
    });
  }

  refresh() {
    return this.serialize(async () => {
      if (!this.canCollect()) return this.snapshot();
      this.lastRefreshStats = { metadataFiles: 0, metadataMs: 0, filesRead: 0, bytesRead: 0 };
      try {
        if (!this.indexPath && this.events.size >= LOCAL_USAGE_LIMITS.events)
          await this.migrateIndex();
        if (this.indexPath) {
          await this.openIndex();
          this.eventIndex.begin();
        }
        await this.discover();
        const clients = Object.keys(CLIENTS);
        const byClient = {};
        for (const client of clients) byClient[client] = await this.scheduleFiles(client);
        const processedByClient = Object.fromEntries(clients.map((client) => [client, 0]));
        let budget = LOCAL_USAGE_LIMITS.bytesPerRefresh;
        let processed = 0;
        for (
          let attempts = 0;
          attempts < LOCAL_USAGE_LIMITS.filesPerRefresh * clients.length &&
          processed < LOCAL_USAGE_LIMITS.filesPerRefresh &&
          budget > 0 &&
          this.canCollect();
          attempts++
        ) {
          const client = clients[this.clientCursor++ % clients.length];
          const files = byClient[client];
          if (processedByClient[client] >= files.length) continue;
          const { item, cursor } = files[processedByClient[client]++];
          this.fileCursors.set(client, cursor);
          processed++;
          const bytes =
            item.format === "json"
              ? await this.readSnapshot(item, budget)
              : await this.readLog(item, Math.min(budget, LOCAL_USAGE_LIMITS.bytesPerFile));
          budget -= bytes;
          this.lastRefreshStats.filesRead++;
          this.lastRefreshStats.bytesRead += bytes;
        }
        this.lastScannedAt = new Date(this.now()).toISOString();
        await this.persist();
      } catch (error) {
        if (this.indexPath) {
          this.closeIndex();
          try {
            await this.openIndex();
            const saved = JSON.parse(this.eventIndex.load());
            this.checkpoints = new Map(saved.checkpoints);
            this.records = new Map(saved.records);
            this.lastScannedAt = saved.lastScannedAt;
            this.recordsRevision++;
          } catch {
            /* 原缓存无法安全打开时保留内存中的历史信息并停止采集。 */
          }
        }
        this.error =
          error.errcode === 13
            ? "本地统计索引达到 512 MiB 安全上限或磁盘空间不足，已停止采集并保留历史记录"
            : "本地统计缓存保存失败，已停止采集；请检查可用空间和应用数据目录权限";
        this.enabled = false;
      } finally {
        this.closeIndex();
      }
      return this.snapshot();
    });
  }

  async list() {
    await this.ready;
    await this.queue;
    const checkedAt = this.lastScannedAt ?? new Date(this.now()).toISOString();
    return {
      sources: Object.entries(CLIENTS).map(([id, name]) => ({
        id: `local:${id}`,
        name,
        type: `local-${id}`,
        checkedAt,
      })),
      records: [...this.records.entries()].map(([key, row]) => ({
        key: `local:${key}`,
        sourceId: `local:${row.client}`,
        sourceName: CLIENTS[row.client],
        kind: "tokens",
        origin: "local",
        model: row.model,
        label: row.model === "unknown" ? "未知模型" : row.model,
        checkedAt,
        bucketStart: row.bucketStart,
        sampleAt: row.sampleAt,
        scope: "local-session-day",
        ...Object.fromEntries(FIELDS.map((field) => [field, row[field]])),
      })),
    };
  }

  warn(client, message) {
    this.sources[client].warnings.add(message);
  }

  canCollect() {
    if (!this.enabled || this.error) return false;
    try {
      return Boolean(this.shouldCollect());
    } catch {
      return false;
    }
  }

  async digestLog(handle, start, length) {
    if (!this.canCollect()) return null;
    const digest = await digestAt(handle, start, length);
    return this.canCollect() ? digest : null;
  }

  async scheduleFiles(client) {
    const started = performance.now();
    const files = [...this.files.values()].filter((file) => file.client === client);
    const priority = [];
    // 仅读文件元数据，不读取日志正文；限制并发，实际打开仍执行完整的根和链接校验。
    for (let offset = 0; offset < files.length; offset += 32) {
      await Promise.all(
        files.slice(offset, offset + 32).map(async (file) => {
          try {
            const stat = await lstat(file.path);
            if (stat.isSymbolicLink() || !stat.isFile()) return;
            const changed = file.observedSize !== stat.size || file.observedMtime !== stat.mtimeMs;
            if (
              changed ||
              (file.pendingWork && (file.format === "json" || !file.scanned)) ||
              file.lastActiveAt >= this.now() - 60_000
            )
              priority.push({ file, modified: stat.mtimeMs });
          } catch {
            /* 不可读文件由常规轮转产生统一警告。 */
          }
        }),
      );
    }
    priority.sort((a, b) => b.modified - a.modified);
    if (this.lastRefreshStats) {
      this.lastRefreshStats.metadataFiles += files.length;
      this.lastRefreshStats.metadataMs += performance.now() - started;
    }
    const ordered = [];
    const selected = new Set();
    let cursor = this.fileCursors.get(client) ?? 0;
    let hot = 0;
    let historical = 0;
    while (ordered.length < Math.min(files.length, LOCAL_USAGE_LIMITS.filesPerRefresh)) {
      let file;
      if (ordered.length % 2 === 0 && hot < priority.length) file = priority[hot++].file;
      else if (historical < files.length) {
        file = files[cursor++ % files.length];
        historical++;
      } else if (hot < priority.length) file = priority[hot++].file;
      else break;
      if (selected.has(file.key)) continue;
      selected.add(file.key);
      ordered.push({ item: file, cursor });
    }
    return ordered;
  }

  enqueueDirectory(item) {
    const key = `${item.client}:${item.path}`;
    if (this.directoryKeys.has(key)) return;
    if (this.directoryKeys.size >= LOCAL_USAGE_LIMITS.directories) {
      this.warn(item.client, "目录数量达到安全上限，统计可能不完整");
      return;
    }
    this.directoryKeys.add(key);
    // Codex 的年月日目录通常按升序枚举；新目录插到前面让较近的月份先回填。
    if (item.client === "codex" && item.depth > 0) this.directories.unshift(item);
    else this.directories.push(item);
  }

  async discover() {
    for (const source of Object.values(this.sources)) {
      source.available = false;
      source.error = null;
    }
    for (const root of this.roots) {
      if (!this.canCollect()) return;
      try {
        if (!root.identity) {
          const canonical = await realpath(root.path);
          const stat = await safePath(canonical);
          if (!stat.isDirectory()) continue;
          root.path = canonical;
          root.identity = fileIdentity(stat);
        }
        await verifyRoot(root);
        this.sources[root.client].available = true;
        this.enqueueDirectory({ ...root, root: root.path, rootIdentity: root.identity, depth: 0 });
      } catch (error) {
        if (error.code !== "ENOENT")
          this.sources[root.client].error = "日志根目录不可安全读取或已被替换，已停止读取该目录";
      }
    }
    const entriesPerSource = Math.max(
      1,
      Math.floor(LOCAL_USAGE_LIMITS.entriesPerRefresh / Object.keys(CLIENTS).length),
    );
    for (const client of Object.keys(CLIENTS)) {
      if (!this.canCollect()) return;
      const used = client === "codex" ? await this.discoverCurrentCodex(32) : 0;
      await this.discoverSource(client, entriesPerSource - used);
    }
  }

  async discoverCurrentCodex(limit) {
    const targets = [];
    for (const root of this.roots.filter((item) => item.client === "codex" && item.identity)) {
      for (const delta of [0, -1]) {
        const date = new Date(this.now());
        date.setDate(date.getDate() + delta);
        const path = join(
          root.path,
          String(date.getFullYear()),
          String(date.getMonth() + 1).padStart(2, "0"),
          String(date.getDate()).padStart(2, "0"),
        );
        targets.push({ ...root, root: root.path, rootIdentity: root.identity, path, depth: 3 });
      }
    }
    const paths = new Set(targets.map((item) => item.path));
    for (const [path, directory] of this.currentDirectories) {
      if (paths.has(path)) continue;
      await directory.handle.close().catch(() => {});
      this.currentDirectories.delete(path);
    }
    let entries = 0;
    for (const target of targets) {
      if (!this.canCollect() || entries >= limit) break;
      let directory = this.currentDirectories.get(target.path);
      try {
        await verifyRoot({ path: target.root, identity: target.rootIdentity });
        if (!(await safePath(target.path)).isDirectory()) continue;
        if (!directory) {
          directory = { ...target, handle: await opendir(target.path, { bufferSize: 16 }) };
          this.currentDirectories.set(target.path, directory);
        }
        const perDirectory = Math.max(1, Math.floor(limit / Math.max(1, targets.length)));
        for (let used = 0; used < perDirectory && entries < limit && this.canCollect(); used++) {
          const entry = await directory.handle.read();
          if (!entry) {
            await directory.handle.close();
            this.currentDirectories.delete(target.path);
            break;
          }
          entries++;
          if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".jsonl"))
            this.registerFile(directory, entry.name);
        }
      } catch (error) {
        if (directory) await directory.handle.close().catch(() => {});
        this.currentDirectories.delete(target.path);
        if (error.code !== "ENOENT") this.warn("codex", "部分日志目录不可安全读取，已跳过");
      }
    }
    return entries;
  }

  registerFile(directory, name) {
    const path = join(directory.path, name);
    const key = hash(`${directory.client}:${path}`);
    if (this.files.has(key)) return;
    if (this.files.size >= LOCAL_USAGE_LIMITS.files) {
      this.warn(directory.client, "日志文件数量达到安全上限，统计可能不完整");
      return;
    }
    this.files.set(key, {
      key,
      path,
      root: directory.root,
      rootIdentity: directory.rootIdentity,
      client: directory.client,
      format: ["grok", "gemini"].includes(directory.client) ? "json" : "jsonl",
      pendingWork: true,
      scanned: false,
      pending: Buffer.alloc(0),
    });
  }

  async discoverSource(client, entryLimit) {
    let entries = 0;
    let directories = 0;
    let active = this.activeDirectories.get(client) ?? null;
    const initialCount =
      this.directories.filter((item) => item.client === client).length + (active ? 1 : 0);
    while (
      entries < entryLimit &&
      directories < Math.max(1, initialCount + 16) &&
      this.canCollect()
    ) {
      if (!active) {
        // 仅首次发现时优先较新日期，已访问目录仍按轮转顺序复查，避免饿死其他客户端。
        let next = this.directories.findIndex((item) => item.client === client);
        if (next < 0) break;
        let latestDate = "";
        for (let index = 0; index < this.directories.length; index++) {
          const candidate = this.directories[index];
          const datePath = relative(candidate.root, candidate.path).split(sep).join("/");
          if (
            candidate.client === client &&
            client === "codex" &&
            /^\d{4}(?:\/\d{2}){0,2}$/.test(datePath) &&
            !this.scannedDirectories.has(`${candidate.client}:${candidate.path}`) &&
            datePath > latestDate
          ) {
            latestDate = datePath;
            next = index;
          }
        }
        const [item] = this.directories.splice(next, 1);
        if (!item) break;
        try {
          await verifyRoot({ path: item.root, identity: item.rootIdentity });
          if (!within(item.root, item.path) || !(await safePath(item.path)).isDirectory())
            throw new Error("UNSAFE_PATH");
          if (!this.canCollect()) {
            this.directories.unshift(item);
            return;
          }
          active = { ...item, handle: await opendir(item.path, { bufferSize: 32 }) };
          this.activeDirectories.set(client, active);
        } catch {
          this.warn(item.client, "部分日志目录不可安全读取，已跳过");
          this.directories.push(item);
          directories++;
          continue;
        }
      }
      const directory = active;
      if (!this.canCollect()) return;
      let entry;
      try {
        entry = await directory.handle.read();
      } catch {
        this.warn(directory.client, "部分日志目录不可安全读取，已跳过");
        await directory.handle.close().catch(() => {});
        const { handle: _handle, ...item } = directory;
        this.directories.push(item);
        active = null;
        this.activeDirectories.delete(client);
        directories++;
        continue;
      }
      if (!entry) {
        await directory.handle.close();
        this.scannedDirectories.add(`${directory.client}:${directory.path}`);
        const { handle: _handle, ...item } = directory;
        this.directories.push(item);
        active = null;
        this.activeDirectories.delete(client);
        directories++;
        continue;
      }
      entries++;
      const path = join(directory.path, entry.name);
      if (entry.isSymbolicLink()) {
        this.warn(directory.client, "已跳过链接日志或链接目录");
        continue;
      }
      if (entry.isDirectory()) {
        if (directory.depth < 6)
          this.enqueueDirectory({
            client: directory.client,
            root: directory.root,
            rootIdentity: directory.rootIdentity,
            path,
            depth: directory.depth + 1,
          });
        else this.warn(directory.client, "日志目录超过安全深度，统计可能不完整");
      } else if (
        entry.isFile() &&
        ((["codex", "claude"].includes(directory.client) && entry.name.endsWith(".jsonl")) ||
          (directory.client === "grok" && entry.name === "usage.json") ||
          (directory.client === "gemini" &&
            basename(directory.path) === "chats" &&
            /^session-[a-zA-Z0-9._-]+\.json$/.test(entry.name)))
      ) {
        this.registerFile(directory, entry.name);
      }
    }
  }

  async readLog(item, budget) {
    let handle;
    let bytes = 0;
    try {
      if (!this.canCollect()) return 0;
      if (!within(item.root, item.path)) throw new Error("UNSAFE_PATH");
      const opened = await safeOpen(item.path, { path: item.root, identity: item.rootIdentity });
      handle = opened.handle;
      if (!this.canCollect()) return 0;
      const stat = opened.stat;
      item.observedSize = stat.size;
      item.observedMtime = stat.mtimeMs;
      item.pendingWork = true;
      const identity = logCheckpointIdentity(stat);
      let checkpoint = this.checkpoints.get(item.key);
      let changed =
        !checkpoint ||
        checkpoint.identity !== identity ||
        stat.size < checkpoint.offset + item.pending.length;
      if (!changed && checkpoint.prefix) {
        const digest = await this.digestLog(handle, 0, checkpoint.prefix.length);
        if (!digest) return bytes;
        changed = digest.hash !== checkpoint.prefix.hash;
      }
      if (!changed && checkpoint.guard) {
        const digest = await this.digestLog(
          handle,
          checkpoint.offset - checkpoint.guard.length,
          checkpoint.guard.length,
        );
        if (!digest) return bytes;
        changed = digest.hash !== checkpoint.guard.hash;
      }
      if (changed) {
        checkpoint = {
          offset: 0,
          session: hash(`${item.client}:${basename(item.path)}`),
          identity,
          epoch: 0,
          model: "unknown",
          total: null,
          skipping: false,
        };
        item.pending = Buffer.alloc(0);
        if (!this.checkpoints.has(item.key) && this.checkpoints.size >= LOCAL_USAGE_LIMITS.files) {
          this.warn(item.client, "日志检查点达到安全上限，统计可能不完整");
          return 0;
        }
        this.checkpoints.set(item.key, checkpoint);
        this.dirty = true;
      }
      if (!checkpoint.prefix && stat.size) {
        const digest = await this.digestLog(handle, 0, Math.min(512, stat.size));
        if (!digest) return bytes;
        checkpoint.prefix = digest;
      }
      let position = checkpoint.offset + item.pending.length;
      while (position < stat.size && bytes < budget && this.canCollect()) {
        const buffer = Buffer.alloc(Math.min(64 * 1024, budget - bytes, stat.size - position));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        bytes += bytesRead;
        if (!this.canCollect()) break;
        position += bytesRead;
        const combined = Buffer.concat([item.pending, buffer.subarray(0, bytesRead)]);
        let start = 0;
        for (let end = combined.indexOf(10, start); end !== -1; end = combined.indexOf(10, start)) {
          const length = end - start;
          if (!checkpoint.skipping && length <= LOCAL_USAGE_LIMITS.lineBytes)
            this.consume(item.client, checkpoint, combined.subarray(start, end));
          else this.warn(item.client, "已跳过超长日志行，统计可能不完整");
          checkpoint.skipping = false;
          checkpoint.offset += length + 1;
          start = end + 1;
          this.dirty = true;
        }
        if (start) {
          const guard = combined.subarray(Math.max(0, start - 128), start);
          checkpoint.guard = { hash: hash(guard), length: guard.length };
        }
        const tail = combined.subarray(start);
        if (checkpoint.skipping || tail.length > LOCAL_USAGE_LIMITS.lineBytes) {
          checkpoint.skipping = true;
          checkpoint.offset += tail.length;
          if (tail.length) {
            const guard = tail.subarray(Math.max(0, tail.length - 128));
            checkpoint.guard = { hash: hash(guard), length: guard.length };
          }
          item.pending = Buffer.alloc(0);
          this.dirty = true;
          this.warn(item.client, "已跳过超长日志行，统计可能不完整");
        } else item.pending = Buffer.from(tail);
      }
      item.pendingWork = checkpoint.offset < stat.size;
      item.scanned = true;
      if (bytes) item.lastActiveAt = this.now();
    } catch (error) {
      item.pendingWork = false;
      if (error.localUsageIndex) throw error;
      if (error.code !== "ENOENT") this.warn(item.client, "部分日志文件不可安全读取，已跳过");
    } finally {
      // 未完成的一行下一轮从已提交偏移重读，不在内存长期保留会话内容。
      item.pending = Buffer.alloc(0);
      await handle?.close();
    }
    return bytes;
  }

  async readSnapshot(item, budget) {
    let handle;
    let bytes = 0;
    try {
      if (!this.canCollect()) return 0;
      if (!within(item.root, item.path)) throw new Error("UNSAFE_PATH");
      const opened = await safeOpen(item.path, { path: item.root, identity: item.rootIdentity });
      handle = opened.handle;
      const stat = opened.stat;
      item.observedSize = stat.size;
      item.observedMtime = stat.mtimeMs;
      const stamp = hash(
        `${logCheckpointIdentity(stat)}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,
      );
      const prior = this.checkpoints.get(item.key);
      if (prior?.snapshotStamp === stamp) {
        item.pendingWork = false;
        item.scanned = true;
        return 0;
      }
      item.pendingWork = true;
      if (stat.size > LOCAL_USAGE_LIMITS.snapshotBytes) {
        this.warn(item.client, "JSON 用量快照超过 4 MiB 安全上限，已跳过");
        item.pendingWork = false;
        item.scanned = true;
        return 0;
      }
      if (stat.size > budget) return 0;
      const buffer = Buffer.alloc(stat.size);
      while (bytes < buffer.length) {
        if (!this.canCollect()) return bytes;
        const { bytesRead } = await handle.read(
          buffer,
          bytes,
          Math.min(64 * 1024, buffer.length - bytes),
          bytes,
        );
        if (!bytesRead) return bytes;
        bytes += bytesRead;
      }
      if (!this.canCollect()) return bytes;
      const after = await handle.stat();
      if (
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        after.ctimeMs !== stat.ctimeMs
      )
        return bytes;
      await verifyRoot({ path: item.root, identity: item.rootIdentity });
      if (!this.canCollect()) return bytes;
      let document;
      try {
        document = JSON.parse(buffer.toString("utf8"));
      } catch {
        return bytes;
      }
      const parsed = snapshotUsage(item.client, document);
      if (!parsed.supported) this.warn(item.client, "用量快照格式不受支持，未生成统计记录");
      for (const event of parsed.events) {
        const time = validTime(event.time);
        if (!time) {
          this.warn(item.client, "部分用量事件缺少有效时间，已跳过");
          continue;
        }
        const session = hash(`${item.client}:${event.session}`);
        const fingerprint = hash(JSON.stringify([item.client, session, event.id]));
        const old = this.events.get(fingerprint);
        const delta = subtract(event.total, old?.total ?? blank());
        if (!FIELDS.some((field) => delta[field])) continue;
        const key = this.addRecord(
          item.client,
          session,
          modelName(event.model),
          time,
          delta,
          old?.record,
        );
        if (key)
          this.events.set(fingerprint, {
            record: key,
            total: Object.fromEntries(
              FIELDS.map((field) => [
                field,
                Math.max(event.total[field], old?.total?.[field] ?? 0),
              ]),
            ),
          });
      }
      if (!prior && this.checkpoints.size >= LOCAL_USAGE_LIMITS.files) {
        this.warn(item.client, "日志检查点达到安全上限，统计可能不完整");
        return bytes;
      }
      this.checkpoints.set(item.key, {
        offset: stat.size,
        session: hash(`${item.client}:${document.sessionId ?? "unknown"}`),
        identity: logCheckpointIdentity(stat),
        epoch: 0,
        model: "unknown",
        total: null,
        skipping: false,
        snapshotStamp: stamp,
      });
      item.pendingWork = false;
      item.scanned = true;
      if (bytes) item.lastActiveAt = this.now();
      this.dirty = true;
    } catch (error) {
      item.pendingWork = false;
      if (error.localUsageIndex) throw error;
      if (error.code !== "ENOENT") this.warn(item.client, "部分日志文件不可安全读取，已跳过");
    } finally {
      await handle?.close();
    }
    return bytes;
  }

  consume(client, checkpoint, line) {
    if (!line.length) return;
    let event;
    try {
      event = JSON.parse(line.toString("utf8"));
    } catch {
      this.warn(client, "已跳过损坏日志行，统计可能不完整");
      return;
    }
    if (!event || typeof event !== "object") return;
    if (client === "codex") {
      if (
        event.type === "session_meta" &&
        typeof event.payload?.id === "string" &&
        event.payload.id.length <= 256
      )
        checkpoint.session = hash(`codex:${event.payload.id}`);
      if (event.type === "turn_context") checkpoint.model = modelName(event.payload?.model);
      if (
        event.type !== "event_msg" ||
        event.payload?.type !== "token_count" ||
        !event.payload.info
      )
        return;
      const time = validTime(event.timestamp);
      if (!time) {
        this.warn(client, "部分用量事件缺少有效时间，已跳过");
        return;
      }
      const info = event.payload.info;
      const cumulative = tokens(info.total_token_usage, client);
      const last = tokens(info.last_token_usage, client);
      if ((!cumulative && !last) || (info.total_token_usage != null && !cumulative)) {
        this.warn(client, "部分用量事件格式不受支持，已跳过");
        return;
      }
      let delta;
      let fingerprint;
      if (cumulative) {
        if (
          checkpoint.total &&
          (cumulative.input < checkpoint.total.input || cumulative.output < checkpoint.total.output)
        )
          checkpoint.epoch++;
        const previous =
          checkpoint.total &&
          cumulative.input >= checkpoint.total.input &&
          cumulative.output >= checkpoint.total.output
            ? checkpoint.total
            : blank();
        delta = subtract(cumulative, previous);
        checkpoint.total = cumulative;
        fingerprint = hash(
          JSON.stringify([client, checkpoint.session, checkpoint.epoch, cumulative]),
        );
      } else {
        delta = last;
        fingerprint = hash(JSON.stringify([client, checkpoint.session, time, last]));
        if (checkpoint.lastEvent === fingerprint) return;
        const previous = checkpoint.total ?? blank();
        const total = Object.fromEntries(
          FIELDS.map((field) => [field, previous[field] + last[field]]),
        );
        if (!validTokens(total)) {
          this.warn(client, "用量计数超出安全范围，已跳过");
          return;
        }
        checkpoint.total = total;
      }
      checkpoint.lastEvent = fingerprint;
      if (this.events.has(fingerprint) || !FIELDS.some((key) => delta[key])) return;
      const key = this.addRecord(client, checkpoint.session, checkpoint.model, time, delta);
      if (key) this.events.set(fingerprint, true);
    } else {
      if (event.type !== "assistant" || !event.message?.usage) return;
      const message = event.message;
      const time = validTime(event.timestamp);
      const total = tokens(message.usage, client);
      if (
        !time ||
        !total ||
        typeof message.id !== "string" ||
        !message.id ||
        message.id.length > 256
      ) {
        this.warn(client, "部分用量事件格式不受支持，已跳过");
        return;
      }
      const session =
        typeof event.sessionId === "string" && event.sessionId.length <= 256
          ? hash(`claude:${event.sessionId}`)
          : checkpoint.session;
      const requestId =
        typeof event.requestId === "string" && event.requestId.length <= 256 ? event.requestId : "";
      const fingerprint = hash(JSON.stringify([client, session, message.id, requestId]));
      const prior = this.events.get(fingerprint);
      const delta = subtract(total, prior?.total ?? blank());
      if (!FIELDS.some((key) => delta[key])) return;
      const key = this.addRecord(
        client,
        session,
        modelName(message.model),
        time,
        delta,
        prior?.record,
      );
      if (key)
        this.events.set(fingerprint, {
          record: key,
          total: Object.fromEntries(
            FIELDS.map((field) => [field, Math.max(total[field], prior?.total?.[field] ?? 0)]),
          ),
        });
    }
  }

  addRecord(client, session, model, time, delta, existingKey) {
    const bucketStart = localDay(time);
    const key = existingKey ?? hash(JSON.stringify([client, session, model, bucketStart]));
    const prior = this.records.get(key);
    if (!prior && this.records.size >= LOCAL_USAGE_LIMITS.records) {
      this.warn(client, "汇总记录达到安全上限，已暂停收录新记录");
      return null;
    }
    const row = prior ?? { client, session, model, bucketStart, sampleAt: time, ...blank() };
    if (FIELDS.some((field) => !Number.isSafeInteger(row[field] + delta[field]))) {
      this.warn(client, "用量计数超出安全范围，已跳过");
      return null;
    }
    for (const field of FIELDS) row[field] += delta[field];
    if (time > row.sampleAt) row.sampleAt = time;
    this.records.set(key, row);
    this.recordsRevision++;
    this.dirty = true;
    return key;
  }

  async persist() {
    if (!this.dirty) return;
    if (this.indexPath) {
      if (!this.eventIndex) {
        await this.openIndex();
        this.eventIndex.begin();
      }
      try {
        await this.verifyIndex();
        this.eventIndex.save(this.serializeState([]));
        this.eventIndex.commit();
        this.dirty = false;
      } finally {
        this.closeIndex();
      }
      return;
    }
    if (this.events.size >= LOCAL_USAGE_LIMITS.events) {
      await this.migrateIndex();
      return;
    }
    await mkdir(dirname(this.file), { recursive: true });
    // Windows 8.3 短目录名也是同一目录的系统别名，沿用缓存读取的身份校验。
    await safePath(dirname(this.file), { allowSystemMapping: true });
    try {
      if ((await lstat(this.file)).isSymbolicLink()) throw new Error("UNSAFE_PATH");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const data = this.serializeState([...this.events]);
    await this.writeState(data);
    this.dirty = false;
  }

  serializeState(events) {
    const data = JSON.stringify({
      version: 1,
      enabled: this.enabled,
      lastScannedAt: this.lastScannedAt,
      checkpoints: [...this.checkpoints],
      events,
      records: [...this.records],
    });
    if (Buffer.byteLength(data) > LOCAL_USAGE_LIMITS.stateBytes) throw new Error("STATE_LIMIT");
    return data;
  }

  async writeState(data) {
    try {
      const existing = await safeOpen(this.file, undefined, { allowSystemMapping: true });
      await existing.handle.close();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(data, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporary, this.file);
    } finally {
      await handle?.close();
      await unlink(temporary).catch(() => {});
    }
  }

  async verifyIndex() {
    const stat = await safePath(this.indexPath);
    if (!stat.isFile() || stat.nlink !== 1n || stat.size > EVENT_INDEX_LIMITS.bytes)
      throw new Error("UNSAFE_INDEX");
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      try {
        const sidecar = await safePath(`${this.indexPath}${suffix}`);
        if (!sidecar.isFile() || sidecar.nlink !== 1n) throw new Error("UNSAFE_INDEX");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return stat;
  }

  async openIndex() {
    if (this.eventIndex) return;
    const before = await this.verifyIndex();
    const index = await openEventIndex(this.indexPath);
    try {
      const after = await this.verifyIndex();
      if (fileIdentity(before) !== fileIdentity(after)) throw new Error("UNSAFE_INDEX");
      this.eventIndex = index;
      this.events = index;
    } catch (error) {
      index.close();
      throw error;
    }
  }

  closeIndex() {
    if (!this.eventIndex) return;
    try {
      this.eventIndex.rollback();
    } finally {
      this.eventIndex.close();
    }
    this.eventIndex = null;
  }

  async migrateIndex() {
    await mkdir(dirname(this.file), { recursive: true });
    await safePath(dirname(this.file), { allowSystemMapping: true });
    let directory = await realpath(dirname(this.file));
    let existing;
    try {
      existing = await safeOpen(this.file, undefined, { allowSystemMapping: true });
      // 系统可能仅重定向缓存文件而不重定向目录；指针与索引必须同处真实目录。
      directory = dirname(await realpath(this.file));
      await safePath(directory);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } finally {
      await existing?.handle.close();
    }
    const path = join(directory, `usage-events-${randomUUID()}.sqlite`);
    const handle = await open(path, "wx", 0o600);
    await handle.close();
    let index;
    let backup;
    try {
      index = await openEventIndex(path, { create: true });
      index.begin();
      for (const [key, value] of this.events) index.set(key, value);
      // 旧版达到十万事件后仍推进 offset；从头受控重放，完整索引防止历史翻倍。
      const state = JSON.parse(this.serializeState([]));
      state.checkpoints = [];
      index.save(JSON.stringify(state));
      index.commit();
      index.close();
      index = null;
      // 独立保留升级前的原始缓存，不能以已清检查点的新状态冒充迁移备份。
      let prior;
      try {
        prior = await safeOpen(this.file, undefined, { allowSystemMapping: true });
        if (prior.stat.size > LOCAL_USAGE_LIMITS.stateBytes) throw new Error("STATE_LIMIT");
        backup = `${basename(this.file)}.v1-${randomUUID()}.backup.json`;
        const saved = await open(join(dirname(path), backup), "wx", 0o600);
        try {
          await saved.writeFile(await prior.handle.readFile());
          await saved.sync();
        } finally {
          await saved.close();
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      } finally {
        await prior?.handle.close();
      }
      await this.writeState(
        JSON.stringify({ version: 2, index: basename(path), ...(backup ? { backup } : {}) }),
      );
      this.indexPath = path;
      this.checkpoints.clear();
      this.events = null;
      this.dirty = false;
    } catch (error) {
      if (index) {
        index.rollback();
        index.close();
      }
      await unlink(path).catch(() => {});
      throw error;
    }
  }
}
