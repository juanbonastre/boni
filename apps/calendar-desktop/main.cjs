// Electron shell for Boni Calendar: loads the built web UI and remembers the window size.
// Env vars (benchmark only):
//   BONI_START_QUERY  query string appended to the page URL, e.g. "bench=auto"
//   BONI_BENCH_OUT    file where the benchmark result is written (the app then quits)
//   BONI_SCREENSHOT   file where a PNG of the window is written after load (the app then quits)
const {
  app,
  BrowserWindow,
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
const path = require("node:path");
const {
  autostartDir,
  boniOrigin,
  loadPrefs,
  savePrefs,
  setAutostart,
} = require("./desktop-prefs.cjs");

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
let prefs = { background: true, autostart: false, boniUrl: "" };
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
  if (patch?.boniUrl !== undefined) {
    const origin = boniOrigin(patch.boniUrl);
    if (origin === null) return { ok: false, code: "boni-url", message: "Bad address" };
    if (origin !== next.boniUrl) dropPeek();
    next.boniUrl = origin;
  }
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
  // A click in the calendar puts Boni's peek away (it stays while Juan works in other apps).
  win.webContents.on("input-event", (_e, input) => {
    if (input.type === "mouseDown") peekClick();
  });
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

// ---- where an event's note opens (Boni's desktop app; the notes themselves live in Boni) ----
class NoteError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}
/** A note's path as the calendar's rows keep it (relative, Markdown, never a dot folder or `..`), or a NoteError. */
function notePath(rel) {
  if (typeof rel !== "string" || rel === "" || path.isAbsolute(rel) || rel.includes("\0"))
    throw new NoteError("bad-path", `Bad path: ${rel}`);
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === ".." || p.startsWith(".")) || !rel.toLowerCase().endsWith(".md"))
    throw new NoteError("bad-path", `Not allowed: ${rel}`);
  return parts;
}

/** Handlers answer `{ ok: true, value }` or `{ ok: false, code, message }`; errors never cross IPC as exceptions. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
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

handle("notes:open-note", (rel, peek) => {
  // The notes live in Boni (Juan, 2026-10-22). Ctrl+click and "Abrir en Boni": Boni's desktop app opens the row a
  // note became (boni://note?path=<the note's path>). A double click: the calendar's own peek, a small window
  // with Boni's note page from Boni's server (Settings → Desktop gives its address); without one, Boni's peek
  // (`&peek=1`). Paths and URLs are built here from a checked path, never by the UI.
  const note = notePath(rel).join("/");
  const link = `boni://note?path=${encodeURIComponent(note)}`;
  if (peek === true && prefs.boniUrl) {
    void showPeek("peek:note", note);
    return null;
  }
  clearTimeout(peekHideTimer);
  if (peek === true) boniPeekOpen = true;
  void shell.openExternal(peek === true ? `${link}&peek=1` : link);
  return null;
});

handle("notes:open-proposal", (id) => {
  // A proposal waiting in Boni's inbox, drawn dashed in the calendar (plan b2): a click shows its page in the peek,
  // where it is accepted or rejected. Its id is checked here; the link is built here.
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id))
    throw new NoteError("bad-path", "Bad proposal");
  if (prefs.boniUrl) {
    void showPeek("peek:proposal", id);
    return null;
  }
  clearTimeout(peekHideTimer);
  boniPeekOpen = true;
  void shell.openExternal(`boni://proposal?id=${encodeURIComponent(id)}&peek=1`);
  return null;
});

// ---------- the note peek (Juan, 2026-10-22: a window of Boni Calendar) ----------
// Made ahead and hidden; it loads `<Boni's address>/boni/?peek=1` (Boni's page, logged in once with its own session,
// kept in its own partition) and is sent the note to show. Only that origin is ever loaded in it; its preload gives
// the page three calls (ready, hide, open in Boni) and the notes. It is the calendar window's child (above it, not
// above other apps) and stays while Juan works in other apps; a click in the calendar, Esc or its × put it away.
let peekWin = null;
let peekReady = null;
function makePeek() {
  if (peekWin && !peekWin.isDestroyed()) return peekReady;
  const origin = prefs.boniUrl;
  peekWin = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 420,
    minHeight: 320,
    show: false,
    frame: false,
    skipTaskbar: true,
    title: "Boni Calendar",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#16171a",
    webPreferences: {
      preload: path.join(__dirname, "peek-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      partition: "persist:boni-peek",
    },
  });
  const contents = peekWin.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (e, url) => {
    let ok = false;
    try {
      ok = new URL(url).origin === origin;
    } catch {}
    if (!ok) e.preventDefault();
  });
  peekWin.on("closed", () => {
    peekWin = null;
    peekReady = null;
  });
  peekReady = new Promise((resolve) => {
    const ready = (e) => {
      if (e.sender !== contents) return;
      ipcMain.removeListener("peek:ready", ready);
      resolve();
    };
    ipcMain.on("peek:ready", ready);
  });
  void peekWin.loadURL(`${origin}/boni/?peek=1`);
  return peekReady;
}
function dropPeek() {
  if (peekWin && !peekWin.isDestroyed()) peekWin.destroy();
  peekWin = null;
  peekReady = null;
}
/** Shows the peek on a note (`peek:note`, its path) or a proposal (`peek:proposal`, its id). */
async function showPeek(channel, value) {
  await makePeek();
  const win = peekWin;
  if (!win) return;
  // Centred on the display where the pointer is (where the double click was).
  const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [w, h] = win.getSize();
  win.setPosition(Math.round(a.x + (a.width - w) / 2), Math.round(a.y + (a.height - h) / 3));
  // Above the calendar's window only (Juan, 2026-10-22: not over other apps' windows): its child.
  const owner = BrowserWindow.getAllWindows().find(
    (x) => x !== win && x.webContents.getURL().startsWith("file:"),
  );
  if (owner && win.getParentWindow() !== owner) win.setParentWindow(owner);
  win.webContents.send(channel, value);
  win.show();
  win.focus();
}
function hidePeek() {
  if (!peekWin || peekWin.isDestroyed() || !peekWin.isVisible()) return;
  peekWin.hide();
  peekWin.webContents.send("peek:note", null);
}
const fromPeek = (e) => !!peekWin && !peekWin.isDestroyed() && e.sender === peekWin.webContents;
ipcMain.on("peek:hide", (e) => fromPeek(e) && hidePeek());
ipcMain.on("peek:open-in-boni", (e, rel) => {
  if (!fromPeek(e)) return;
  try {
    const p = notePath(String(rel)).join("/");
    void shell.openExternal(`boni://note?path=${encodeURIComponent(p)}`);
  } catch {
    // not a note's path: nothing
  }
});

// A click in the calendar puts a peek away: its own at once; Boni's (no address set) by boni://peek?hide=1, a
// moment later so that the click which opens another note (it reaches notes:open-note just after) does not hide it.
let boniPeekOpen = false;
let peekHideTimer = null;
function peekClick() {
  hidePeek();
  if (!boniPeekOpen) return;
  clearTimeout(peekHideTimer);
  peekHideTimer = setTimeout(() => {
    boniPeekOpen = false;
    void shell.openExternal("boni://peek?hide=1");
  }, 250);
}
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
