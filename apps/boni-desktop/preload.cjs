// The bridge between a page and the main process (`window.boniDesktop`, see apps/web/src/host.ts).
const { contextBridge, ipcRenderer, webUtils } = require("electron");

let uploads = 0;

contextBridge.exposeInMainWorld("boniDesktop", {
  request: (method, path, body) => ipcRenderer.invoke("api:request", method, path, body),
  storeRead: (name) => ipcRenderer.invoke("store:read", name),
  storeWrite: (name, text) => ipcRenderer.invoke("store:write", name, text),
  storeRemove: (name) => ipcRenderer.invoke("store:remove", name),
  // Synchronous: done before the window goes on closing (task 100).
  keepUnsent: (text) => ipcRenderer.sendSync("unsent:keep", text),
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
  openUrl: (url) => ipcRenderer.invoke("url:open", url),
  // A file the user dropped (A-24): its place on disk is read here, never from the page; the main process sends it.
  uploadFile: async (file, onProgress) => {
    const at = webUtils.getPathForFile(file);
    if (!at) return { error: "unreadable" };
    const id = `u${++uploads}`;
    const listener = (_e, of, sent, size) => {
      if (of === id) onProgress(sent, size);
    };
    ipcRenderer.on("file:upload-progress", listener);
    try {
      return await ipcRenderer.invoke("file:upload", id, at, file.name);
    } finally {
      ipcRenderer.removeListener("file:upload-progress", listener);
    }
  },
  peekHide: () => ipcRenderer.send("shell:peek-hide"),
  openPeek: (screen) => ipcRenderer.send("shell:open-peek", screen),
  pageReady: () => ipcRenderer.send("shell:page-ready"),
});
