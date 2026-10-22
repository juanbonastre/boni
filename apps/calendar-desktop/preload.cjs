const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hostBridge", {
  saveBench: (json) => ipcRenderer.send("save-bench", json),
});

// Downloads for external calendars (done by the main process).
contextBridge.exposeInMainWorld("boniNet", {
  fetchText: (url) => ipcRenderer.invoke("net:fetch-text", url),
});

// Reminders as system notifications (the main process keeps the timers): a new list replaces the last.
contextBridge.exposeInMainWorld("boniNotify", {
  schedule: (list) => ipcRenderer.send("notify:schedule", list),
  onOpen: (cb) => ipcRenderer.on("notify:open", (_e, eventId) => cb(String(eventId))),
});

// Running in the background (Settings → Desktop): keep running in the tray, start with the session.
contextBridge.exposeInMainWorld("boniDesktop", {
  getPrefs: () => ipcRenderer.invoke("desktop:get-prefs"),
  setPrefs: (patch) => ipcRenderer.invoke("desktop:set-prefs", patch),
  setLabels: (labels) => ipcRenderer.send("desktop:labels", labels),
});

// Notes of the user's vault. Every call resolves to { ok: true, value } or { ok: false, code, message }.
contextBridge.exposeInMainWorld("boniVault", {
  getRoot: () => ipcRenderer.invoke("vault:get-root"),
  chooseRoot: () => ipcRenderer.invoke("vault:choose-root"),
  scan: (dir) => ipcRenderer.invoke("vault:scan", dir),
  read: (path) => ipcRenderer.invoke("vault:read", path),
  write: (path, text, expectedMtimeMs) =>
    ipcRenderer.invoke("vault:write", path, text, expectedMtimeMs),
  create: (path, text) => ipcRenderer.invoke("vault:create", path, text),
  rename: (from, to) => ipcRenderer.invoke("vault:rename", from, to),
  trash: (path) => ipcRenderer.invoke("vault:trash", path),
  openNote: (path) => ipcRenderer.invoke("vault:open-note", path),
  noteApp: "boni",
  watch: (dirs) => ipcRenderer.invoke("vault:watch", dirs),
  onChanged: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("vault:changed", listener);
    return () => ipcRenderer.removeListener("vault:changed", listener);
  },
  cacheRead: () => ipcRenderer.invoke("vault:cache-read"),
  cacheWrite: (text) => ipcRenderer.invoke("vault:cache-write", text),
});
