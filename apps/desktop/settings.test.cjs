const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const S = require("./settings.cjs");
const autostart = require("./autostart.cjs");

const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boni-desktop-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test("reads the first client's settings file as it is, and writes it back private", (t) => {
  const file = path.join(tmp(t), "settings.json");
  // Exactly what the Kotlin client wrote (invented values).
  fs.writeFileSync(
    file,
    JSON.stringify({
      serverUrl: "https://boni.example.ts.net",
      token: "tok-ejemplo",
      showWidgets: true,
      theme: "system",
      widgets: { "w-a": { x: 10, y: 20, width: 300, height: 200, size: "small" } },
      hiddenWidgets: ["w-a", "w-b"],
      widgetMode: "",
      autostartOffered: true,
    }),
  );
  const s = S.loadSettings(file);
  assert.equal(s.version, 1);
  assert.equal(s.serverUrl, "https://boni.example.ts.net");
  assert.equal(s.token, "tok-ejemplo");
  assert.deepEqual(s.widgets["w-a"], { x: 10, y: 20, width: 300, height: 200, size: "small" });
  assert.deepEqual(s.hiddenWidgets, ["w-a", "w-b"]);
  assert.equal(s.autostartOffered, true);
  S.saveSettings(file, s);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(S.loadSettings(file).version, S.VERSION);
});

test("a missing or broken file gives the defaults", (t) => {
  const dir = tmp(t);
  assert.equal(S.loadSettings(path.join(dir, "none.json")).serverUrl, "");
  fs.writeFileSync(path.join(dir, "bad.json"), "{broken");
  const s = S.loadSettings(path.join(dir, "bad.json"));
  assert.equal(s.theme, "system");
  assert.equal(s.showWidgets, true);
});

test("the first run shows every widget again, where its desklet was", () => {
  const old = {
    ...S.loadSettings("/nonexistent"),
    version: 1,
    hiddenWidgets: ["w-a", "w-b"],
    widgets: {},
  };
  const places = new Map([
    [0, { x: 1325, y: 25 }],
    [1, { x: 1325, y: 425 }],
  ]);
  const s = S.migrate(old, ["w-a", "w-b", "w-c"], places);
  assert.deepEqual(s.hiddenWidgets, []);
  assert.equal(s.widgets["w-a"].x, 1325);
  assert.equal(s.widgets["w-b"].y, 425);
  assert.equal(s.widgets["w-c"], undefined);
  assert.equal(s.version, S.VERSION);
  // only once
  const again = S.migrate({ ...s, hiddenWidgets: ["w-c"] }, ["w-a"], places);
  assert.deepEqual(again.hiddenWidgets, ["w-c"]);
});

test("the page never gets the token, and its patches are checked", () => {
  const s = { ...S.loadSettings("/nonexistent"), serverUrl: "https://a.example", token: "secreto" };
  const view = S.clientView(s, { autostart: false, layerAvailable: true });
  assert.equal(view.hasToken, true);
  assert.ok(!JSON.stringify(view).includes("secreto"));
  const p = S.applyPatch(s, {
    serverUrl: "https://b.example/",
    token: "  nuevo ",
    theme: "pink",
    language: "en",
  });
  assert.equal(p.serverUrl, "https://b.example");
  assert.equal(p.token, "nuevo");
  assert.equal(p.theme, "system");
  assert.equal(p.language, "en");
  assert.equal(
    S.applyPatch(s, { serverUrl: "javascript:alert(1)" }).serverUrl,
    "https://a.example",
  );
  assert.equal(S.applyPatch(s, { token: "" }).token, "secreto");
  const reset = S.applyPatch(
    { ...s, widgets: { a: { x: 1, y: 2 } }, hiddenWidgets: ["a"] },
    { resetWidgets: true },
  );
  assert.deepEqual(reset.widgets, {});
  assert.deepEqual(reset.hiddenWidgets, []);
});

test("autostart: an entry that starts in the background, rewritten to point at this program", (t) => {
  const dir = path.join(tmp(t), "autostart");
  assert.equal(autostart.refresh(dir, "/opt/Boni/boni"), false);
  autostart.setOn(dir, true, "/opt/boni/bin/boni");
  assert.equal(autostart.isOn(dir), true);
  assert.equal(autostart.refresh(dir, "/opt/Boni/boni"), true);
  const text = fs.readFileSync(path.join(dir, autostart.ENTRY), "utf8");
  assert.match(text, /^Exec="\/opt\/Boni\/boni" --background$/m);
  autostart.setOn(dir, false, "x");
  assert.equal(autostart.isOn(dir), false);
});
