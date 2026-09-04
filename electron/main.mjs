import { app, BrowserWindow, dialog, ipcMain, shell, Menu, net } from "electron";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SshManager } from "./services/ssh.mjs";
import { probeCertificate, probeDomain } from "./services/net-probe.mjs";
import { MAIL_PROVIDERS, providerForAddress, testMailbox } from "./services/mail.mjs";
import { OAUTH_PROVIDERS, signIn as oauthSignIn } from "./services/oauth.mjs";
import { Vault, vaultPath } from "./services/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// Launched as `electron electron/main.mjs` there is no package.json beside the
// entry, so Electron would call itself "Electron" and put the user's assets in
// a directory named after the runtime. Pin it before anything reads a path.
app.setName("Nanpad");

/**
 * Our version, not Electron's.
 *
 * `app.getVersion()` reads the package.json next to the entry point; launched
 * as `electron electron/main.mjs` there isn't one, and it happily reports the
 * runtime's version instead. Read the real manifest — it ships inside the asar
 * too, so the packaged build takes the same path.
 */
const APP_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(here, "../package.json"), "utf8")).version;
  } catch {
    return app.getVersion();
  }
})();
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
    // The app paints its own chrome. macOS keeps its traffic lights — they are
    // a platform convention people reach for by muscle memory — while Windows
    // and Linux get in-app controls that share the rest of the UI's hover
    // language instead of the OS's grey caption squares.
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 15 } }
      : { frame: false }),
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win?.show());

  // The maximise button has two shapes; keep the renderer in step with reality
  // rather than with what it last asked for.
  const pushMaximized = () => emit("window:maximized", { maximized: Boolean(win?.isMaximized()) });
  win.on("maximize", pushMaximized);
  win.on("unmaximize", pushMaximized);
  win.on("enter-full-screen", pushMaximized);
  win.on("leave-full-screen", pushMaximized);

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
    arch: process.arch,
    version: APP_VERSION,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    userData: app.getPath("userData"),
    packaged: app.isPackaged,
  }));

  handle("app:check-update", () => checkForUpdate(APP_VERSION));
  handle("shell:open-path", async (target) => {
    const allowed = app.getPath("userData");
    // Only ever open our own data directory — never a path the page chose.
    if (target !== "userData") throw new Error("不允许打开该路径");
    const err = await shell.openPath(allowed);
    if (err) throw new Error(err);
    return true;
  });

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
  handle("vault:change-password", (oldMaster, newMaster) =>
    vault.changePassword(oldMaster, newMaster),
  );
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

  // ---- mailboxes ----------------------------------------------------------
  handle("mail:providers", async () => MAIL_PROVIDERS);
  handle("mail:guess", async (address) => providerForAddress(address));
  handle("mail:test", (options) => testMailbox(options));
  handle("mail:oauth-providers", async () =>
    Object.fromEntries(
      Object.entries(OAUTH_PROVIDERS).map(([id, p]) => [
        id,
        {
          label: p.label,
          usesSecret: p.usesSecret,
          scopes: p.scopes,
          consoleUrl: p.consoleUrl,
          setupNote: p.setupNote,
        },
      ]),
    ),
  );
  handle("mail:oauth-sign-in", (options) => oauthSignIn(options));
  // Google hands you a client_secret_*.json; reading it beats retyping two
  // opaque strings, and the values never touch the renderer's disk.
  handle("dialog:pick-json", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "选择 OAuth 客户端 JSON",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return JSON.parse(await readFile(result.filePaths[0], "utf8"));
  });

  // ---- network probes -----------------------------------------------------
  handle("domain:probe", (name) => probeDomain(name));
  handle("cert:probe", (host, port, servername) => probeCertificate(host, port, servername));
  handle("cert:parse-pem", async (pem) => {
    const cert = new X509Certificate(pem);
    // X509Certificate hands back an RFC 2253 string; pull the two fields the
    // cards actually show rather than parsing the whole DN.
    const field = (dn, key) => new RegExp(`${key}=([^,\\r\\n]+)`).exec(dn)?.[1]?.trim();
    const cn = field(cert.subject, "CN");
    const issuer = field(cert.issuer, "O") ?? field(cert.issuer, "CN");
    return {
      cn: cn ?? "",
      issuer: issuer ?? "",
      validFrom: new Date(cert.validFrom).toISOString(),
      expiresAt: new Date(cert.validTo).toISOString(),
      sans: (cert.subjectAltName ?? "")
        .split(",")
        .map((s) => s.trim().replace(/^DNS:/, ""))
        .filter(Boolean),
      serial: cert.serialNumber,
    };
  });

  // ---- window controls ----------------------------------------------------
  handle("window:state", async () => ({
    maximized: Boolean(win?.isMaximized()),
    platform: process.platform,
  }));
  ipcMain.on("window:minimize", () => win?.minimize());
  ipcMain.on("window:close", () => win?.close());
  ipcMain.on("window:toggle-maximize", () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  handle("shell:open-external", async (url) => {
    if (!/^https?:\/\//.test(url)) throw new Error("只允许打开 http(s) 链接");
    await shell.openExternal(url);
    return true;
  });
}

export const credentialId = (serverId) => `ssh:${serverId}`;

const RELEASES_API = "https://api.github.com/repos/Songwo/nanpad/releases/latest";
const RELEASES_PAGE = "https://github.com/Songwo/nanpad/releases";

/**
 * Ask GitHub what the newest release is.
 *
 * Uses Electron's `net` rather than `fetch` so it follows the system proxy —
 * on a machine behind a corporate or local proxy, a bare fetch would just time
 * out. A private repository answers 404 to an unauthenticated request, which is
 * reported as "cannot check", not as "up to date".
 */
async function checkForUpdate(current) {
  const body = await new Promise((resolve, reject) => {
    const request = net.request({ url: RELEASES_API, method: "GET" });
    request.setHeader("accept", "application/vnd.github+json");
    request.setHeader("user-agent", `Nanpad/${current}`);
    let text = "";
    request.on("response", (response) => {
      response.on("data", (chunk) => (text += chunk.toString("utf8")));
      response.on("end", () => resolve({ status: response.statusCode, text }));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
    setTimeout(() => reject(new Error("检查更新超时，请确认网络可达 GitHub")), 8_000);
  });

  if (body.status === 404) {
    return { state: "unavailable", current, page: RELEASES_PAGE, reason: "仓库为私有或尚无发布" };
  }
  if (body.status === 403) {
    return { state: "unavailable", current, page: RELEASES_PAGE, reason: "GitHub 接口限流，请稍后再试" };
  }
  if (body.status !== 200) {
    return { state: "unavailable", current, page: RELEASES_PAGE, reason: `GitHub 返回 ${body.status}` };
  }

  const tag = String(JSON.parse(body.text)?.tag_name ?? "").replace(/^v/, "");
  if (!tag) {
    return { state: "unavailable", current, page: RELEASES_PAGE, reason: "最新发布没有版本号" };
  }
  return {
    state: compareVersions(tag, current) > 0 ? "outdated" : "current",
    current,
    latest: tag,
    page: RELEASES_PAGE,
  };
}

/** Numeric-segment compare; enough for the `major.minor.patch` tags we cut. */
function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

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
