import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  Menu,
  net,
  Tray,
  nativeImage,
  Notification,
  safeStorage,
} from "electron";
import { X509Certificate } from "node:crypto";
import { CaptureQueue } from "./services/browser-capture.mjs";
import { readFileSync } from "node:fs";
import { readFile, writeFile, rename, mkdir, stat } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { SshManager } from "./services/ssh.mjs";
import { probeCertificate, probeDomain } from "./services/net-probe.mjs";
import { MAIL_PROVIDERS, providerForAddress, testMailbox } from "./services/mail.mjs";
import { MailboxService, validateMailboxConnection } from "./services/mailbox-service.mjs";
import { MailPushService } from "./services/mail-push.mjs";
import { MailClient, validateSmtp } from "./services/mail-client.mjs";
import { OAUTH_PROVIDERS, signIn as oauthSignIn } from "./services/oauth.mjs";
import { Vault, vaultPath } from "./services/vault.mjs";
import { MetricsStore } from "./services/metrics.mjs";
import { notificationCandidates, NotificationTracker } from "./services/notifications.mjs";
import { AgentService } from "./services/agent-service.mjs";
import { ProfileService } from "./services/profile.mjs";
import { createImageNormalizer, normalizeSnapshotImages } from "./services/image-data.mjs";
import { AiAccounts } from "./services/ai-accounts.mjs";
import { mergeDemo, DEMO_KNOWLEDGE } from "./services/demo.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const normalizeImage = createImageNormalizer(nativeImage);

// Launched as `electron electron/main.mjs` there is no package.json beside the
// entry, so Electron would call itself "Electron" and put the user's assets in
// a directory named after the runtime. Pin it before anything reads a path.
app.setName("Nanpad");
// 桌面集成测试使用独立目录，避免读取或覆盖用户的资产与密钥库。
if (!app.isPackaged && process.env.NANPAD_TEST_DATA_DIR)
  app.setPath("userData", process.env.NANPAD_TEST_DATA_DIR);

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
let metrics;
let agent;
let aiAccounts;
let mailboxes;
let mailClient;
let mailPush;
let tray = null;
let quitting = false;
let notificationTimer;
let mailPushTimer;
let currentSnapshot = {};
let preferences = { closeToTray: true, notifications: true, locale: "zh" };
const tracker = new NotificationTracker();
const writes = new Map();
const captures = new CaptureQueue();
function acceptCapture(argv) {
  for (const value of argv) {
    if (captures.add(value)) emit("capture:changed", {});
  }
}
acceptCapture(process.argv);
app.on("open-url", (event, url) => {
  event.preventDefault();
  acceptCapture([url]);
  showWindow();
});
let preferenceWrites = Promise.resolve();

function stopPrivateTasks() {
  mailPush?.stop();
  mailboxes?.stop();
  mailClient?.stop();
  agent?.close();
}

function lockVault() {
  stopPrivateTasks();
  const result = vault?.lock();
  emit("vault:changed", {});
  return result;
}

function assertPublicVaultRecord(id) {
  if (typeof id !== "string" || !id) throw new Error("凭据标识不正确。");
  if (id === "notification:mail-push") {
    throw new Error("请通过邮件推送设置管理此凭据。");
  }
  if (id.startsWith("mail-draft:")) throw new Error("请通过写信窗口管理邮件草稿。");
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function notifyAttention() {
  if (!preferences.notifications || !Notification.isSupported()) return;
  const items = tracker.take(notificationCandidates(currentSnapshot));
  if (!items.length) return;
  const en = preferences.locale === "en";
  const notification = new Notification({
    title: en ? "Nanpad: assets need attention" : "司南：资产需要留意",
    body: items
      .slice(0, 5)
      .map(
        (item) =>
          `${item.name}: ${item.reason === "offline" ? (en ? "Connection failed" : "连接失败") : item.days <= 0 ? (en ? "Expired" : "已到期") : en ? `Expires in ${item.days} days` : `${item.days} 天后到期`}`,
      )
      .join("\n"),
  });
  notification.on("click", () => {
    showWindow();
    emit("app:attention", { kind: items[0].kind, id: items[0].id });
  });
  notification.show();
}

function updateTray() {
  if (!tray) return;
  const en = preferences.locale === "en";
  tray.setToolTip("Nanpad");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: en ? "Open Nanpad" : "打开司南", click: showWindow },
      {
        label: en ? "Lock vault" : "锁定密钥库",
        click: lockVault,
      },
      { type: "separator" },
      { label: en ? "Quit" : "退出", click: () => app.quit() },
    ]),
  );
}

function savedServer(id) {
  const server = currentSnapshot.servers?.find((x) => x.id === id);
  if (!server) throw new Error("Server no longer exists");
  if (server.demo) throw new Error("演示主机不允许进行真实连接。");
  return { id: server.id, host: server.host, port: server.port, username: server.username };
}

function dataFile() {
  return join(app.getPath("userData"), "assets.json");
}

function conversationsFile() {
  return join(app.getPath("userData"), "conversations.json");
}

/** Write JSON without ever leaving a half-written file behind. */
function writeJson(file, value) {
  const content = JSON.stringify(value, null, 2);
  const task = (writes.get(file) ?? Promise.resolve()).then(async () => {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, file);
    return true;
  });
  writes.set(
    file,
    task.catch(() => {}),
  );
  return task;
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: "#f4f5f5",
    // electron-builder stamps the icon into the packaged exe, but a dev window
    // would otherwise sit in the taskbar wearing Electron's own atom.
    icon: app.isPackaged
      ? join(process.resourcesPath, "icon.png")
      : join(here, "../build/icon.png"),
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
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => {
    if (!process.env.NANPAD_TEST_DATA_DIR) win?.show();
  });
  win.on("close", (event) => {
    if (!quitting && preferences.closeToTray && tray) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    win = null;
  });

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
  handle("capture:list", () => captures.list());
  handle("capture:discard", (id) => {
    captures.discard(id);
  });
  vault = new Vault(vaultPath(app.getPath("userData")));
  const profile = new ProfileService(
    join(app.getPath("userData"), "profile.json"),
    vault,
    normalizeImage,
  );
  handle("profile:get", () => profile.get());
  handle("profile:save", (value) => profile.save(value));
  aiAccounts = new AiAccounts({
    vault,
    openExternal: (url) => shell.openExternal(url),
    fetchImpl: (...args) => net.fetch(...args),
  });
  handle("ai-accounts:list", () => aiAccounts.list());
  handle("ai-accounts:start", (provider) => aiAccounts.start(provider));
  handle("ai-accounts:status", (id) => aiAccounts.status(id));
  handle("ai-accounts:finish", (id, code) => aiAccounts.finish(id, code));
  handle("ai-accounts:cancel", (id) => aiAccounts.cancel(id));
  handle("ai-accounts:refresh", (id) => aiAccounts.refresh(id));
  handle("ai-accounts:remove", (id) => aiAccounts.remove(id));
  app.once("before-quit", () => aiAccounts.stop());
  ssh = new SshManager(emit);
  metrics = new MetricsStore(join(app.getPath("userData"), "metrics.json"));
  mailboxes = new MailboxService({
    directory: app.getPath("userData"),
    vault,
    getSnapshot: () => currentSnapshot,
  });
  mailPush = new MailPushService({
    vault,
    getSnapshot: () => currentSnapshot,
    checkMailbox: (id, options) => mailboxes.check(id, options),
    fetchImpl: (...args) => net.fetch(...args),
  });
  handle("mailboxes:check", (id) => mailboxes.check(id));
  handle("mailboxes:validate", (connection) => validateMailboxConnection(connection));
  mailClient = new MailClient({ vault, getSnapshot: () => currentSnapshot });
  handle("mail-client:folders", (id) => mailClient.folders(id));
  handle("mail-client:messages", (id, options) => mailClient.messages(id, options));
  handle("mail-client:read", (id, selection) => mailClient.read(id, selection));
  handle("mail-client:seen", (id, selection, seen) => mailClient.seen(id, selection, seen));
  handle("mail-client:send", (id, draft) => mailClient.send(id, draft));
  handle("mail-client:draft", (id) => mailClient.draft(id));
  handle("mail-client:save-draft", (id, draft) => mailClient.saveDraft(id, draft));
  handle("mail-client:validate-smtp", (value) => validateSmtp(value));
  handle("mail-client:pick-attachments", async () => {
    if (!vault.unlocked) throw new Error("请先解锁密钥库");
    const selected = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
    });
    if (selected.canceled) return [];
    if (selected.filePaths.length > 5) throw new Error("最多添加 5 个附件");
    const items = [];
    let total = 0;
    for (const path of selected.filePaths) {
      const metadata = await stat(path);
      total += metadata.size;
      if (!metadata.isFile() || total > 8 * 1024 * 1024)
        throw new Error("附件总大小不能超过 8 MiB");
      const content = await readFile(path);
      if (content.length !== metadata.size) throw new Error("附件已变化，请重新选择");
      items.push({ name: path.split(/[\\/]/).pop(), base64: content.toString("base64") });
    }
    if (!vault.unlocked) throw new Error("密钥库已锁定");
    return items;
  });
  handle("mail-client:download", async (id, selection, index) => {
    const attachment = await mailClient.attachment(id, selection, index);
    const target = await dialog.showSaveDialog(win, { defaultPath: attachment.name });
    if (target.canceled || !target.filePath) return false;
    if (!vault.unlocked) throw new Error("密钥库已锁定");
    await writeFile(target.filePath, attachment.content);
    return true;
  });
  handle("mail-push:config", () => mailPush.config());
  handle("mail-push:save", (input) => mailPush.save(input));
  handle("mail-push:test", () => mailPush.test());
  agent = new AgentService({
    directory: app.getPath("userData"),
    secureStorage: safeStorage,
    getSnapshot: () => currentSnapshot,
    checkMailbox: (id, options) => mailboxes.check(id, options),
    emit: (event) => emit("agent:event", event),
  });
  handle("agent:config", () => agent.config());
  handle("agent:save-config", (config) => agent.saveConfig(config));
  handle("agent:models", () => agent.models());
  handle("agent:test", () => agent.test());
  handle("agent:run", (request) => agent.run(request));
  handle("agent:cancel", (id) => agent.cancel(id));
  handle("agent:knowledge", () => agent.knowledge());
  handle("agent:rebuild", () => agent.rebuild());
  handle("agent:remove-document", (id) => agent.removeDocument(id));
  handle("agent:import-document", async () => {
    const selected = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Text / Markdown", extensions: ["txt", "md"] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const file = selected.filePaths[0];
    const { stat } = await import("node:fs/promises");
    if ((await stat(file)).size > 512000) throw new Error("知识文档不能超过 500 KB。");
    return agent.addDocument(file.split(/[\\/]/).pop(), await readFile(file, "utf8"));
  });
  handle("store:add-demo", async () => {
    if (app.isPackaged) throw new Error("生产版本不提供演示数据导入。");
    // 与当前磁盘内容合并；重复导入保留原记录及其修改。
    const saved = JSON.parse(
      await readFile(dataFile(), "utf8").catch((error) => {
        if (error.code === "ENOENT") return "{}";
        throw error;
      }),
    );
    const next = mergeDemo(saved.state ?? saved);
    await agent.addDocument("星桥商城演示运维手册.md", DEMO_KNOWLEDGE);
    await writeJson(dataFile(), { ...saved, state: next, version: saved.version ?? 0 });
    currentSnapshot = next;
    return next;
  });
  handle("preferences:get", () => ({
    ...preferences,
    notificationSupported: Notification.isSupported(),
    trayAvailable: Boolean(tray),
  }));
  handle("preferences:set", (patch) => {
    const task = preferenceWrites.then(async () => {
      const next = { ...preferences };
      if (typeof patch?.closeToTray === "boolean") next.closeToTray = patch.closeToTray;
      if (typeof patch?.notifications === "boolean") next.notifications = patch.notifications;
      if (patch?.locale === "zh" || patch?.locale === "en") next.locale = patch.locale;
      await writeJson(join(app.getPath("userData"), "preferences.json"), next);
      preferences = next;
      updateTray();
      Menu.setApplicationMenu(buildMenu());
      return preferences;
    });
    preferenceWrites = task.catch(() => {});
    return task;
  });
  handle("metrics:list", (id, since) => metrics.list(id, Number.isFinite(since) ? since : 0));
  handle("sftp:list", async (id, path) =>
    ssh.sftp.list(savedServer(id), await vault.get(credentialId(id)), path),
  );
  handle("sftp:download", async (id, path) => {
    const target = savedServer(id);
    const credential = await vault.get(credentialId(id));
    const result = await dialog.showSaveDialog(win, { defaultPath: posix.basename(path) });
    if (result.canceled || !result.filePath) return false;
    return ssh.sftp.download(target, credential, path, result.filePath);
  });

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
      return normalizeSnapshotImages(JSON.parse(await readFile(dataFile(), "utf8")), {
        strict: false,
        normalize: normalizeImage,
      });
    } catch {
      return null;
    }
  });
  handle("store:save", async (snapshot) => {
    const normalized = normalizeSnapshotImages(snapshot, { normalize: normalizeImage });
    const next = normalized?.state ?? normalized ?? {};
    for (const mailbox of next.mailboxes ?? []) {
      if (mailbox.imap) mailbox.imap = validateMailboxConnection(mailbox.imap);
      if (mailbox.smtp) mailbox.smtp = validateSmtp(mailbox.smtp);
    }
    await writeJson(dataFile(), normalized);
    currentSnapshot = next;
    notifyAttention();
    return true;
  });
  handle("store:load-conversations", async () => {
    try {
      return JSON.parse(await readFile(conversationsFile(), "utf8"));
    } catch {
      return null;
    }
  });
  handle("store:save-conversations", (value) => writeJson(conversationsFile(), value));

  // ---- vault --------------------------------------------------------------
  handle("vault:status", () => vault.status());
  handle("vault:create", (master) => vault.create(master));
  handle("vault:unlock", (master) => vault.unlock(master));
  handle("vault:lock", lockVault);
  handle("vault:change-password", (oldMaster, newMaster) =>
    vault.changePassword(oldMaster, newMaster),
  );
  handle("vault:set", (id, secret) => {
    assertPublicVaultRecord(id);
    return vault.set(id, secret);
  });
  handle("vault:get", (id) => {
    assertPublicVaultRecord(id);
    return vault.get(id);
  });
  handle("vault:remove", (id) => {
    assertPublicVaultRecord(id);
    return vault.remove(id);
  });
  handle("vault:list", () => vault.list());

  // ---- ssh ----------------------------------------------------------------
  handle("ssh:open", async (target, size) =>
    ssh.openShell(savedServer(target.id), await vault.get(credentialId(target.id)), size),
  );
  handle("ssh:probe", async (target) => {
    const probe = await ssh.probe(savedServer(target.id), await vault.get(credentialId(target.id)));
    try {
      await metrics.record(target.id, probe);
      emit("metrics:updated", { id: target.id });
    } catch (err) {
      emit("metrics:error", { id: target.id, error: String(err.message) });
    }
    return probe;
  });
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
    return {
      state: "unavailable",
      current,
      page: RELEASES_PAGE,
      reason: "GitHub 接口限流，请稍后再试",
    };
  }
  if (body.status !== 200) {
    return {
      state: "unavailable",
      current,
      page: RELEASES_PAGE,
      reason: `GitHub 返回 ${body.status}`,
    };
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
  const pa = String(a)
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b)
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
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
  app.on("second-instance", (_event, argv) => {
    acceptCapture(argv);
    showWindow();
  });

  app.whenReady().then(async () => {
    if (app.isPackaged && !process.argv.some((arg) => arg.startsWith("--user-data-dir=")))
      app.setAsDefaultProtocolClient("nanpad");
    app.setAppUserModelId("dev.songwo.nanpad");
    try {
      const saved = JSON.parse(
        await readFile(join(app.getPath("userData"), "preferences.json"), "utf8"),
      );
      for (const key of ["closeToTray", "notifications"])
        if (typeof saved[key] === "boolean") preferences[key] = saved[key];
      if (["zh", "en"].includes(saved.locale)) preferences.locale = saved.locale;
    } catch (err) {
      if (err.code !== "ENOENT") console.error("preferences:load", err.message);
    }
    try {
      const saved = JSON.parse(await readFile(dataFile(), "utf8"));
      currentSnapshot = saved?.state ?? saved ?? {};
    } catch (err) {
      if (err.code !== "ENOENT") console.error("assets:load", err.message);
    }
    Menu.setApplicationMenu(buildMenu());
    registerIpc();
    try {
      const icon = nativeImage.createFromPath(
        app.isPackaged ? join(process.resourcesPath, "icon.png") : join(here, "../build/icon.png"),
      );
      tray = new Tray(icon.resize({ width: 20, height: 20 }));
      tray.on("double-click", showWindow);
      tray.on("click", showWindow);
      updateTray();
    } catch (err) {
      console.error("tray:create", err.message);
    }
    await createWindow();
    notificationTimer = setInterval(notifyAttention, 60_000);
    mailPushTimer = setInterval(() => void mailPush.tick(), 60_000);
    notifyAttention();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on("window-all-closed", () => {
    ssh?.closeAll();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    stopPrivateTasks();
    quitting = true;
    clearInterval(notificationTimer);
    clearInterval(mailPushTimer);
    ssh?.closeAll();
    tray?.destroy();
    tray = null;
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const label = (zh, en) => (preferences.locale === "en" ? en : zh);
  return Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: label("文件", "File"),
      submenu: [
        {
          label: label("锁定密钥库", "Lock vault"),
          click: lockVault,
        },
        { type: "separator" },
        isMac
          ? { role: "close", label: label("关闭窗口", "Close window") }
          : { role: "quit", label: label("退出", "Quit") },
      ],
    },
    { label: label("编辑", "Edit"), role: "editMenu" },
    {
      label: label("视图", "View"),
      submenu: [
        { role: "reload", label: label("重新载入", "Reload") },
        { role: "toggleDevTools", label: label("开发者工具", "Developer tools") },
        { type: "separator" },
        { role: "resetZoom", label: label("实际大小", "Actual size") },
        { role: "zoomIn", label: label("放大", "Zoom in") },
        { role: "zoomOut", label: label("缩小", "Zoom out") },
        { type: "separator" },
        { role: "togglefullscreen", label: label("全屏", "Full screen") },
      ],
    },
    {
      label: label("帮助", "Help"),
      submenu: [
        {
          label: label("项目主页", "Project homepage"),
          click: () => shell.openExternal("https://github.com/Songwo/nanpad"),
        },
      ],
    },
  ]);
}
