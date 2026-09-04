import { randomBytes, createCipheriv, createDecipheriv, scrypt, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
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

  constructor(file) {
    this.#file = file;
  }

  get unlocked() {
    return this.#key !== null;
  }

  async #read() {
    if (this.#doc) return this.#doc;
    try {
      this.#doc = JSON.parse(await readFile(this.#file, "utf8"));
    } catch {
      this.#doc = null;
    }
    return this.#doc;
  }

  async #write(doc) {
    this.#doc = doc;
    await mkdir(dirname(this.#file), { recursive: true });
    const tmp = `${this.#file}.tmp`;
    await writeFile(tmp, JSON.stringify(doc), "utf8");
    await rename(tmp, this.#file);
  }

  async status() {
    const doc = await this.#read();
    return { exists: Boolean(doc), unlocked: this.unlocked };
  }

  /** First run: pick a master password and seal an empty vault with it. */
  async create(master) {
    if (await this.#read()) throw new Error("密钥库已存在，请直接解锁");
    if (!master || master.length < 6) throw new Error("主密码至少 6 位");
    const salt = randomBytes(16);
    const key = await derive(master, salt, KEY_LEN, SCRYPT);
    // A sealed constant is the unlock check: no password hash on disk.
    const check = seal(key, Buffer.from("sinan-vault"));
    await this.#write({
      v: VERSION,
      salt: salt.toString("base64"),
      check,
      records: {},
    });
    this.#key = key;
    return { ok: true };
  }

  async unlock(master) {
    const doc = await this.#read();
    if (!doc) throw new Error("密钥库尚未创建");
    const key = await derive(master, Buffer.from(doc.salt, "base64"), KEY_LEN, SCRYPT);
    let probe;
    try {
      probe = open(key, doc.check);
    } catch {
      throw new Error("主密码不正确");
    }
    const expected = Buffer.from("sinan-vault");
    if (probe.length !== expected.length || !timingSafeEqual(probe, expected)) {
      throw new Error("主密码不正确");
    }
    this.#key = key;
    return { ok: true };
  }

  lock() {
    this.#key = null;
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
  async changePassword(oldMaster, newMaster) {
    if (!newMaster || newMaster.length < 6) throw new Error("新主密码至少 6 位");
    await this.unlock(oldMaster);
    const doc = await this.#read();
    const oldKey = this.#require();

    const salt = randomBytes(16);
    const newKey = await derive(newMaster, salt, KEY_LEN, SCRYPT);
    const records = {};
    for (const [id, rec] of Object.entries(doc.records ?? {})) {
      records[id] = seal(newKey, open(oldKey, rec));
    }

    await this.#write({
      v: VERSION,
      salt: salt.toString("base64"),
      check: seal(newKey, Buffer.from("sinan-vault")),
      records,
    });
    this.#key = newKey;
    return { ok: true, count: Object.keys(records).length };
  }

  #require() {
    if (!this.#key) throw new Error("密钥库已锁定");
    return this.#key;
  }

  async set(id, secret) {
    const key = this.#require();
    const doc = (await this.#read()) ?? {};
    doc.records = { ...(doc.records ?? {}), [id]: seal(key, Buffer.from(JSON.stringify(secret), "utf8")) };
    await this.#write(doc);
    return { ok: true };
  }

  async get(id) {
    const key = this.#require();
    const doc = await this.#read();
    const rec = doc?.records?.[id];
    if (!rec) return null;
    return JSON.parse(open(key, rec).toString("utf8"));
  }

  async remove(id) {
    this.#require();
    const doc = await this.#read();
    if (doc?.records?.[id]) {
      delete doc.records[id];
      await this.#write(doc);
    }
    return { ok: true };
  }

  async list() {
    const doc = await this.#read();
    return Object.keys(doc?.records ?? {});
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
