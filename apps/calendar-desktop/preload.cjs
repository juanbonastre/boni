/**
 * What Boni Calendar's page may ask of the desktop shell, and nothing else: downloads, notifications, the desktop's
 * settings, the benchmark's results and where an event's note opens (`boniNotes`).
 */
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

// Where an event's note opens: Boni's desktop app (or its peek). Every call resolves to { ok: true, value } or
// { ok: false, code, message }.
contextBridge.exposeInMainWorld("boniNotes", {
  openNote: (path, opts) => ipcRenderer.invoke("notes:open-note", path, opts?.peek === true),
  openProposal: (id) => ipcRenderer.invoke("notes:open-proposal", id),
  noteApp: "boni",
});
