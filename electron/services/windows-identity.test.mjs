import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { windowsAppId, migrateLegacyWindowsShortcut } from "./windows-identity.mjs";
test("Windows 开发版与正式版使用不同应用身份", () => {
  assert.notEqual(windowsAppId(false), windowsAppId(true));
  assert.equal(windowsAppId(true), "dev.songwo.nanpad");
});
test("只备份抢占司南身份的 Electron 快捷方式，重复运行无副作用", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanpad-identity-"));
  const file = join(directory, "Electron.lnk");
  const options = {
    programsDirectory: directory,
    backupDirectory: join(directory, "backups"),
    readShortcut: () => ({
      target: "C:\\runtime\\electron.exe",
      appUserModelId: windowsAppId(true),
    }),
  };
  try {
    await writeFile(file, "fixture-shortcut");
    const backup = await migrateLegacyWindowsShortcut(options);
    assert.equal(await readFile(backup, "utf8"), "fixture-shortcut");
    await assert.rejects(stat(file), { code: "ENOENT" });
    assert.equal(await migrateLegacyWindowsShortcut(options), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("其他应用、独立开发身份与正式版快捷方式保持原样", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanpad-identity-"));
  const file = join(directory, "Electron.lnk");
  try {
    await writeFile(file, "keep");
    for (const entry of [
      { target: "C:\\electron.exe", appUserModelId: "other.app" },
      { target: "C:\\electron.exe", appUserModelId: windowsAppId(false) },
      { target: "C:\\Nanpad.exe", appUserModelId: windowsAppId(true) },
    ]) {
      assert.equal(
        await migrateLegacyWindowsShortcut({
          programsDirectory: directory,
          backupDirectory: join(directory, "backups"),
          readShortcut: () => entry,
        }),
        null,
      );
      assert.equal(await readFile(file, "utf8"), "keep");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
