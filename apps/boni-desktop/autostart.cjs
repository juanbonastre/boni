// Start at login: a standard XDG autostart entry (Cinnamon, GNOME, KDE...) that starts Boni in the background
// (the tray icon and the widgets). Same file name as the first client's, so its choice is kept; the program path
// in it is rewritten at every start, so an entry of the old app points at this one.
const fs = require("node:fs");
const path = require("node:path");

const ENTRY = "boni.desktop";

function entryText(exec) {
  const quoted = `"${String(exec).replace(/(["`$\\])/g, "\\$1")}"`;
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Boni",
    "Comment=Boni: gráficas y widgets en el escritorio",
    `Exec=${quoted} --background`,
    "Icon=boni",
    "X-GNOME-Autostart-enabled=true",
    "X-GNOME-Autostart-Delay=5",
    "Terminal=false",
    "",
  ].join("\n");
}

const isOn = (dir) => fs.existsSync(path.join(dir, ENTRY));

function setOn(dir, on, exec) {
  const file = path.join(dir, ENTRY);
  if (!on) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, entryText(exec));
}

/** An existing entry (maybe the old app's) now starts this program. */
function refresh(dir, exec) {
  const file = path.join(dir, ENTRY);
  if (!fs.existsSync(file)) return false;
  const text = entryText(exec);
  if (fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text);
  return true;
}

module.exports = { ENTRY, entryText, isOn, setOn, refresh };
