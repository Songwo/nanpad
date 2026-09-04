import { app, BrowserWindow, ipcMain, shell, Menu } from "electron";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SshManager } from "./services/ssh.mjs";
import { probeCertificate, probeDomain } from "./services/net-probe.mjs";
import { Vault, vaultPath } from "./services/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// Launched as `electron electron/main.mjs` there is no package.json beside the
// entry, so Electron would call itself "Electron" and put the user's assets in
// a directory named after the runtime. Pin it before anything reads a path.
app.setName("Nanpad");
// Only `npm run desktop` sets this. Without it — packaged, or a bare
// `electron .` — the window loads the built renderer, never a dev server that
// may not be running.
const DEV_URL = process.env.SINAN_DEV_URL || null;

/** @type {BrowserWindow | null} */
let win = null;
let vault = null;
let ssh = null;

function dataFile() {
  return join(app.getPath("userData"), "assets.json");
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: "#f4f5f5",
    // The app paints its own chrome; the platform keeps its window buttons.
    titleBarStyle: "hidden",
    ...(process.platform === "win32"
      ? { titleBarOverlay: { color: "#f4f5f5", symbolColor: "#0f1419", height: 44 } }
      : { trafficLightPosition: { x: 16, y: 15 } }),
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win?.show());

  // External links belong in the user's browser, never in the app frame.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  if (DEV_URL) {
    await win.loadURL(DEV_URL);
  } else {
    await win.loadFile(join(here, "../dist-desktop/index.html"));
  }
}

function emit(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** Wrap a handler so the renderer always gets `{ok}` or `{ok:false, error}`. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  });
}

function registerIpc() {
  vault = new Vault(vaultPath(app.getPath("userData")));
  ssh = new SshManager(emit);

  handle("app:info", async () => ({
    platform: process.platform,
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    userData: app.getPath("userData"),
  }));

  // ---- assets on disk -----------------------------------------------------
  handle("store:load", async () => {
    try {
      return JSON.parse(await readFile(dataFile(), "utf8"));
    } catch {
      return null;
    }
  });
  handle("store:save", async (snapshot) => {
    const file = dataFile();
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
    await rename(tmp, file);
    return true;
  });

  // ---- vault --------------------------------------------------------------
  handle("vault:status", () => vault.status());
  handle("vault:create", (master) => vault.create(master));
  handle("vault:unlock", (master) => vault.unlock(master));
  handle("vault:lock", () => vault.lock());
  handle("vault:set", (id, secret) => vault.set(id, secret));
  handle("vault:get", (id) => vault.get(id));
  handle("vault:remove", (id) => vault.remove(id));
  handle("vault:list", () => vault.list());

  // ---- ssh ----------------------------------------------------------------
  handle("ssh:open", async (target, size) => ssh.openShell(target, await vault.get(credentialId(target.id)), size));
  handle("ssh:probe", async (target) => ssh.probe(target, await vault.get(credentialId(target.id))));
  // The credential form tests what is on screen, which is not saved yet.
  handle("ssh:test", (target, credential) => ssh.test(target, credential));
  handle("ssh:close", (sessionId) => {
    ssh.close(sessionId);
    return true;
  });
  ipcMain.on("ssh:write", (_e, sessionId, data) => ssh.write(sessionId, data));
  ipcMain.on("ssh:resize", (_e, sessionId, cols, rows) => ssh.resize(sessionId, cols, rows));

  // ---- network probes -----------------------------------------------------
  handle("domain:probe", (name) => probeDomain(name));
  handle("cert:probe", (host, port, servername) => probeCertificate(host, port, servername));

  handle("shell:open-external", async (url) => {
    if (!/^https?:\/\//.test(url)) throw new Error("只允许打开 http(s) 链接");
    await shell.openExternal(url);
    return true;
  });
}

export const credentialId = (serverId) => `ssh:${serverId}`;

// One window per launch; a second instance just focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(buildMenu());
    registerIpc();
    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    ssh?.closeAll();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => ssh?.closeAll());
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  return Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "文件",
      submenu: [
        { label: "锁定密钥库", click: () => vault?.lock() },
        { type: "separator" },
        isMac ? { role: "close", label: "关闭窗口" } : { role: "quit", label: "退出" },
      ],
    },
    { label: "编辑", role: "editMenu" },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新载入" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "项目主页",
          click: () => shell.openExternal("https://github.com/Songwo/nanpad"),
        },
      ],
    },
  ]);
}
