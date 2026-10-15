const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hostBridge", {
  saveBench: (json) => ipcRenderer.send("save-bench", json),
});
