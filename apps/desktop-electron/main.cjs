// Electron shell for Boni Calendar: loads the built web UI and remembers the window size.
// Env vars (benchmark only):
//   BONI_START_QUERY  query string appended to the page URL, e.g. "bench=auto"
//   BONI_BENCH_OUT    file where the benchmark result is written (the app then quits)
//   BONI_SCREENSHOT   file where a PNG of the window is written after load (the app then quits)
const { app, BrowserWindow, dialog, ipcMain, Menu, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { openVault, VaultError } = require("./vault-fs.cjs");

const PACKAGED_UI = path.join(__dirname, "web", "index.html");
const DEV_UI = path.join(__dirname, "..", "web", "dist", "index.html");
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

function createWindow() {
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
    win.on("close", () => saveState(win));
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  }
}

// ---- vault (the folder of Markdown notes the calendar reads and writes) ----
const vaultFile = () => path.join(app.getPath("userData"), "vault.json");
let vault = null;

function useVault(root) {
  vault = openVault(root);
  fs.writeFileSync(vaultFile(), JSON.stringify({ root: vault.root }));
  return vault.root;
}

function restoreVault() {
  try {
    vault = openVault(JSON.parse(fs.readFileSync(vaultFile(), "utf8")).root);
  } catch {
    vault = null; // nothing chosen yet, or the folder is gone
  }
}

/** Handlers answer `{ ok: true, value }` or `{ ok: false, code, message }`; errors never cross IPC as exceptions. */
function handle(channel, fn) {
  ipcMain.handle(channel, (_e, ...args) => {
    try {
      if (channel !== "vault:choose-root" && !vault)
        throw new VaultError("no-vault", "No vault chosen");
      return { ok: true, value: fn(...args) };
    } catch (e) {
      return { ok: false, code: e.code ?? "error", message: String(e.message ?? e) };
    }
  });
}

handle("vault:get-root", () => vault?.root ?? null);
handle("vault:scan", (dir) => vault.scan(dir));
handle("vault:read", (rel) => vault.read(rel));
handle("vault:write", (rel, text, expectedMtimeMs) => vault.write(rel, text, expectedMtimeMs));
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
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    restoreVault();
    createWindow();
    app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });
  app.on("window-all-closed", () => app.quit());
}
