const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const B = require("./backup.cjs");

const at = (s) => new Date(s).getTime();

test("one copy a day, when on; a failed one is tried again an hour later", () => {
  const now = at("2026-10-23T20:00:00");
  assert.equal(B.due({ on: false }, now), false);
  assert.equal(B.due({ on: true }, now), true);
  assert.equal(B.due({ on: true, last: at("2026-10-23T08:00:00") }, now), false);
  assert.equal(B.due({ on: true, last: at("2026-10-22T23:59:00") }, now), true);
  assert.equal(B.due({ on: true, failedAt: at("2026-10-23T19:30:00") }, now), false);
  assert.equal(B.due({ on: true, failedAt: at("2026-10-23T18:30:00") }, now), true);
  assert.equal(B.nameFor(now), "boni-2026-10-23.zip");
});

test("keeps the last seven of its own copies and never touches anything else", () => {
  const names = [
    "notas.txt",
    "boni-2026-10-23.zip.partial",
    ...Array.from({ length: 9 }, (_, i) => `boni-2026-10-${String(10 + i).padStart(2, "0")}.zip`),
  ];
  assert.deepEqual(B.toRemove(names, 7), ["boni-2026-10-10.zip", "boni-2026-10-11.zip"]);
  assert.deepEqual(B.toRemove(["boni-2026-10-10.zip"], 7), []);
});

test("a folder is an absolute path, never the root or anything odd", () => {
  assert.equal(B.cleanDir(" /SamsungSSD/Copias/Boni/ "), "/SamsungSSD/Copias/Boni");
  for (const bad of ["", "relativa/carpeta", "/", "/a\nb", 3, null])
    assert.equal(B.cleanDir(bad), null, String(bad));
  assert.equal(B.DEFAULT_DIR, "/SamsungSSD/Copias/Boni");
});

test("a missing folder is made only on a disk that is there: an empty mount point is refused", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boni-backup-"));
  try {
    // An external disk that is not mounted: its mount point exists and is empty.
    fs.mkdirSync(path.join(root, "Disco"));
    assert.equal(B.prepareDir(path.join(root, "Disco", "Copias", "Boni"), 0), "not-mounted");
    assert.equal(fs.existsSync(path.join(root, "Disco", "Copias")), false);
    // Mounted (something in it): the folders are made.
    fs.writeFileSync(path.join(root, "Disco", "algo.txt"), "x");
    assert.equal(B.prepareDir(path.join(root, "Disco", "Copias", "Boni"), 0), null);
    assert.equal(fs.statSync(path.join(root, "Disco", "Copias", "Boni")).isDirectory(), true);
    // Not enough room.
    assert.equal(
      B.prepareDir(path.join(root, "Disco", "Copias", "Boni"), Number.MAX_SAFE_INTEGER),
      "no-space",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
