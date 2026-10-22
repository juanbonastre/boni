// Electron shell for Boni (same architecture as Boni Calendar's): the built web UI in a main window and in one
// small window per desktop widget, a tray icon, start at login. The main process owns the settings (with the
// device token), the files in ~/.local/share/boni and every request to the server (the API has no CORS, and the
// token never reaches a page). Pages ask through preload.cjs (`window.boniDesktop`).
//
// Env vars (tests): BONI_SCREENSHOT=<file> writes a PNG of the main window after load and quits.
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  net,
  screen,
  shell,
  Tray,
} = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { allowedPath } = require("./paths.cjs");
const F = require("./files.cjs");
const { linkIn, screenOfUrl } = require("./links.cjs");
const { createLive } = require("./live.cjs");
const S = require("./settings.cjs");
const W = require("./widgets.cjs");
const autostart = require("./autostart.cjs");

const PACKAGED_UI = path.join(__dirname, "web", "index.html");
const DEV_UI = path.join(__dirname, "..", "boni-web", "dist", "index.html");
const UI = fs.existsSync(PACKAGED_UI) ? PACKAGED_UI : DEV_UI;
const ICON = path.join(__dirname, "icon.png");

const P = S.paths();
let settings = S.loadSettings(P.settings);
// Chromium's own controls (date fields) follow the app's language: 17/10/2026, not 10/17/2026.
app.commandLine.appendSwitch("lang", settings.language === "en" ? "en-GB" : "es-ES");
let widgetList = [];
let mainWindow = null;
let tray = null;
let quitting = false;
let labels = {
  open: "Abrir Boni",
  capture: "Apuntar gasto",
  charts: "Gráficas y widgets",
  widgets: "Mostrar widgets",
  autostart: "Abrir al iniciar sesión",
  refresh: "Actualizar",
  settings: "Ajustes",
  quit: "Salir",
};
const widgetWindows = new Map(); // widget id -> { win, widget }
let lastShown = "";
const layer = W.layerTool();

// ---------- log: a small file to understand what happened on this computer (never the token) ----------
function log(msg) {
  try {
    fs.mkdirSync(P.data, { recursive: true });
    if (fs.existsSync(P.log) && fs.statSync(P.log).size > 200_000) {
      const lines = fs.readFileSync(P.log, "utf8").split("\n");
      fs.writeFileSync(P.log, `${lines.slice(-500).join("\n")}\n`);
    }
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
    fs.appendFileSync(P.log, `${local.replace("T", " ")} ${msg}\n`);
  } catch {
    // logging is best effort
  }
}

function save() {
  S.saveSettings(P.settings, settings);
}

/** The program a session starts: the AppImage when it runs as one, otherwise the installed app. */
const execPath = () => process.env.APPIMAGE || process.execPath;
const packaged = () => app.isPackaged;

let sessionEnded = false;
let liveUnsupported = false; // a server from before live changes (0.2.x)

function clientSettings() {
  return S.clientView(settings, {
    autostart: autostart.isOn(P.autostart),
    layerAvailable: Boolean(layer),
    live: live.live,
    liveUnsupported,
    sessionEnded,
  });
}

function broadcast(event, except) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents !== except) w.webContents.send("boni:event", event);
  }
}

// ---------- the server's live changes: one connection for every window ----------
const live = createLive({
  fetch: (url, init) => net.fetch(url, init),
  target: () =>
    settings.serverUrl && settings.token
      ? { serverUrl: settings.serverUrl, token: settings.token }
      : null,
  onChange: (what) => {
    if (what === "unsupported" || (what === "all" && liveUnsupported)) {
      liveUnsupported = what === "unsupported";
      broadcast({ type: "settings", settings: clientSettings() });
      if (what === "unsupported") return;
    }
    if (what === "session") {
      sessionEnded = true;
      broadcast({ type: "settings", settings: clientSettings() });
      return;
    }
    broadcast({ type: "changed", what });
  },
  onState: () => broadcast({ type: "settings", settings: clientSettings() }),
  log,
});

// ---------- main window (its size and place are remembered, as Boni Calendar's) ----------
const windowStateFile = () => path.join(P.config, "window-state.json");

function windowState() {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = readJson(windowStateFile()) ?? {};
  const width = Math.min(Number(saved.width) || 1440, area.width);
  const height = Math.min(Number(saved.height) || 900, area.height);
  const fits =
    Number.isFinite(saved.x) && Number.isFinite(saved.y) && onScreen({ x: saved.x, y: saved.y });
  return {
    width,
    height,
    ...(fits ? { x: saved.x, y: saved.y } : {}),
    maximized: Boolean(saved.maximized),
  };
}

function saveWindowState(win) {
  if (win.isDestroyed()) return;
  try {
    fs.mkdirSync(P.config, { recursive: true });
    fs.writeFileSync(
      windowStateFile(),
      JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }),
    );
  } catch {
    // a convenience: ignore write errors
  }
}

function openMain(screenId) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    const state = windowState();
    mainWindow = new BrowserWindow({
      width: state.width,
      height: state.height,
      ...(state.x !== undefined ? { x: state.x, y: state.y } : {}),
      minWidth: 640,
      minHeight: 480,
      title: "Boni",
      icon: ICON,
      backgroundColor: "#16171a",
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        sandbox: true,
      },
    });
    if (state.maximized) mainWindow.maximize();
    mainWindow.loadFile(UI);
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const win = mainWindow;
    win.on("close", () => saveWindowState(win));
    mainWindow.once("ready-to-show", () => mainWindow?.show());
    // Closing the window frees it; Boni goes on in the tray with its widgets.
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
    if (screenId) {
      mainWindow.webContents.once("did-finish-load", () =>
        mainWindow?.webContents.send("boni:event", { type: "navigate", screen: screenId }),
      );
    }
    if (process.env.BONI_SCREENSHOT) {
      mainWindow.webContents.once("did-finish-load", () =>
        setTimeout(async () => {
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(process.env.BONI_SCREENSHOT, image.toPNG());
          quitting = true;
          app.quit();
        }, 2500),
      );
    }
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (screenId) mainWindow.webContents.send("boni:event", { type: "navigate", screen: screenId });
}

// ---------- the peek: a note opened from another app, in a small window gone when it loses the focus ----------
let peekWindow = null;
let peekReady = null;
function makePeek() {
  if (peekWindow && !peekWindow.isDestroyed()) return peekReady;
  peekWindow = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 420,
    minHeight: 320,
    show: false,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: "Boni",
    icon: ICON,
    backgroundColor: "#16171a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  peekWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // Losing the focus (a click anywhere else) puts it away, ready for the next note.
  peekWindow.on("blur", () => hidePeek());
  peekWindow.on("closed", () => {
    peekWindow = null;
    peekReady = null;
  });
  // Ready when its page listens (it says so after starting), not when it has loaded: an event sent before
  // would be lost.
  const contents = peekWindow.webContents;
  peekReady = new Promise((resolve) => {
    const ready = (e) => {
      if (e.sender !== contents) return;
      ipcMain.removeListener("shell:peek-ready", ready);
      resolve();
    };
    ipcMain.on("shell:peek-ready", ready);
  });
  peekWindow.loadFile(UI, { query: { peek: "1" } });
  return peekReady;
}
function hidePeek() {
  if (!peekWindow || peekWindow.isDestroyed() || !peekWindow.isVisible()) return;
  peekWindow.hide();
  peekWindow.webContents.send("boni:event", { type: "navigate", screen: "blank" });
}
async function openPeek(screenId) {
  await makePeek();
  const win = peekWindow;
  if (!win) return;
  // Centred on the display where the pointer is (where the click in the other app was).
  const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [w, h] = win.getSize();
  win.setPosition(Math.round(a.x + (a.width - w) / 2), Math.round(a.y + (a.height - h) / 3));
  win.webContents.send("boni:event", { type: "navigate", screen: screenId });
  win.show();
  win.focus();
}
ipcMain.on("shell:peek-hide", () => hidePeek());

// ---------- widget windows ----------
function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

function onScreen(p) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      p.x + 40 > a.x && p.y + 20 > a.y && p.x < a.x + a.width - 40 && p.y < a.y + a.height - 20
    );
  });
}

function widgetUrl(widget) {
  return { query: { widget: widget.id, chart: widget.chart_id } };
}

function createWidgetWindow(widget, place) {
  const win = new BrowserWindow({
    x: place.x,
    y: place.y,
    width: place.width,
    height: place.height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    // Resizable, with limits: a non-resizable window gets min = max = its size in the X11 hints at every setSize,
    // so it could grow but never shrink. A frameless dock window has no edges the window manager would resize.
    resizable: true,
    minWidth: W.MIN.width,
    minHeight: W.MIN.height,
    maxWidth: W.MAX.width,
    maxHeight: W.MAX.height,
    skipTaskbar: true,
    show: false,
    title: `boni-widget-${widget.id}`,
    icon: ICON,
    ...(layer ? { type: "dock" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: true,
    },
  });
  win.loadFile(UI, widgetUrl(widget));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.once("ready-to-show", () => {
    win.setVisibleOnAllWorkspaces(true);
    win.showInactive();
    if (layer) W.keepBelow(layer, win.getNativeWindowHandle().readUInt32LE(0), log);
  });
  win.on("closed", () => {
    const entry = widgetWindows.get(widget.id);
    if (entry?.win === win) widgetWindows.delete(widget.id);
  });
  return win;
}

/** Opens, updates and closes widget windows so they match the list and the settings. */
function reconcileWidgets() {
  const visible = W.visibleWidgets(widgetList, settings);
  const keep = new Set(visible.map((w) => w.id));
  for (const [id, entry] of widgetWindows) {
    if (!keep.has(id)) {
      entry.win.destroy();
      widgetWindows.delete(id);
    }
  }
  visible.forEach((widget, i) => {
    const place = W.placementFor(widget, i, settings.widgets[widget.id], workArea(), onScreen);
    const entry = widgetWindows.get(widget.id);
    if (!entry) {
      widgetWindows.set(widget.id, { win: createWidgetWindow(widget, place), widget });
      return;
    }
    if (entry.widget.chart_id !== widget.chart_id) entry.win.loadFile(UI, widgetUrl(widget));
    if (entry.widget.size !== widget.size) entry.win.setBounds(place);
    entry.widget = widget;
  });
  const shown = visible.map((w) => w.id).join(", ") || "none";
  if (shown !== lastShown) log(`widgets: ${shown}`);
  lastShown = shown;
}

function widgetOf(sender) {
  for (const [id, entry] of widgetWindows)
    if (entry.win.webContents === sender) return { id, ...entry };
  return null;
}

function rememberPlace(id, win) {
  const b = win.getBounds();
  const widget = widgetWindows.get(id)?.widget;
  settings = {
    ...settings,
    widgets: {
      ...settings.widgets,
      [id]: { x: b.x, y: b.y, width: b.width, height: b.height, size: widget?.size ?? null },
    },
  };
  save();
}

// ---------- the coordinator's minute: one page sends the offline queue and reloads every 15 minutes ----------
let minute = 0;
function coordinator() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow.webContents;
  for (const { win } of widgetWindows.values()) if (!win.isDestroyed()) return win.webContents;
  return null;
}
function tick() {
  const target = coordinator();
  if (target) target.send("boni:event", { type: "tick", minute });
  minute++;
}

// ---------- tray ----------
function updateTray() {
  if (!tray) {
    tray = new Tray(
      nativeImage.createFromPath(path.join(__dirname, "tray.png")).resize({ width: 22 }),
    );
    tray.setToolTip("Boni");
    tray.on("click", () => openMain());
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: labels.open, click: () => openMain() },
      { label: labels.capture, click: () => openMain("capture") },
      { type: "separator" },
      {
        label: labels.widgets,
        type: "checkbox",
        checked: settings.showWidgets,
        click: (item) => setSettings({ showWidgets: item.checked }),
      },
      ...(packaged()
        ? [
            {
              label: labels.autostart,
              type: "checkbox",
              checked: autostart.isOn(P.autostart),
              click: (item) => setSettings({ autostart: item.checked }),
            },
          ]
        : []),
      { label: labels.refresh, click: () => broadcast({ type: "refresh" }) },
      { label: labels.settings, click: () => openMain("settings") },
      { type: "separator" },
      {
        label: labels.quit,
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function setSettings(patch) {
  const before = settings;
  settings = S.applyPatch(settings, patch);
  if (settings.serverUrl !== before.serverUrl) settings = { ...settings, token: "", user: "" };
  save();
  if (settings.serverUrl !== before.serverUrl) live.restart();
  if (typeof patch?.autostart === "boolean" && packaged()) {
    try {
      autostart.setOn(P.autostart, patch.autostart, execPath());
    } catch (e) {
      log(`autostart: ${e.message}`);
    }
  }
  if (
    before.showWidgets !== settings.showWidgets ||
    before.hiddenWidgets !== settings.hiddenWidgets ||
    patch?.resetWidgets
  ) {
    if (patch?.resetWidgets) for (const entry of widgetWindows.values()) entry.win.destroy();
    if (patch?.resetWidgets) widgetWindows.clear();
    reconcileWidgets();
  }
  updateTray();
  broadcast({ type: "settings", settings: clientSettings() });
  return clientSettings();
}

// ---------- account: log in and out (as Boni Calendar), done here so the password and the token stay here ----------
async function postJson(url, body, token) {
  const r = await net.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Boni-Client": "boni-desktop",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20_000),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

ipcMain.handle("account:suggested-device", async () => {
  // An old device token knows its device's name: logging in with it keeps that device's widgets.
  let old = "";
  if (settings.token && !settings.user && settings.serverUrl) {
    try {
      const r = await net.fetch(new URL("api/v1/me", `${settings.serverUrl}/`).href, {
        headers: { Authorization: `Bearer ${settings.token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) old = (await r.json())?.device ?? "";
    } catch {
      old = "";
    }
  }
  return S.suggestedDevice(old || settings.device, os.hostname());
});

ipcMain.handle("account:login", async (_e, form) => {
  const url = S.serverUrl(form?.serverUrl);
  const user = String(form?.user ?? "").trim();
  const device = String(form?.device ?? "")
    .trim()
    .slice(0, 80);
  if (!url) return { ok: false, code: "bad-url" };
  if (!user || !form?.password || !device) return { ok: false, code: "missing" };
  let r;
  try {
    r = await postJson(new URL("api/v1/login", `${url}/`).href, {
      user,
      password: String(form.password),
      device,
    });
  } catch (e) {
    log(`login: ${e.message}`);
    return { ok: false, code: "offline" };
  }
  if (r.status === 401) return { ok: false, code: "bad-login" };
  if (r.status === 429) return { ok: false, code: "too-many" };
  if (r.status === 404) return { ok: false, code: "old-server" };
  if (r.status !== 200 || typeof r.json?.token !== "string") return { ok: false, code: "server" };
  const old = settings.token && !settings.user ? settings.token : null;
  settings = {
    ...settings,
    serverUrl: url,
    token: r.json.token,
    user: r.json.user,
    device: r.json.device,
  };
  sessionEnded = false;
  save();
  log(
    `logged in as ${r.json.user} on ${r.json.device}${old ? " (the old device token is no longer used)" : ""}`,
  );
  live.restart();
  broadcast({ type: "settings", settings: clientSettings() });
  broadcast({ type: "changed", what: "all" });
  return { ok: true, settings: clientSettings() };
});

ipcMain.handle("account:logout", async () => {
  if (settings.token && settings.user && settings.serverUrl) {
    try {
      await postJson(new URL("api/v1/logout", `${settings.serverUrl}/`).href, {}, settings.token);
    } catch {
      // offline: the session ends by itself after 90 idle days
    }
  }
  settings = { ...settings, token: "", user: "" };
  save();
  live.stop();
  broadcast({ type: "settings", settings: clientSettings() });
  return clientSettings();
});

// ---------- requests to the server (the page never sees the token) ----------
const METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);
const MAX_BODY = 10 * 1024 * 1024;

ipcMain.handle("api:request", async (_e, method, apiPath, body) => {
  if (!METHODS.has(method) || !allowedPath(apiPath)) {
    return { ok: false, offline: true, message: "bad request" };
  }
  if (!settings.serverUrl || !settings.token)
    return { ok: false, offline: false, notConfigured: true };
  try {
    const url = new URL(apiPath, `${settings.serverUrl}/`);
    const r = await net.fetch(url.href, {
      method,
      headers: {
        Authorization: `Bearer ${settings.token}`,
        "X-Boni-Client": "boni-desktop",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await r.text();
    if (r.status === 401 && !sessionEnded) {
      sessionEnded = true;
      broadcast({ type: "settings", settings: clientSettings() });
    }
    return { ok: true, status: r.status, body: text.length > MAX_BODY ? "" : text };
  } catch (e) {
    return { ok: false, offline: true, message: String(e.message ?? e) };
  }
});

// ---------- attachments (a row's file), opened with the system's app ----------
let filesDir = null;
ipcMain.handle("file:open", async (_e, sha, name) => {
  if (!F.isSha(sha)) return "error";
  if (!settings.serverUrl || !settings.token) return "error";
  try {
    const r = await net.fetch(new URL(`api/data/files/${sha}`, `${settings.serverUrl}/`).href, {
      headers: { Authorization: `Bearer ${settings.token}`, "X-Boni-Client": "boni-desktop" },
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) return "error";
    const data = Buffer.from(await r.arrayBuffer());
    filesDir ??= fs.mkdtempSync(path.join(os.tmpdir(), "boni-files-"));
    fs.chmodSync(filesDir, 0o700);
    const dir = fs.mkdtempSync(path.join(filesDir, "f-"));
    const file = path.join(dir, F.safeFileName(name));
    fs.writeFileSync(file, data, { mode: 0o600 });
    if (process.env.BONI_TEST_FILES) return F.opensDirectly(file) ? "opened" : "shown";
    if (!F.opensDirectly(file)) {
      shell.showItemInFolder(file);
      return "shown";
    }
    return (await shell.openPath(file)) ? "error" : "opened";
  } catch {
    return "offline";
  }
});

// ---------- small files of the page (queue, last chart answers, widget list) ----------
const STORE_NAME = /^[A-Za-z0-9._-]+\.json$/;
const storeFile = (name) => {
  if (typeof name !== "string" || !STORE_NAME.test(name) || name.startsWith("."))
    throw new Error("bad name");
  return path.join(P.store, name);
};
ipcMain.handle("store:read", (_e, name) => {
  try {
    return fs.readFileSync(storeFile(name), "utf8");
  } catch {
    return null;
  }
});
ipcMain.handle("store:write", (_e, name, text) => {
  if (typeof text !== "string") return;
  const file = storeFile(name);
  fs.mkdirSync(P.store, { recursive: true });
  const tmp = path.join(P.store, `.${name}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  if (name === "widgets.json") {
    // The page loaded the list from the server: windows follow it.
    try {
      widgetList = JSON.parse(text).widgets ?? [];
    } catch {
      widgetList = [];
    }
  }
});
ipcMain.handle("store:remove", (_e, name) => {
  fs.rmSync(storeFile(name), { force: true });
});

// ---------- settings and shell actions ----------
ipcMain.handle("settings:get", () => clientSettings());
ipcMain.handle("settings:set", (_e, patch) => setSettings(patch));
ipcMain.on("shell:set-widgets", (_e, list) => {
  if (!Array.isArray(list)) return;
  widgetList = list.filter((w) => w && typeof w.id === "string" && typeof w.chart_id === "string");
  reconcileWidgets();
});
ipcMain.on("shell:broadcast-refresh", (e) => broadcast({ type: "refresh" }, e.sender));
ipcMain.on("shell:open-main", (_e, screenId) =>
  openMain(typeof screenId === "string" ? screenId : undefined),
);
ipcMain.on("shell:labels", (_e, next) => {
  if (next && typeof next === "object") {
    labels = {
      ...labels,
      ...Object.fromEntries(Object.entries(next).filter(([, v]) => typeof v === "string")),
    };
    updateTray();
  }
});
// Dragging and resizing follow the real pointer (where the cursor is on the screen), not coordinates from the page:
// those shift as the window moves under the pointer.
const drags = new Map(); // webContents id -> { kind, cursor, bounds }
ipcMain.on("widget:drag-start", (e, kind) => {
  const w = widgetOf(e.sender);
  if (!w || (kind !== "move" && kind !== "resize")) return;
  drags.set(e.sender.id, {
    kind,
    cursor: screen.getCursorScreenPoint(),
    bounds: w.win.getBounds(),
  });
});
ipcMain.on("widget:drag-move", (e) => {
  const w = widgetOf(e.sender);
  const d = drags.get(e.sender.id);
  if (!w || !d) return;
  const c = screen.getCursorScreenPoint();
  const dx = c.x - d.cursor.x;
  const dy = c.y - d.cursor.y;
  if (d.kind === "move") w.win.setPosition(d.bounds.x + dx, d.bounds.y + dy);
  else {
    w.win.setSize(
      W.clamp(d.bounds.width + dx, W.MIN.width, W.MAX.width),
      W.clamp(d.bounds.height + dy, W.MIN.height, W.MAX.height),
    );
  }
});
ipcMain.on("widget:drag-end", (e) => {
  const w = widgetOf(e.sender);
  const d = drags.get(e.sender.id);
  drags.delete(e.sender.id);
  if (!w || !d) return;
  const b = w.win.getBounds();
  if (
    b.x !== d.bounds.x ||
    b.y !== d.bounds.y ||
    b.width !== d.bounds.width ||
    b.height !== d.bounds.height
  ) {
    rememberPlace(w.id, w.win);
  }
});
ipcMain.on("widget:hide", (e) => {
  const w = widgetOf(e.sender);
  if (!w) return;
  settings = { ...settings, hiddenWidgets: [...new Set([...settings.hiddenWidgets, w.id])] };
  save();
  reconcileWidgets();
});

// ---------- first run of this client: what the old one left ----------
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Where the first client's Cinnamon desklets were (read-only; Boni never changes Cinnamon's settings). */
function oldDesklets(done) {
  execFile(
    "gsettings",
    ["get", "org.cinnamon", "enabled-desklets"],
    { timeout: 3000 },
    (err, out) => {
      if (err) return done(new Map());
      const entries =
        String(out)
          .match(/'[^']*'/g)
          ?.map((s) => s.slice(1, -1)) ?? [];
      const spices = path.join(path.dirname(P.config), "cinnamon", "spices", "boni@juanbonastre");
      done(
        W.deskletPlaces(entries, (instance) =>
          Number(readJson(path.join(spices, `${instance}.json`))?.slot?.value),
        ),
      );
    },
  );
}

function start() {
  Menu.setApplicationMenu(null);
  const cached = readJson(path.join(P.store, "widgets.json"));
  widgetList = Array.isArray(cached?.widgets) ? cached.widgets : [];
  const background = process.argv.includes("--background");
  log(
    `start ${app.getVersion()} ${background ? "in background" : "with window"}; desktop=${process.env.XDG_CURRENT_DESKTOP} ` +
      `session=${process.env.XDG_SESSION_TYPE} layer=${layer ?? "none"} configured=${Boolean(settings.serverUrl && settings.token)}`,
  );
  const go = () => {
    if (packaged()) {
      try {
        autostart.refresh(P.autostart, execPath());
        if (!settings.autostartOffered) {
          // Widgets are meant to be there at login: switched on once (Settings and the tray switch it off).
          autostart.setOn(P.autostart, true, execPath());
          settings = { ...settings, autostartOffered: true };
          save();
        }
      } catch (e) {
        log(`autostart: ${e.message}`);
      }
    }
    updateTray();
    reconcileWidgets();
    // The peek is made ahead (hidden), so "Abrir en Boni" shows a note at once.
    if (settings.serverUrl && settings.token && !process.env.BONI_SCREENSHOT)
      setTimeout(() => void makePeek(), 4000);
    live.restart();
    // Started by a boni:// link (Boni Calendar's "Abrir en Boni"): the window, on what it names.
    const link = linkIn(process.argv);
    const opened = link ? screenOfUrl(link) : null;
    if (opened?.peek) void openPeek(opened.screen);
    else if (link) openMain(opened?.screen);
    else if (!background || !settings.serverUrl || !settings.token || process.env.BONI_SCREENSHOT)
      openMain();
    setTimeout(tick, 3000);
    setInterval(tick, 60_000);
  };
  if (settings.version < S.VERSION) {
    oldDesklets((places) => {
      settings = S.migrate(
        settings,
        widgetList.map((w) => w.id),
        places,
      );
      save();
      log(`settings migrated (desklet places: ${places.size})`);
      go();
    });
  } else go();
}

if (!process.env.BONI_SCREENSHOT && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Opening Boni again (the menu) shows the one that runs in the tray; the autostart's second start does nothing.
  app.on("second-instance", (_e, argv) => {
    const link = linkIn(argv);
    const opened = link ? screenOfUrl(link) : null;
    if (opened?.peek) void openPeek(opened.screen);
    else if (link) openMain(opened?.screen);
    else if (!argv.includes("--background")) openMain();
  });
  // boni:// links reach here through the .deb's desktop entry (MimeType x-scheme-handler/boni): nothing is
  // registered at run time, so a start from the source or a test never changes the user's settings.
  app.on("before-quit", () => {
    quitting = true;
  });
  // The attachments opened in this session go with it.
  app.on("will-quit", () => {
    if (filesDir) fs.rmSync(filesDir, { recursive: true, force: true });
  });
  app.whenReady().then(start);
  // Windows come and go; Boni lives in the tray until "Quit".
  app.on("window-all-closed", () => {
    if (quitting) app.quit();
  });
}
