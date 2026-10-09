import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { validateImageDataUrl } from "./image-data.mjs";

export class ProfileService {
  constructor(file, vault, normalizeImage = validateImageDataUrl) {
    this.file = file;
    this.vault = vault;
    this.normalizeImage = normalizeImage;
    this.queue = Promise.resolve();
    this.identitySource = null;
  }
  setIdentitySource(service) {
    this.identitySource = service;
  }
  async local() {
    let name = "";
    let avatarDataUrl = "";
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8"));
      name = typeof saved.name === "string" ? saved.name : "";
      try {
        avatarDataUrl = this.normalizeImage(saved.avatarDataUrl);
      } catch {
        // 损坏的旧头像不应阻止用户访问已有资料和密钥库。
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("个人资料读取失败，请检查数据目录。");
    }
    return { name, avatarDataUrl };
  }
  async get() {
    const local = await this.local();
    let mainIdentity = null;
    try {
      mainIdentity = (await this.identitySource?.get()) || null;
    } catch {
      // 系统身份密钥不可用不应阻止原有本机资料和密钥库访问。
    }
    const name = mainIdentity?.syncName
      ? (mainIdentity.profile.name || mainIdentity.profile.username).slice(0, 40)
      : local.name;
    const avatarDataUrl =
      mainIdentity?.syncAvatar && mainIdentity.avatarDataUrl
        ? mainIdentity.avatarDataUrl
        : local.avatarDataUrl;
    const status = await this.vault.status();
    return {
      name,
      avatarDataUrl,
      ready: Boolean(local.name && status.exists),
      vaultExists: status.exists,
      ...(this.identitySource ? { mainIdentity } : {}),
    };
  }
  save({ name, password, avatarDataUrl } = {}) {
    const task = this.queue.then(async () => {
      if (typeof name !== "string" || !name.trim() || name.trim().length > 40)
        throw new Error("姓名需要 1 至 40 个字符。");
      const current = await this.get();
      const local = await this.local();
      const avatar =
        avatarDataUrl === undefined ? current.avatarDataUrl : this.normalizeImage(avatarDataUrl);
      const nameChanged = name.trim() !== current.name;
      const avatarChanged = avatarDataUrl !== undefined && avatar !== current.avatarDataUrl;
      const identity = current.mainIdentity;
      const savedName =
        identity?.syncName && !nameChanged ? local.name || name.trim() : name.trim();
      const savedAvatar = identity?.syncAvatar && !avatarChanged ? local.avatarDataUrl : avatar;
      if (!current.ready) {
        if (current.vaultExists) await this.vault.unlock(password ?? "");
        else {
          if (typeof password !== "string" || password.length < 10 || password.length > 256)
            throw new Error("主密码需要 10 至 256 个字符。");
          await this.vault.create(password);
        }
      }
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(
        `${this.file}.tmp`,
        JSON.stringify({ name: savedName, avatarDataUrl: savedAvatar }),
        "utf8",
      );
      await rename(`${this.file}.tmp`, this.file);
      if (
        identity &&
        ((identity.syncName && nameChanged) || (identity.syncAvatar && avatarChanged))
      ) {
        await this.identitySource.preferences({
          syncName: identity.syncName && !nameChanged,
          syncAvatar: identity.syncAvatar && !avatarChanged,
        });
      }
      return this.get();
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
