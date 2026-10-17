const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadPrefs, savePrefs, autostartDir, setAutostart, ENTRY } = require("./desktop-prefs.cjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "boni-desktop-"));

test("prefs default to running in the background, not starting with the session", () => {
  const dir = tmp();
  const file = path.join(dir, "desktop.json");
  assert.deepEqual(loadPrefs(file), { background: true, autostart: false });
  savePrefs(file, { background: false, autostart: true });
  assert.deepEqual(loadPrefs(file), { background: false, autostart: true });
  fs.writeFileSync(file, "{broken");
  assert.deepEqual(loadPrefs(file), { background: true, autostart: false });
});

test("starting with the session writes an autostart entry that starts hidden, and removes it", () => {
  const dir = path.join(tmp(), "autostart");
  setAutostart(dir, true, "/opt/Boni Calendar/boni-calendar");
  const text = fs.readFileSync(path.join(dir, ENTRY), "utf8");
  assert.match(text, /^Exec="\/opt\/Boni Calendar\/boni-calendar" --hidden$/m);
  assert.match(text, /^Type=Application$/m);
  setAutostart(dir, false, "x");
  assert.equal(fs.existsSync(path.join(dir, ENTRY)), false);
  setAutostart(dir, false, "x"); // removing twice is fine
});

test("the autostart folder follows XDG_CONFIG_HOME", () => {
  assert.equal(autostartDir({ XDG_CONFIG_HOME: "/tmp/cfg" }), "/tmp/cfg/autostart");
  assert.equal(autostartDir({}), path.join(os.homedir(), ".config", "autostart"));
});
