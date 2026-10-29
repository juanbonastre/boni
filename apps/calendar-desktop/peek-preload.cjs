// The note peek's page (Boni's, loaded from Boni's server): it says when it listens, asks to be put away or to open
// the note in Boni's desktop app, and is sent the note to show (its record's id, or null when the peek goes away) or a
// proposal of the inbox (its id: one drawn in the calendar, to accept or reject).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("boniEmbed", {
  ready: () => ipcRenderer.send("peek:ready"),
  hide: () => ipcRenderer.send("peek:hide"),
  openInBoni: (id) => ipcRenderer.send("peek:open-in-boni", String(id)),
  onNote: (cb) => ipcRenderer.on("peek:note", (_e, id) => cb(typeof id === "string" ? id : null)),
  onProposal: (cb) => ipcRenderer.on("peek:proposal", (_e, id) => typeof id === "string" && cb(id)),
});
