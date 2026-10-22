const test = require("node:test");
const assert = require("node:assert/strict");
const { linkIn, screenOfUrl } = require("./links.cjs");

test("a boni:// link opens a vault note's row, nothing else", () => {
  const p = encodeURIComponent("agenda/docencia/2026-10-22 Clase de ejemplo.md");
  assert.deepEqual(screenOfUrl(`boni://note?path=${p}`), {
    screen: "note:agenda/docencia/2026-10-22 Clase de ejemplo.md",
    peek: false,
  });
  assert.equal(screenOfUrl(`boni://note?path=${p}&peek=1`)?.peek, true);
  for (const bad of [
    "boni://note?path=..%2Fsecreto.md",
    "boni://note?path=%2Fetc%2Fpasswd.md",
    "boni://note?path=a%2Fb.txt",
    "boni://note",
    "boni://settings?x=1",
    "https://example.com/?path=a.md",
    "no es una url",
    "boni://note?path=a%0Ab.md",
  ])
    assert.equal(screenOfUrl(bad), null, bad);
});

test("boni://peek?hide=1 puts the peek away, nothing more", () => {
  assert.deepEqual(screenOfUrl("boni://peek?hide=1"), { hidePeek: true });
  assert.equal(screenOfUrl("boni://peek"), null);
  assert.equal(screenOfUrl("boni://peek?hide=0"), null);
});

test("finds the link among the arguments of a start", () => {
  assert.equal(linkIn(["/opt/Boni/boni", "--background"]), undefined);
  assert.equal(linkIn(["/opt/Boni/boni", "boni://note?path=a.md"]), "boni://note?path=a.md");
});
