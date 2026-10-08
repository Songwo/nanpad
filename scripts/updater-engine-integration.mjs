import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import electron from "electron";

if (!process.versions.electron) {
  const directory = await mkdtemp(join(tmpdir(), "zhiyu-update-engine-"));
  try {
    const env = { ...process.env, ZHIYU_UPDATE_FIXTURE: directory };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [fileURLToPath(import.meta.url)], {
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    const code = await new Promise((done, reject) => {
      child.on("error", reject);
      child.on("exit", done);
    });
    assert.equal(code, 0);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
} else {
  const directory = process.env.ZHIYU_UPDATE_FIXTURE;
  const { app } = electron;
  app.setPath("userData", directory);
  void app.whenReady().then(async () => {
    const { DesktopUpdater } = await import("../electron/services/app-updater.mjs");
    const { default: library } = await import("electron-updater");
    const payload = Buffer.alloc(256 * 1024, 42);
    const checksum = createHash("sha512").update(payload).digest("base64");
    let corrupt = false;
    let requests = 0;
    const server = createServer((request, response) => {
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      if (path === "/latest.yml") {
        response.end(
          `version: 99.0.0\nfiles:\n  - url: Nanpad-99.0.0-setup.exe\n    sha512: ${checksum}\n    size: ${payload.length}\npath: Nanpad-99.0.0-setup.exe\nsha512: ${checksum}\nreleaseDate: '2026-10-08T00:00:00.000Z'\n`,
        );
      } else if (path.endsWith(".exe")) {
        requests++;
        response.writeHead(200, { "Content-Length": payload.length });
        response.end(corrupt ? Buffer.alloc(payload.length, 43) : payload);
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const broken of [false, true]) {
        corrupt = broken;
        const config = join(directory, `feed-${broken}.yml`);
        await writeFile(
          config,
          `provider: generic\nurl: ${url}\nupdaterCacheDirName: isolated-${broken}\n`,
        );
        const engine = new library.NsisUpdater({ provider: "generic", url });
        engine.forceDevUpdateConfig = true;
        engine.updateConfigPath = config;
        engine.disableDifferentialDownload = true;
        engine.logger = null;
        Object.defineProperty(engine.app, "baseCachePath", { get: () => directory });
        const updater = new DesktopUpdater({ engine, current: app.getVersion(), supported: true });
        assert.equal((await updater.check()).state, "outdated");
        const before = requests;
        const result = await updater.download();
        assert.equal(requests, before + 1);
        assert.equal(result.state, broken ? "error" : "downloaded");
        if (broken) assert.match(result.reason, /checksum|sha512/i);
      }
      console.log(
        JSON.stringify({
          ok: true,
          realNsisEngine: true,
          realHttpDownload: true,
          corruptedDownloadRejected: true,
          installerExecuted: false,
          isolated: true,
        }),
      );
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      await new Promise((done) => server.close(done));
      app.exit(process.exitCode || 0);
    }
  });
}
