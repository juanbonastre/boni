// The bridge between a page and the main process (`window.boniDesktop`, see apps/web/src/host.ts).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("boniDesktop", {
  request: (method, path, body) => ipcRenderer.invoke("api:request", method, path, body),
  storeRead: (name) => ipcRenderer.invoke("store:read", name),
  storeWrite: (name, text) => ipcRenderer.invoke("store:write", name, text),
  storeRemove: (name) => ipcRenderer.invoke("store:remove", name),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  login: (form) => ipcRenderer.invoke("account:login", form),
  logout: () => ipcRenderer.invoke("account:logout"),
  suggestedDevice: () => ipcRenderer.invoke("account:suggested-device"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  onEvent: (cb) => {
    const listener = (_e, event) => cb(event);
    ipcRenderer.on("boni:event", listener);
    return () => ipcRenderer.removeListener("boni:event", listener);
  },
  setWidgets: (widgets) => ipcRenderer.send("shell:set-widgets", widgets),
  broadcastRefresh: () => ipcRenderer.send("shell:broadcast-refresh"),
  openMain: (screen) => ipcRenderer.send("shell:open-main", screen),
  setLabels: (labels) => ipcRenderer.send("shell:labels", labels),
  widgetDragStart: (kind) => ipcRenderer.send("widget:drag-start", kind),
  widgetDragMove: () => ipcRenderer.send("widget:drag-move"),
  widgetDragEnd: () => ipcRenderer.send("widget:drag-end"),
  widgetHide: () => ipcRenderer.send("widget:hide"),
  openFile: (sha, name) => ipcRenderer.invoke("file:open", sha, name),
  peekHide: () => ipcRenderer.send("shell:peek-hide"),
  pageReady: () => ipcRenderer.send("shell:page-ready"),
});
