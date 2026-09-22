import { mkdir, rename, stat } from "node:fs/promises";
import { join, win32 } from "node:path";

export function windowsAppId(packaged) {
  return packaged ? "dev.songwo.nanpad" : "dev.songwo.nanpad.development";
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
    entry.appUserModelId !== windowsAppId(true) ||
    win32.basename(entry.target).toLowerCase() !== "electron.exe"
  )
    return null;
  await mkdir(backupDirectory, { recursive: true });
  const destination = join(backupDirectory, `Electron-${Date.now()}-${crypto.randomUUID()}.lnk`);
  await rename(source, destination);
  return destination;
}
