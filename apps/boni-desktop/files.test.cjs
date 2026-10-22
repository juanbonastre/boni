const test = require("node:test");
const assert = require("node:assert/strict");
const { isSha, opensDirectly, safeFileName } = require("./files.cjs");

test("an attachment's name stays inside its folder", () => {
  assert.equal(safeFileName("poliza.pdf"), "poliza.pdf");
  assert.equal(safeFileName("../../.bashrc"), "bashrc");
  assert.equal(safeFileName("a\\b\\c.txt"), "c.txt");
  assert.equal(safeFileName("..."), "archivo");
  assert.equal(safeFileName("x\u0000y\n.pdf"), "xy.pdf");
  assert.equal(safeFileName(""), "archivo");
  assert.equal(safeFileName("a".repeat(300)).length, 120);
});

test("only viewable kinds are opened; the rest is shown in its folder", () => {
  for (const n of ["a.pdf", "b.JPG", "c.docx", "d.txt"]) assert.ok(opensDirectly(n), n);
  for (const n of ["run.sh", "app.desktop", "x.AppImage", "noext", "p.html", "q.svg", "r.jar"])
    assert.ok(!opensDirectly(n), n);
});

test("only a sha256 names a file on the server", () => {
  assert.ok(isSha("a".repeat(64)));
  assert.ok(!isSha("../api/v1"));
  assert.ok(!isSha("A".repeat(64)));
});
