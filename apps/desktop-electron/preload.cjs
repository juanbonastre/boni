const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hostBridge", {
  saveBench: (json) => ipcRenderer.send("save-bench", json),
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
});
