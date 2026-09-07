import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

const RETENTION = 30 * 86_400_000;
const MAX_SAMPLES = 30_000;

export function pruneSamples(samples, now = Date.now()) {
  const unique = new Map();
  for (const s of samples) {
    const at = Date.parse(s?.at);
    if (!Number.isFinite(at) || at < now - RETENTION || at > now + 60_000) continue;
    const sample = { at: new Date(at).toISOString() };
    for (const key of ["cpu", "memory", "disk"]) {
      if (Number.isFinite(s[key]) && s[key] >= 0 && s[key] <= 100) sample[key] = s[key];
    }
    if (Object.keys(sample).length > 1) unique.set(sample.at, sample);
  }
  return [...unique.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_SAMPLES);
}

export class MetricsStore {
  #file;
  #queue = Promise.resolve();
  constructor(file) {
    this.#file = file;
  }
  async #read() {
    try {
      const value = JSON.parse(await readFile(this.#file, "utf8"));
      if (!value || Array.isArray(value) || typeof value !== "object")
        throw new Error("Invalid metrics file");
      return value;
    } catch (err) {
      if (err.code === "ENOENT") return {};
      throw err;
    }
  }
  record(id, probe) {
    if (typeof id !== "string" || !id || id.length > 256)
      return Promise.reject(new Error("Invalid server ID"));
    const job = this.#queue.then(async () => {
      const saved = await this.#read();
      const data = Object.create(null);
      for (const [key, value] of Object.entries(saved)) {
        const samples = pruneSamples(Array.isArray(value) ? value : []);
        if (samples.length) data[key] = samples;
      }
      data[id] = pruneSamples([...(data[id] ?? []), probe]);
      await mkdir(dirname(this.#file), { recursive: true });
      await writeFile(`${this.#file}.tmp`, JSON.stringify(data), "utf8");
      await rename(`${this.#file}.tmp`, this.#file);
      return true;
    });
    this.#queue = job.catch(() => {});
    return job;
  }
  async list(id, since = 0) {
    await this.#queue;
    const data = await this.#read();
    return pruneSamples(Array.isArray(data[id]) ? data[id] : []).filter(
      (s) => Date.parse(s.at) >= since,
    );
  }
}
