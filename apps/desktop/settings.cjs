// Boni's files on this computer and its settings. The settings file is the one the first (Kotlin) client used,
// `~/.config/boni/settings.json`, with the same keys, so replacing the app keeps the server, the token and the
// widget places. It holds the device token: written only by this process, readable by the user only (0600).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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
  theme: "system",
  language: "es",
  showWidgets: true,
  widgets: {},
  hiddenWidgets: [],
  autostartOffered: false,
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
    theme: THEMES.has(s.theme) ? s.theme : "system",
    language: LANGS.has(s.language) ? s.language : "es",
    showWidgets: s.showWidgets !== false,
    widgets,
    hiddenWidgets: Array.isArray(s.hiddenWidgets)
      ? s.hiddenWidgets.filter((h) => typeof h === "string")
      : [],
    autostartOffered: Boolean(s.autostartOffered),
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
    theme: settings.theme,
    language: settings.language,
    showWidgets: settings.showWidgets,
    ...extra,
  };
}

/** Applies a patch from the page, checking every value. Returns the new settings. */
function applyPatch(settings, patch) {
  const next = { ...settings };
  if (!patch || typeof patch !== "object") return next;
  if (typeof patch.serverUrl === "string") {
    const url = patch.serverUrl.trim();
    if (url === "" || /^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(url))
      next.serverUrl = url.replace(/\/+$/, "");
  }
  if (typeof patch.token === "string" && patch.token.trim()) next.token = patch.token.trim();
  if (THEMES.has(patch.theme)) next.theme = patch.theme;
  if (LANGS.has(patch.language)) next.language = patch.language;
  if (typeof patch.showWidgets === "boolean") next.showWidgets = patch.showWidgets;
  if (patch.resetWidgets === true) {
    next.widgets = {};
    next.hiddenWidgets = [];
  }
  return next;
}

module.exports = {
  VERSION,
  DEFAULTS,
  paths,
  loadSettings,
  saveSettings,
  migrate,
  clientView,
  applyPatch,
};
