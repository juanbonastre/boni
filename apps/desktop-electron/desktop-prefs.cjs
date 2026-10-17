// What only the desktop app does, so that its reminders always arrive: keep running in the system tray
// when the window is closed, and start with the session (hidden, in the tray). Both are the user's
// choice in Settings → Desktop; starting with the session writes a standard autostart entry
// (~/.config/autostart/boni-calendar.desktop) and turning it off removes it.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULTS = { background: true, autostart: false };
const ENTRY = "boni-calendar.desktop";

function loadPrefs(file) {
  try {
    const p = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      background: typeof p.background === "boolean" ? p.background : DEFAULTS.background,
      autostart: typeof p.autostart === "boolean" ? p.autostart : DEFAULTS.autostart,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function savePrefs(file, prefs) {
  fs.writeFileSync(file, JSON.stringify(prefs));
}

/** Where desktop sessions look for programs to start (XDG). */
function autostartDir(env = process.env) {
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "autostart");
}

/** The autostart entry: the app (the AppImage when it runs as one), started hidden. */
function autostartEntry(exec) {
  const quoted = `"${String(exec).replace(/(["`$\\])/g, "\\$1")}"`;
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Boni Calendar",
    "Comment=Calendar (in the background, for its reminders)",
    `Exec=${quoted} --hidden`,
    "Icon=boni-calendar-desktop",
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

function setAutostart(dir, on, exec) {
  const file = path.join(dir, ENTRY);
  if (!on) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, autostartEntry(exec));
}

module.exports = {
  DEFAULTS,
  loadPrefs,
  savePrefs,
  autostartDir,
  autostartEntry,
  setAutostart,
  ENTRY,
};
