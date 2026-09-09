const { contextBridge, ipcRenderer } = require("electron");

/**
 * The only surface the renderer gets.
 *
 * Nothing here takes a channel name from the caller, so the page cannot reach
 * an IPC route this file does not name. Every `invoke` returns the main
 * process's `{ok, data|error}` envelope; `unwrap` turns a failure into a thrown
 * Error so callers can just use try/catch.
 */
async function unwrap(promise) {
  const res = await promise;
  if (!res) throw new Error("主进程没有响应");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** Subscribe to a push channel and hand back the unsubscribe. */
function on(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("sinan", {
  isDesktop: true,
  mailboxes: {
    check: (id) => unwrap(ipcRenderer.invoke("mailboxes:check", id)),
    validate: (connection) => unwrap(ipcRenderer.invoke("mailboxes:validate", connection)),
  },
  mailPush: {
    config: () => unwrap(ipcRenderer.invoke("mail-push:config")),
    save: (input) => unwrap(ipcRenderer.invoke("mail-push:save", input)),
    test: () => unwrap(ipcRenderer.invoke("mail-push:test")),
  },
  aiAccounts: {
    list: () => unwrap(ipcRenderer.invoke("ai-accounts:list")),
    start: (provider) => unwrap(ipcRenderer.invoke("ai-accounts:start", provider)),
    status: (id) => unwrap(ipcRenderer.invoke("ai-accounts:status", id)),
    finish: (id, code) => unwrap(ipcRenderer.invoke("ai-accounts:finish", id, code)),
    cancel: (id) => unwrap(ipcRenderer.invoke("ai-accounts:cancel", id)),
    refresh: (id) => unwrap(ipcRenderer.invoke("ai-accounts:refresh", id)),
    remove: (id) => unwrap(ipcRenderer.invoke("ai-accounts:remove", id)),
  },
  profile: {
    get: () => unwrap(ipcRenderer.invoke("profile:get")),
    save: (value) => unwrap(ipcRenderer.invoke("profile:save", value)),
  },
  agent: {
    config: () => unwrap(ipcRenderer.invoke("agent:config")),
    saveConfig: (config) => unwrap(ipcRenderer.invoke("agent:save-config", config)),
    models: () => unwrap(ipcRenderer.invoke("agent:models")),
    test: () => unwrap(ipcRenderer.invoke("agent:test")),
    run: (request) => unwrap(ipcRenderer.invoke("agent:run", request)),
    cancel: (id) => unwrap(ipcRenderer.invoke("agent:cancel", id)),
    knowledge: () => unwrap(ipcRenderer.invoke("agent:knowledge")),
    rebuild: () => unwrap(ipcRenderer.invoke("agent:rebuild")),
    importDocument: () => unwrap(ipcRenderer.invoke("agent:import-document")),
    removeDocument: (id) => unwrap(ipcRenderer.invoke("agent:remove-document", id)),
    onEvent: (handler) => on("agent:event", handler),
  },

  info: () => unwrap(ipcRenderer.invoke("app:info")),
  checkUpdate: () => unwrap(ipcRenderer.invoke("app:check-update")),
  openDataDir: () => unwrap(ipcRenderer.invoke("shell:open-path", "userData")),
  openExternal: (url) => unwrap(ipcRenderer.invoke("shell:open-external", url)),
  pickJson: () => unwrap(ipcRenderer.invoke("dialog:pick-json")),
  preferences: {
    get: () => unwrap(ipcRenderer.invoke("preferences:get")),
    set: (patch) => unwrap(ipcRenderer.invoke("preferences:set", patch)),
  },
  onAttention: (handler) => on("app:attention", handler),
  onVaultChanged: (handler) => on("vault:changed", handler),
  metrics: {
    list: (id, since) => unwrap(ipcRenderer.invoke("metrics:list", id, since)),
    onUpdated: (handler) => on("metrics:updated", handler),
    onError: (handler) => on("metrics:error", handler),
  },
  sftp: {
    list: (id, path) => unwrap(ipcRenderer.invoke("sftp:list", id, path)),
    download: (id, path) => unwrap(ipcRenderer.invoke("sftp:download", id, path)),
  },

  store: {
    addDemo: () => unwrap(ipcRenderer.invoke("store:add-demo")),
    load: () => unwrap(ipcRenderer.invoke("store:load")),
    save: (snapshot) => unwrap(ipcRenderer.invoke("store:save", snapshot)),
    loadConversations: () => unwrap(ipcRenderer.invoke("store:load-conversations")),
    saveConversations: (value) => unwrap(ipcRenderer.invoke("store:save-conversations", value)),
  },

  vault: {
    status: () => unwrap(ipcRenderer.invoke("vault:status")),
    create: (master) => unwrap(ipcRenderer.invoke("vault:create", master)),
    unlock: (master) => unwrap(ipcRenderer.invoke("vault:unlock", master)),
    lock: () => unwrap(ipcRenderer.invoke("vault:lock")),
    changePassword: (oldMaster, newMaster) =>
      unwrap(ipcRenderer.invoke("vault:change-password", oldMaster, newMaster)),
    set: (id, secret) => unwrap(ipcRenderer.invoke("vault:set", id, secret)),
    get: (id) => unwrap(ipcRenderer.invoke("vault:get", id)),
    remove: (id) => unwrap(ipcRenderer.invoke("vault:remove", id)),
    list: () => unwrap(ipcRenderer.invoke("vault:list")),
  },

  ssh: {
    open: (target, size) => unwrap(ipcRenderer.invoke("ssh:open", target, size)),
    probe: (target) => unwrap(ipcRenderer.invoke("ssh:probe", target)),
    test: (target, credential) => unwrap(ipcRenderer.invoke("ssh:test", target, credential)),
    close: (sessionId) => unwrap(ipcRenderer.invoke("ssh:close", sessionId)),
    write: (sessionId, data) => ipcRenderer.send("ssh:write", sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.send("ssh:resize", sessionId, cols, rows),
    onData: (handler) => on("ssh:data", handler),
    onExit: (handler) => on("ssh:exit", handler),
  },

  win: {
    state: () => unwrap(ipcRenderer.invoke("window:state")),
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    onMaximized: (handler) => on("window:maximized", handler),
  },

  mail: {
    providers: () => unwrap(ipcRenderer.invoke("mail:providers")),
    guess: (address) => unwrap(ipcRenderer.invoke("mail:guess", address)),
    test: (options) => unwrap(ipcRenderer.invoke("mail:test", options)),
    oauthProviders: () => unwrap(ipcRenderer.invoke("mail:oauth-providers")),
    oauthSignIn: (options) => unwrap(ipcRenderer.invoke("mail:oauth-sign-in", options)),
  },

  domain: {
    probe: (name) => unwrap(ipcRenderer.invoke("domain:probe", name)),
  },

  cert: {
    probe: (host, port, servername) =>
      unwrap(ipcRenderer.invoke("cert:probe", host, port, servername)),
    parsePem: (pem) => unwrap(ipcRenderer.invoke("cert:parse-pem", pem)),
  },
});
