// Boni's files on this computer and its settings. The settings file is the one the first (Kotlin) client used,
// `~/.config/boni/settings.json`, with the same keys, so replacing the app keeps the server, the token and the
// widget places. It holds the device token: written only by this process, readable by the user only (0600).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const B = require("./backup.cjs");

const VERSION = 2;

function xdg(env, name, fallback) {
  const v = env[name];
  return v?.trim() ? v : path.join(os.homedir(), fallback);
}

/** Where Boni keeps its files (XDG). */
function paths(env = process.env) {
  const config = path.join(xdg(env, "XDG_CONFIG_HOME", ".config"), "boni");
  const data = path.join(xdg(env, "XDG_DATA_HOME", ".local/share"), "boni");
  return {
    config,
    settings: path.join(config, "settings.json"),
    data,
    store: path.join(data, "store"),
    log: path.join(data, "boni.log"),
    autostart: path.join(xdg(env, "XDG_CONFIG_HOME", ".config"), "autostart"),
  };
}

const THEMES = new Set(["system", "dark", "light"]);
const LANGS = new Set(["es", "en"]);

const DEFAULTS = {
  version: VERSION,
  serverUrl: "",
  token: "",
  // who the token belongs to (from the login); empty with an old device token
  user: "",
  device: "",
  theme: "system",
  language: "es",
  showWidgets: true,
  widgets: {},
  hiddenWidgets: [],
  autostartOffered: false,
  // The daily copy of everything on this computer (backup.cjs): off until Juan turns it on in "Tus datos".
  backupOn: false,
  backupDir: B.DEFAULT_DIR,
  backupLast: 0,
  backupBytes: 0,
  backupError: "",
  backupFailedAt: 0,
};

function cleanPlacement(p) {
  if (!p || typeof p !== "object") return null;
  const n = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  const x = n(p.x);
  const y = n(p.y);
  if (x == null || y == null) return null;
  return {
    x,
    y,
    width: n(p.width),
    height: n(p.height),
    size: typeof p.size === "string" ? p.size : null,
  };
}

/** Reads the settings; anything missing or broken falls back to the defaults (never throws). */
function loadSettings(file) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    raw = {};
  }
  const s = { ...DEFAULTS, ...raw };
  const widgets = {};
  for (const [id, p] of Object.entries(
    s.widgets && typeof s.widgets === "object" ? s.widgets : {},
  )) {
    const c = cleanPlacement(p);
    if (c) widgets[id] = c;
  }
  return {
    version: Number(raw.version) || 1,
    serverUrl: typeof s.serverUrl === "string" ? s.serverUrl.trim() : "",
    token: typeof s.token === "string" ? s.token.trim() : "",
    user: typeof s.user === "string" ? s.user : "",
    device: typeof s.device === "string" ? s.device : "",
    theme: THEMES.has(s.theme) ? s.theme : "system",
    language: LANGS.has(s.language) ? s.language : "es",
    showWidgets: s.showWidgets !== false,
    widgets,
    hiddenWidgets: Array.isArray(s.hiddenWidgets)
      ? s.hiddenWidgets.filter((h) => typeof h === "string")
      : [],
    autostartOffered: Boolean(s.autostartOffered),
    backupOn: s.backupOn === true,
    backupDir: B.cleanDir(s.backupDir) ?? B.DEFAULT_DIR,
    backupLast: Number.isFinite(s.backupLast) ? s.backupLast : 0,
    backupBytes: Number.isFinite(s.backupBytes) ? s.backupBytes : 0,
    backupError: typeof s.backupError === "string" ? s.backupError.slice(0, 40) : "",
    backupFailedAt: Number.isFinite(s.backupFailedAt) ? s.backupFailedAt : 0,
    // Kept as they were (the first client's widget mode); unused here.
    ...(typeof raw.widgetMode === "string" ? { widgetMode: raw.widgetMode } : {}),
  };
}

/** Writes atomically (temp file + rename) with permissions 0600. */
function saveSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), ".settings.json.tmp");
  fs.writeFileSync(tmp, JSON.stringify({ ...settings, version: VERSION }, null, 2), {
    mode: 0o600,
  });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

/**
 * Settings of the first client, the first time this one runs: its widgets were Cinnamon desklets and the window
 * widgets it had were hidden, so every widget is shown again, where its desklet was (`desklets`: index -> {x, y}).
 */
function migrate(settings, widgetIds, desklets) {
  if (settings.version >= VERSION) return settings;
  const widgets = { ...settings.widgets };
  widgetIds.forEach((id, i) => {
    const d = desklets.get(i);
    if (d && !widgets[id]) widgets[id] = { x: d.x, y: d.y, width: null, height: null, size: null };
  });
  return { ...settings, version: VERSION, hiddenWidgets: [], widgets };
}

/** What the page may know: never the token. */
function clientView(settings, extra) {
  return {
    serverUrl: settings.serverUrl,
    hasToken: Boolean(settings.token),
    user: settings.user,
    device: settings.device,
    // a token of the first clients (`boni device add`), from before accounts: the page asks to log in
    legacyToken: Boolean(settings.token) && !settings.user,
    theme: settings.theme,
    language: settings.language,
    showWidgets: settings.showWidgets,
    hiddenWidgets: settings.hiddenWidgets,
    backup: {
      on: settings.backupOn,
      dir: settings.backupDir,
      keep: B.KEEP,
      last: settings.backupLast || null,
      bytes: settings.backupBytes,
      error: settings.backupError || null,
      running: Boolean(extra?.backupRunning),
    },
    ...extra,
  };
}

/** Applies a patch from the page, checking every value (the token only comes from a login). */
function applyPatch(settings, patch) {
  const next = { ...settings };
  if (!patch || typeof patch !== "object") return next;
  if (typeof patch.serverUrl === "string") {
    const url = patch.serverUrl.trim();
    if (url === "" || /^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(url))
      next.serverUrl = url.replace(/\/+$/, "");
  }
  if (THEMES.has(patch.theme)) next.theme = patch.theme;
  if (LANGS.has(patch.language)) next.language = patch.language;
  if (typeof patch.showWidgets === "boolean") next.showWidgets = patch.showWidgets;
  const h = patch.widgetHidden;
  if (h && typeof h.id === "string" && typeof h.hidden === "boolean") {
    const others = settings.hiddenWidgets.filter((id) => id !== h.id);
    next.hiddenWidgets = h.hidden ? [...others, h.id] : others;
  }
  if (typeof patch.backupOn === "boolean") next.backupOn = patch.backupOn;
  if (typeof patch.backupDir === "string") {
    const d = B.cleanDir(patch.backupDir);
    if (d) next.backupDir = d;
  }
  if (patch.resetWidgets === true) {
    next.widgets = {};
    next.hiddenWidgets = [];
  }
  return next;
}

/** The device's name offered at the first login: the old token's device, or the computer's name. */
function suggestedDevice(oldDevice, hostname) {
  const clean = (v) =>
    String(v ?? "")
      .trim()
      .slice(0, 80);
  return clean(oldDevice) || clean(hostname).toLowerCase() || "equipo";
}

/** A server address the main process may talk to: http(s), no credentials, no trailing slash. */
function serverUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password)
      return null;
    return u.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

module.exports = {
  suggestedDevice,
  serverUrl,
  VERSION,
  DEFAULTS,
  paths,
  loadSettings,
  saveSettings,
  migrate,
  clientView,
  applyPatch,
};
