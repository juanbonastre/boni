const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { notePath, openVault, VaultError } = require("./vault-fs.cjs");

function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boni-vault-"));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  put("agenda/docencia/2026-12-22 Clase de ejemplo.md", '---\ntitle: "Clase"\n---\n');
  put("agenda/planes/2026-11-01 Plan.md", "---\n---\n");
  put("agenda/planes/notes.txt", "not a note");
  put("agenda/.hidden/x.md", "hidden");
  put("private/secret.md", "secret");
  put("restricted/secret.md", "secret");
  put("wiki/otra.md", "other");
  return { root, put, vault: openVault(root) };
}

const code = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof VaultError, `unexpected error: ${e}`);
    return e.code;
  }
  return null;
};

test("scan lists only visible Markdown notes below a folder", () => {
  const { vault } = makeVault();
  const paths = vault
    .scan("agenda")
    .map((n) => n.path)
    .sort();
  assert.deepEqual(paths, [
    "agenda/docencia/2026-12-22 Clase de ejemplo.md",
    "agenda/planes/2026-11-01 Plan.md",
  ]);
  const [first] = vault.scan("agenda/docencia");
  assert.ok(first.mtimeMs > 0 && first.size > 0);
});

test("paths cannot leave the vault or reach reserved folders and dot folders", () => {
  const { vault } = makeVault();
  assert.equal(
    code(() => vault.read("../outside.md")),
    "bad-path",
  );
  assert.equal(
    code(() => vault.read("/etc/passwd.md")),
    "bad-path",
  );
  assert.equal(
    code(() => vault.read("agenda/../private/secret.md")),
    "bad-path",
  );
  assert.equal(
    code(() => vault.read("private/secret.md")),
    "denied",
  );
  assert.equal(
    code(() => vault.read("restricted/secret.md")),
    "denied",
  );
  assert.equal(
    code(() => vault.scan("private")),
    "denied",
  );
  assert.equal(
    code(() => vault.read("agenda/.hidden/x.md")),
    "bad-path",
  );
  assert.equal(
    code(() => vault.read(".obsidian/app.md")),
    "bad-path",
  );
  assert.equal(
    code(() => vault.read("agenda/planes/notes.txt")),
    "bad-path",
  );
  assert.equal(
    code(() => vault.read("agenda/nope.md")),
    "not-found",
  );
  assert.equal(
    code(() => vault.scan("agenda/nope")),
    "not-found",
  );
});

test("a note path is checked the same without a vault folder (opening a server's note)", () => {
  assert.deepEqual(notePath("agenda/docencia/2025-09-17 Clase.md"), [
    "agenda",
    "docencia",
    "2025-09-17 Clase.md",
  ]);
  assert.equal(
    code(() => notePath("../fuera.md")),
    "bad-path",
  );
  assert.equal(
    code(() => notePath("private/x.md")),
    "denied",
  );
  assert.equal(
    code(() => notePath(".obsidian/app.md")),
    "bad-path",
  );
  assert.equal(
    code(() => notePath("agenda/imagen.png")),
    "bad-path",
  );
});

test("a symlink out of the vault is refused", () => {
  const { root, vault } = makeVault();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "boni-outside-"));
  fs.writeFileSync(path.join(outside, "leak.md"), "leak");
  fs.symlinkSync(outside, path.join(root, "agenda", "link"));
  assert.equal(
    code(() => vault.read("agenda/link/leak.md")),
    "bad-path",
  );
});

test("write replaces a note atomically and detects a change made meanwhile", () => {
  const { root, vault } = makeVault();
  const rel = "agenda/docencia/2026-12-22 Clase de ejemplo.md";
  const { text, mtimeMs } = vault.read(rel);
  const ok = vault.write(rel, text.replace("Clase", "Clase 2"), mtimeMs);
  assert.equal(ok.conflict, false);
  assert.match(fs.readFileSync(path.join(root, rel), "utf8"), /Clase 2/);
  assert.deepEqual(
    fs.readdirSync(path.dirname(path.join(root, rel))).filter((f) => f.endsWith(".tmp")),
    [],
  );

  // Someone else edits the file after we read it.
  fs.writeFileSync(path.join(root, rel), "edited elsewhere");
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(root, rel), future, future);
  const clash = vault.write(rel, "ours", ok.mtimeMs);
  assert.equal(clash.conflict, true);
  assert.equal(fs.readFileSync(path.join(root, rel), "utf8"), "edited elsewhere");
  assert.equal(vault.write(rel, "forced", null).conflict, false);
});

test("write keeps the file mode and refuses missing notes", () => {
  const { root, vault } = makeVault();
  const rel = "agenda/planes/2026-11-01 Plan.md";
  fs.chmodSync(path.join(root, rel), 0o640);
  vault.write(rel, "x", null);
  assert.equal(fs.statSync(path.join(root, rel)).mode & 0o777, 0o640);
  assert.equal(
    code(() => vault.write("agenda/planes/missing.md", "x", null)),
    "not-found",
  );
});

test("create makes parent folders and never overwrites", () => {
  const { root, vault } = makeVault();
  const rel = "agenda/salud/2026-12-01 Cita.md";
  const made = vault.create(rel, "---\n---\n");
  assert.equal(made.exists, false);
  assert.ok(fs.existsSync(path.join(root, rel)));
  assert.deepEqual(vault.create(rel, "other"), { exists: true });
  assert.equal(fs.readFileSync(path.join(root, rel), "utf8"), "---\n---\n");
  assert.equal(
    code(() => vault.create("private/new.md", "x")),
    "denied",
  );
});

test("a root that is not a folder is rejected", () => {
  assert.throws(
    () => openVault("/definitely/not/here"),
    (e) => e.code === "bad-root",
  );
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("watch reports one change per burst, for notes only, and stops when closed", async () => {
  const { root, vault } = makeVault();
  let calls = 0;
  const stop = vault.watch(["agenda"], () => calls++, 80);
  await wait(100);
  const file = path.join(root, "agenda", "planes", "2026-11-01 Plan.md");
  fs.writeFileSync(file, "a");
  fs.writeFileSync(file, "b");
  fs.writeFileSync(path.join(root, "agenda", "planes", "nuevo.md"), "c");
  await wait(400);
  assert.equal(calls, 1);

  fs.writeFileSync(path.join(root, "agenda", "planes", "notes.txt"), "not a note");
  fs.writeFileSync(path.join(root, "agenda", "planes", ".hidden.tmp"), "temp");
  await wait(300);
  assert.equal(calls, 1);

  fs.rmSync(file);
  await wait(300);
  assert.equal(calls, 2);

  stop();
  fs.writeFileSync(file, "after");
  await wait(300);
  assert.equal(calls, 2);
});

test("watch skips folders that do not exist and refuses reserved ones", () => {
  const { vault } = makeVault();
  const stop = vault.watch(["agenda/nope"], () => {}, 10);
  stop();
  assert.equal(
    code(() => vault.watch(["private"], () => {}, 10)),
    "denied",
  );
});

test("rename moves a note across folders without overwriting", () => {
  const { root, vault } = makeVault();
  const from = "agenda/docencia/2026-12-22 Clase de ejemplo.md";
  const to = "agenda/salud/2026-12-22 Clase de ejemplo.md";
  const r = vault.rename(from, to);
  assert.equal(r.exists, false);
  assert.ok(!fs.existsSync(path.join(root, from)));
  assert.ok(fs.existsSync(path.join(root, to)));
  assert.deepEqual(vault.rename(to, "agenda/planes/2026-11-01 Plan.md"), { exists: true });
  assert.equal(
    code(() => vault.rename("agenda/nope.md", "agenda/x.md")),
    "not-found",
  );
  assert.equal(
    code(() => vault.rename(to, "private/x.md")),
    "denied",
  );
});

test("trash sends a note away and refuses what is not a note", async () => {
  const { root, vault } = makeVault();
  const rel = "agenda/planes/2026-11-01 Plan.md";
  await vault.trash(rel);
  assert.ok(!fs.existsSync(path.join(root, rel)));
  assert.ok(fs.existsSync(path.join(root, ".trash", "2026-11-01 Plan.md")));
  // a second note with the same name does not overwrite the first one in the trash
  fs.writeFileSync(path.join(root, rel), "again");
  await vault.trash(rel);
  assert.ok(fs.existsSync(path.join(root, ".trash", "2026-11-01 Plan 2.md")));
  await assert.rejects(
    () => vault.trash("private/secret.md"),
    (e) => e.code === "denied",
  );
  await assert.rejects(
    () => vault.trash("agenda/nope.md"),
    (e) => e.code === "not-found",
  );

  const sent = [];
  const other = openVault(makeVault().root, { trashItem: async (p) => sent.push(p) });
  await other.trash("agenda/planes/2026-11-01 Plan.md");
  assert.equal(sent.length, 1);
});

test("locate gives the absolute path of an existing note only", () => {
  const { root, vault } = makeVault();
  assert.equal(
    vault.locate("agenda/planes/2026-11-01 Plan.md"),
    path.join(fs.realpathSync(root), "agenda/planes/2026-11-01 Plan.md"),
  );
  assert.equal(
    code(() => vault.locate("agenda/planes/nope.md")),
    "not-found",
  );
  assert.equal(
    code(() => vault.locate("private/secret.md")),
    "denied",
  );
});
