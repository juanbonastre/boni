// Electron shell for Boni Calendar: loads the built web UI and remembers the window size.
// Env vars (benchmark only):
//   BONI_START_QUERY  query string appended to the page URL, e.g. "bench=auto"
//   BONI_BENCH_OUT    file where the benchmark result is written (the app then quits)
//   BONI_SCREENSHOT   file where a PNG of the window is written after load (the app then quits)
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  net,
  screen,
  shell,
  Tray,
} = require("electron");
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { notePath, openVault, VaultError } = require("./vault-fs.cjs");
const { autostartDir, loadPrefs, savePrefs, setAutostart } = require("./desktop-prefs.cjs");

const PACKAGED_UI = path.join(__dirname, "web", "index.html");
const DEV_UI = path.join(__dirname, "..", "calendar-web", "dist", "index.html");
const UI = fs.existsSync(PACKAGED_UI) ? PACKAGED_UI : DEV_UI;

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

function saveState(win) {
  if (win.isDestroyed()) return;
  const bounds = win.getNormalBounds();
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
  } catch {
    // The window state is a convenience; ignore write errors.
  }
}

// ---- running in the background (Settings → Desktop): the tray, closing hides, starting with the session ----
const prefsFile = () => path.join(app.getPath("userData"), "desktop.json");
let prefs = { background: true, autostart: false };
let tray = null;
let quitting = false;
let trayLabels = { open: "Abrir Boni Calendar", quit: "Salir" };

function showWindow() {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) return createWindow(false);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function updateTray() {
  if (!prefs.background) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    const icon = nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 22 });
    tray = new Tray(icon);
    tray.setToolTip("Boni Calendar");
    tray.on("click", showWindow);
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: trayLabels.open, click: showWindow },
      { type: "separator" },
      {
        label: trayLabels.quit,
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

/** The program a session starts: the AppImage when it runs as one, otherwise the installed app. */
const execPath = () => process.env.APPIMAGE || process.execPath;

function applyPrefs(next) {
  prefs = next;
  savePrefs(prefsFile(), prefs);
  setAutostart(autostartDir(), prefs.autostart, execPath());
  updateTray();
}

ipcMain.handle("desktop:get-prefs", () => prefs);
ipcMain.handle("desktop:set-prefs", (_e, patch) => {
  const next = { ...prefs };
  if (typeof patch?.background === "boolean") next.background = patch.background;
  if (typeof patch?.autostart === "boolean") next.autostart = patch.autostart;
  try {
    applyPrefs(next);
    return { ok: true, value: prefs };
  } catch (e) {
    return { ok: false, code: "prefs", message: String(e.message ?? e) };
  }
});
// The tray's menu speaks the app's language (the page tells it).
ipcMain.on("desktop:labels", (_e, labels) => {
  if (typeof labels?.open === "string" && typeof labels?.quit === "string") {
    trayLabels = { open: labels.open, quit: labels.quit };
    updateTray();
  }
});

function createWindow(hidden = false) {
  const bench = Boolean(process.env.BONI_BENCH_OUT || process.env.BONI_SCREENSHOT);
  const saved = bench ? {} : loadState();
  const area = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(saved.width ?? 1440, area.width),
    height: Math.min(saved.height ?? 900, area.height),
    x: saved.x,
    y: saved.y,
    minWidth: 900,
    minHeight: 600,
    title: "Boni Calendar",
    show: !hidden,
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#16171a",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (saved.maximized) win.maximize();
  win.webContents.setVisualZoomLevelLimits(1, 1); // pinch must not zoom the page: Ctrl+wheel zooms the hours
  win.loadFile(UI, { search: process.env.BONI_START_QUERY ?? "" });
  if (process.env.BONI_SCREENSHOT) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(process.env.BONI_SCREENSHOT, image.toPNG());
        app.quit();
      }, 2500);
    });
  }
  if (!bench) {
    win.on("close", (e) => {
      saveState(win);
      // In the background the window only hides: the calendar keeps running for its reminders.
      if (prefs.background && !quitting) {
        e.preventDefault();
        win.hide();
      }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  }
}

// ---- vault (the folder of Markdown notes the calendar reads and writes) ----
const vaultFile = () => path.join(app.getPath("userData"), "vault.json");
let vault = null;
let stopWatching = null;

function useVault(root) {
  stopWatching?.();
  stopWatching = null;
  vault = openVault(root, { trashItem: (p) => shell.trashItem(p) });
  fs.writeFileSync(vaultFile(), JSON.stringify({ root: vault.root }));
  return vault.root;
}

function restoreVault() {
  try {
    vault = openVault(JSON.parse(fs.readFileSync(vaultFile(), "utf8")).root, {
      trashItem: (p) => shell.trashItem(p),
    });
  } catch {
    vault = null; // nothing chosen yet, or the folder is gone
  }
}

const NO_VAULT_NEEDED = new Set(["vault:choose-root", "vault:open-note"]);

/** Handlers answer `{ ok: true, value }` or `{ ok: false, code, message }`; errors never cross IPC as exceptions. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      if (!NO_VAULT_NEEDED.has(channel) && !vault)
        throw new VaultError("no-vault", "No vault chosen");
      return { ok: true, value: await fn.apply({ sender: e.sender }, args) };
    } catch (e) {
      return { ok: false, code: e.code ?? "error", message: String(e.message ?? e) };
    }
  });
}

// External calendars: the page asks, the main process downloads (no cross-origin rules here). Only
// http(s), with a time limit and a size limit; the answer is the text.
const FETCH_LIMIT = 20 * 1024 * 1024;
ipcMain.handle("net:fetch-text", async (_e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol !== "https:" && u.protocol !== "http:")
      throw new Error("Only http(s) addresses");
    const r = await net.fetch(u.href, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (text.length > FETCH_LIMIT) throw new Error("Too large");
    return { ok: true, value: text };
  } catch (e) {
    return { ok: false, code: "fetch", message: String(e.message ?? e) };
  }
});

// Reminders: the page hands over the notices of the next hours; each shows at its time as a system
// notification, and a click brings the window up on that event. A new list replaces the timers.
const noticeTimers = new Map();
const shown = new Set();
ipcMain.on("notify:schedule", (e, list) => {
  for (const t of noticeTimers.values()) clearTimeout(t);
  noticeTimers.clear();
  if (!Array.isArray(list) || !Notification.isSupported()) return;
  const sender = e.sender;
  const now = Date.now();
  for (const n of list.slice(0, 500)) {
    const at = Number(n?.at);
    const id = String(n?.id ?? "");
    // A minute late still shows (the app was busy); already shown ones never twice.
    if (!id || shown.has(id) || !(at > now - 60_000) || at > now + 3 * 86_400_000) continue;
    noticeTimers.set(
      id,
      setTimeout(
        () => {
          noticeTimers.delete(id);
          shown.add(id);
          const note = new Notification({
            title: String(n.title ?? ""),
            body: String(n.body ?? ""),
          });
          note.on("click", () => {
            const win = BrowserWindow.fromWebContents(sender);
            if (win) {
              if (win.isMinimized()) win.restore();
              win.show();
              win.focus();
            }
            if (!sender.isDestroyed()) sender.send("notify:open", String(n.eventId ?? ""));
          });
          note.show();
        },
        Math.max(0, at - now),
      ),
    );
  }
});

handle("vault:get-root", () => vault?.root ?? null);
handle("vault:scan", (dir) => vault.scan(dir));
handle("vault:read", (rel) => vault.read(rel));
handle("vault:write", (rel, text, expectedMtimeMs) => vault.write(rel, text, expectedMtimeMs));
handle("vault:watch", function (dirs) {
  stopWatching?.();
  const sender = this.sender;
  stopWatching = vault.watch(dirs, () => {
    if (sender && !sender.isDestroyed()) sender.send("vault:changed");
  });
  return null;
});
// The cache holds parsed notes so the next start does not parse them again. It lives in userData
// (never in the vault or the repo) and is keyed by the vault folder.
const cacheFile = () =>
  path.join(
    app.getPath("userData"),
    `vault-index-${crypto.createHash("sha1").update(vault.root).digest("hex").slice(0, 12)}.json`,
  );
handle("vault:cache-read", () => {
  try {
    return fs.readFileSync(cacheFile(), "utf8");
  } catch {
    return null;
  }
});
handle("vault:cache-write", (text) => {
  if (typeof text !== "string") throw new VaultError("bad-path", "Bad cache");
  const tmp = `${cacheFile()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, cacheFile());
  return null;
});
handle("vault:rename", (from, to) => vault.rename(from, to));
handle("vault:trash", async (rel) => {
  await vault.trash(rel);
  return null;
});
handle("vault:open-note", (rel) => {
  // In Boni (Juan, 2026-10-22: the notes live in Boni now): its desktop app takes boni://note?path=<the note's
  // vault path> and opens the row that note became. The URL is built here from a checked path, never by the UI.
  void shell.openExternal(`boni://note?path=${encodeURIComponent(notePath(rel).join("/"))}`);
  return null;
});
handle("vault:create", (rel, text) => vault.create(rel, text));
ipcMain.handle("vault:choose-root", async (e) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (r.canceled || !r.filePaths[0]) return { ok: true, value: null };
    return { ok: true, value: useVault(r.filePaths[0]) };
  } catch (err) {
    return { ok: false, code: err.code ?? "error", message: String(err.message ?? err) };
  }
});

ipcMain.on("save-bench", (_e, json) => {
  const out = process.env.BONI_BENCH_OUT;
  if (out) fs.writeFileSync(out, json);
  app.quit();
});

if (
  !process.env.BONI_BENCH_OUT &&
  !process.env.BONI_SCREENSHOT &&
  !app.requestSingleInstanceLock()
) {
  app.quit();
} else {
  // Opening the app again (the menu, the dock) shows the one that runs, also from the tray.
  app.on("second-instance", showWindow);
  app.on("before-quit", () => {
    quitting = true;
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    restoreVault();
    const bench = Boolean(process.env.BONI_BENCH_OUT || process.env.BONI_SCREENSHOT);
    if (!bench) {
      prefs = loadPrefs(prefsFile());
      updateTray();
    }
    // Started with the session: in the tray, the window comes when asked for.
    createWindow(!bench && process.argv.includes("--hidden") && prefs.background);
    app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });
  app.on("window-all-closed", () => {
    if (!prefs.background || quitting) app.quit();
  });
}
