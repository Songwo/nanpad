// 索引只存事件指纹和计数，不存原始日志、提示词或路径。
export const EVENT_INDEX_LIMITS = Object.freeze({
  bytes: 512 * 1024 * 1024,
  cacheKiB: 2048,
  stateBytes: 48 * 1024 * 1024,
});

export async function openEventIndex(path, { create = false } = {}) {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try {
    database.exec(`PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      PRAGMA cache_size=-${EVENT_INDEX_LIMITS.cacheKiB}; PRAGMA mmap_size=0; PRAGMA busy_timeout=1000;`);
    const { page_size: pageSize } = database.prepare("PRAGMA page_size").get();
    database.exec(`PRAGMA max_page_count=${Math.floor(EVENT_INDEX_LIMITS.bytes / pageSize)}`);
    if (create)
      database.exec(`CREATE TABLE events (key BLOB PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);`);
    const get = database.prepare(
      "SELECT CASE WHEN length(CAST(value AS BLOB))<=1024 THEN value ELSE NULL END AS value FROM events WHERE key=?",
    );
    const set = database.prepare(
      "INSERT INTO events(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    );
    const save = database.prepare(
      "INSERT INTO state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    );
    const checked = (action) => {
      try {
        return action();
      } catch (error) {
        error.localUsageIndex = true;
        throw error;
      }
    };
    return {
      get(key) {
        return checked(() => {
          const row = get.get(Buffer.from(key, "hex"));
          if (row && row.value === null) throw new Error("INDEX_VALUE_LIMIT");
          return row ? JSON.parse(row.value) : undefined;
        });
      },
      has(key) {
        return checked(() => Boolean(get.get(Buffer.from(key, "hex"))));
      },
      set(key, value) {
        checked(() => set.run(Buffer.from(key, "hex"), JSON.stringify(value)));
      },
      get size() {
        return database.prepare("SELECT count(*) AS count FROM events").get().count;
      },
      begin() {
        database.exec("BEGIN IMMEDIATE");
      },
      save(state) {
        save.run(state);
      },
      load() {
        const size = database
          .prepare("SELECT length(CAST(value AS BLOB)) AS size FROM state WHERE id=1")
          .get()?.size;
        if (!Number.isSafeInteger(size) || size > EVENT_INDEX_LIMITS.stateBytes)
          throw new Error("STATE_LIMIT");
        return database.prepare("SELECT value FROM state WHERE id=1").get()?.value;
      },
      commit() {
        database.exec("COMMIT");
      },
      close() {
        database.close();
      },
      rollback() {
        if (database.isTransaction) database.exec("ROLLBACK");
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
