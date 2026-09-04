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

  info: () => unwrap(ipcRenderer.invoke("app:info")),
  openExternal: (url) => unwrap(ipcRenderer.invoke("shell:open-external", url)),

  store: {
    load: () => unwrap(ipcRenderer.invoke("store:load")),
    save: (snapshot) => unwrap(ipcRenderer.invoke("store:save", snapshot)),
  },

  vault: {
    status: () => unwrap(ipcRenderer.invoke("vault:status")),
    create: (master) => unwrap(ipcRenderer.invoke("vault:create", master)),
    unlock: (master) => unwrap(ipcRenderer.invoke("vault:unlock", master)),
    lock: () => unwrap(ipcRenderer.invoke("vault:lock")),
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

  domain: {
    probe: (name) => unwrap(ipcRenderer.invoke("domain:probe", name)),
  },

  cert: {
    probe: (host, port, servername) => unwrap(ipcRenderer.invoke("cert:probe", host, port, servername)),
  },
});
