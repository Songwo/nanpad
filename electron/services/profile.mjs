import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export class ProfileService {
  constructor(file, vault) {
    this.file = file;
    this.vault = vault;
    this.queue = Promise.resolve();
  }
  async get() {
    let name = "";
    try {
      name = JSON.parse(await readFile(this.file, "utf8")).name || "";
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("个人资料读取失败，请检查数据目录。");
    }
    const status = await this.vault.status();
    return { name, ready: Boolean(name && status.exists), vaultExists: status.exists };
  }
  save({ name, password } = {}) {
    const task = this.queue.then(async () => {
      if (typeof name !== "string" || !name.trim() || name.trim().length > 40)
        throw new Error("姓名需要 1 至 40 个字符。");
      const current = await this.get();
      if (!current.ready) {
        if (current.vaultExists) await this.vault.unlock(password ?? "");
        else {
          if (typeof password !== "string" || password.length < 10 || password.length > 256)
            throw new Error("主密码需要 10 至 256 个字符。");
          await this.vault.create(password);
        }
      }
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify({ name: name.trim() }), "utf8");
      await rename(`${this.file}.tmp`, this.file);
      return this.get();
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
