import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

export function remotePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4096 ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new Error("Invalid remote path");
  return value;
}

function call(sftp, method, ...args) {
  return new Promise((resolve, reject) =>
    sftp[method](...args, (err, value) => (err ? reject(err) : resolve(value))),
  );
}

export class SftpService {
  #connect;
  constructor(connect) {
    this.#connect = connect;
  }

  async #run(target, credential, operation) {
    const client = await this.#connect(target, credential);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("SFTP operation timed out"));
        client.destroy();
      }, 120_000);
    });
    const closed = new Promise((_, reject) => {
      client.once("error", reject);
      client.once("close", () => reject(new Error("SFTP connection closed")));
    });
    try {
      return await Promise.race([
        timeout,
        closed,
        (async () => {
          const sftp = await new Promise((resolve, reject) =>
            client.sftp((err, channel) => (err ? reject(err) : resolve(channel))),
          );
          return operation(sftp);
        })(),
      ]);
    } finally {
      clearTimeout(timer);
      client.end();
    }
  }

  async list(target, credential, path) {
    remotePath(path);
    return this.#run(target, credential, async (sftp) => {
      const canonical = await call(sftp, "realpath", path);
      const list = await call(sftp, "readdir", canonical);
      const entries = list
        .filter((x) => x.filename !== "." && x.filename !== "..")
        .map((x) => ({
          name: x.filename,
          size: x.attrs.size,
          modified: x.attrs.mtime * 1000,
          directory: x.attrs.isDirectory(),
          symlink: x.attrs.isSymbolicLink(),
        }))
        .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
      return {
        path: canonical,
        entries: entries.slice(0, 10_000),
        truncated: entries.length > 10_000,
      };
    });
  }

  async download(target, credential, path, destination) {
    remotePath(path);
    const temporary = `${destination}.${randomUUID()}.part`;
    try {
      await this.#run(target, credential, async (sftp) => {
        const stat = await call(sftp, "stat", path);
        if (!stat.isFile()) throw new Error("Only regular files can be downloaded");
        await pipeline(sftp.createReadStream(path), createWriteStream(temporary, { flags: "wx" }));
      });
      await rename(temporary, destination);
      return true;
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
