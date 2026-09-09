import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { renameSync } from "node:fs";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const derive = promisify(scrypt);

const VERSION = 1;
const KEY_LEN = 32;
const IV_LEN = 12;
// Interactive unlock, so cost is tuned to stay under ~250ms on a laptop.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * Credential store for SSH passwords, private keys and API secrets.
 *
 * The master password is never written anywhere — it derives a key that lives
 * in this process's memory until the app locks or quits. On disk there is only
 * AES-256-GCM ciphertext, one IV and one auth tag per record, so a stolen
 * `vault.enc` is inert without the password.
 */
export class Vault {
  #file;
  #key = null;
  #doc = null;
  #queue = Promise.resolve();
  #generation = 0;

  constructor(file) {
    this.#file = file;
  }

  get unlocked() {
    return this.#key !== null;
  }

  #assertGeneration(generation) {
    if (generation !== this.#generation) throw new Error("密钥库已锁定，操作已取消。");
  }

  #enqueue(action, { requireUnlocked = false, cancelOnLock = true } = {}) {
    if (requireUnlocked && !this.unlocked) return Promise.reject(new Error("密钥库已锁定"));
    const generation = this.#generation;
    const task = this.#queue.then(() => {
      if (cancelOnLock) this.#assertGeneration(generation);
      return action(generation);
    });
    this.#queue = task.catch(() => {});
    return task;
  }

  #replaceKey(key) {
    if (this.#key && this.#key !== key) this.#key.fill(0);
    this.#key = key;
  }

  async #read() {
    if (this.#doc) return this.#doc;
    try {
      this.#doc = JSON.parse(await readFile(this.#file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("密钥库读取失败，请保留原文件并检查备份。");
      this.#doc = null;
    }
    return this.#doc;
  }

  async #write(doc, generation, nextKey) {
    const tmp = `${this.#file}.${randomBytes(12).toString("hex")}.tmp`;
    try {
      await mkdir(dirname(this.#file), { recursive: true });
      this.#assertGeneration(generation);
      await writeFile(tmp, JSON.stringify(doc), { encoding: "utf8", mode: 0o600, flag: "wx" });
      this.#assertGeneration(generation);
      // 提交段不让出事件循环，保证锁库不能插在落盘与切换解密密钥之间。
      renameSync(tmp, this.#file);
      this.#doc = doc;
      if (nextKey) this.#replaceKey(nextKey);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => {});
      this.#assertGeneration(generation);
      throw new Error("密钥库保存失败，请检查本地文件权限。", { cause: error });
    }
  }

  status() {
    return this.#enqueue(
      async () => {
        const doc = await this.#read();
        return { exists: Boolean(doc), unlocked: this.unlocked };
      },
      { cancelOnLock: false },
    );
  }

  /** First run: pick a master password and seal an empty vault with it. */
  create(master) {
    return this.#enqueue(async (generation) => {
      if (typeof master !== "string" || master.length < 6) throw new Error("主密码至少 6 位");
      if (await this.#read()) throw new Error("密钥库已存在，请直接解锁");
      this.#assertGeneration(generation);
      const salt = randomBytes(16);
      const key = await derive(master, salt, KEY_LEN, SCRYPT);
      try {
        this.#assertGeneration(generation);
        await this.#write(
          {
            v: VERSION,
            salt: salt.toString("base64"),
            check: seal(key, Buffer.from("sinan-vault")),
            records: {},
          },
          generation,
          key,
        );
        return { ok: true };
      } finally {
        if (this.#key !== key) key.fill(0);
      }
    });
  }

  async #verifiedKey(master, doc, generation) {
    if (typeof master !== "string" || !master) throw new Error("主密码不正确");
    const key = await derive(master, Buffer.from(doc.salt, "base64"), KEY_LEN, SCRYPT);
    try {
      this.#assertGeneration(generation);
      let probe;
      try {
        probe = open(key, doc.check);
      } catch {
        throw new Error("主密码不正确");
      }
      const expected = Buffer.from("sinan-vault");
      if (probe.length !== expected.length || !timingSafeEqual(probe, expected))
        throw new Error("主密码不正确");
      return key;
    } catch (error) {
      key.fill(0);
      throw error;
    }
  }

  unlock(master) {
    return this.#enqueue(async (generation) => {
      const doc = await this.#read();
      if (!doc) throw new Error("密钥库尚未创建");
      this.#assertGeneration(generation);
      const key = await this.#verifiedKey(master, doc, generation);
      try {
        this.#assertGeneration(generation);
        this.#replaceKey(key);
        return { ok: true };
      } finally {
        if (this.#key !== key) key.fill(0);
      }
    });
  }

  lock() {
    this.#generation += 1;
    this.#replaceKey(null);
    return { ok: true };
  }

  /**
   * Re-key the whole vault.
   *
   * A new password means a new salt and therefore a new key, so every record
   * has to be decrypted with the old one and re-sealed with the new one. The
   * document is only written once, at the end — a crash halfway through must
   * not leave half the records unreadable by either password.
   */
  changePassword(oldMaster, newMaster) {
    return this.#enqueue(async (generation) => {
      if (typeof newMaster !== "string" || newMaster.length < 6)
        throw new Error("新主密码至少 6 位");
      const doc = await this.#read();
      if (!doc) throw new Error("密钥库尚未创建");
      this.#assertGeneration(generation);
      const oldKey = await this.#verifiedKey(oldMaster, doc, generation);
      let newKey;
      try {
        this.#assertGeneration(generation);
        const salt = randomBytes(16);
        newKey = await derive(newMaster, salt, KEY_LEN, SCRYPT);
        this.#assertGeneration(generation);
        const records = Object.create(null);
        for (const [id, rec] of Object.entries(doc.records ?? {}))
          records[id] = seal(newKey, open(oldKey, rec));
        await this.#write(
          {
            v: VERSION,
            salt: salt.toString("base64"),
            check: seal(newKey, Buffer.from("sinan-vault")),
            records,
          },
          generation,
          newKey,
        );
        return { ok: true, count: Object.keys(records).length };
      } finally {
        oldKey.fill(0);
        if (newKey && this.#key !== newKey) newKey.fill(0);
      }
    });
  }

  #require() {
    if (!this.#key) throw new Error("密钥库已锁定");
    return this.#key;
  }

  set(id, secret) {
    return this.#enqueue(
      async (generation) => {
        const doc = await this.#read();
        this.#assertGeneration(generation);
        const key = this.#require();
        const records = {
          ...(doc?.records ?? {}),
          [id]: seal(key, Buffer.from(JSON.stringify(secret), "utf8")),
        };
        await this.#write({ ...doc, records }, generation);
        return { ok: true };
      },
      { requireUnlocked: true },
    );
  }

  get(id) {
    return this.#enqueue(
      async (generation) => {
        const doc = await this.#read();
        this.#assertGeneration(generation);
        const key = this.#require();
        if (!Object.hasOwn(doc?.records ?? {}, id)) return null;
        return JSON.parse(open(key, doc.records[id]).toString("utf8"));
      },
      { requireUnlocked: true },
    );
  }

  remove(id) {
    return this.#enqueue(
      async (generation) => {
        const doc = await this.#read();
        this.#assertGeneration(generation);
        this.#require();
        if (Object.hasOwn(doc?.records ?? {}, id)) {
          const records = { ...doc.records };
          delete records[id];
          await this.#write({ ...doc, records }, generation);
        }
        return { ok: true };
      },
      { requireUnlocked: true },
    );
  }

  list() {
    return this.#enqueue(
      async () => {
        const doc = await this.#read();
        return Object.keys(doc?.records ?? {});
      },
      { cancelOnLock: false },
    );
  }
}

function seal(key, plaintext) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

function open(key, rec) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(rec.iv, "base64"));
  decipher.setAuthTag(Buffer.from(rec.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(rec.data, "base64")), decipher.final()]);
}

export const vaultPath = (userData) => join(userData, "vault.enc");
