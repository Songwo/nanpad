import { mkdir, rename, stat } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join, win32 } from "node:path";

export function windowsAppId(packaged) {
  return packaged ? "dev.songwo.zhiyu" : "dev.songwo.zhiyu.development";
}

/** 显示身份独立于安装与存储身份；改名不能迁移用户资料或 Chromium 会话。 */
export function initializeAppIdentity(app, { testDataDirectory, platform = process.platform } = {}) {
  app.setName("Nanpad");
  const isolated = !app.isPackaged && testDataDirectory;
  const userData = isolated || app.getPath("userData");
  const sessionData = isolated || app.getPath("sessionData");
  for (const directory of new Set([userData, sessionData]))
    mkdirSync(directory, { recursive: true });
  // macOS/Linux 的系统密钥存储依赖原应用名，Windows Shell 改名仅作用于 Windows。
  if (platform === "win32") app.setName("知屿 Zhiyu");
  app.setPath("userData", userData);
  app.setPath("sessionData", sessionData);
}

/** 只迁移抢占正式版身份的 Electron 开发快捷方式，并保留可恢复备份。 */
export async function migrateLegacyWindowsShortcut({
  programsDirectory,
  backupDirectory,
  readShortcut,
}) {
  const source = join(programsDirectory, "Electron.lnk");
  try {
    await stat(source);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const entry = readShortcut(source);
  if (
    entry.appUserModelId !== "dev.songwo.nanpad" ||
    win32.basename(entry.target).toLowerCase() !== "electron.exe"
  )
    return null;
  await mkdir(backupDirectory, { recursive: true });
  const destination = join(backupDirectory, `Electron-${Date.now()}-${crypto.randomUUID()}.lnk`);
  await rename(source, destination);
  return destination;
}
