const test = require("node:test");
const assert = require("node:assert/strict");
const { linkIn, screenOfUrl } = require("./links.cjs");

test("a boni:// link opens a record by its id, nothing else (notes have no paths)", () => {
  const id = "e_01m5m5fkq7w3mhh4ywc6aa22zz";
  assert.deepEqual(screenOfUrl(`boni://note?id=${id}`), { screen: `note:${id}`, peek: false });
  assert.equal(screenOfUrl(`boni://note?id=${id}&peek=1`)?.peek, true);
  for (const bad of [
    "boni://note?path=agenda%2Fdocencia%2Fclase.md",
    "boni://note?id=..%2Fsecreto",
    "boni://note?id=a%2Fb",
    "boni://note",
    "boni://settings?id=x",
    "https://example.com/?id=e_1",
    "no es una url",
    "boni://note?id=a%0Ab",
    `boni://note?id=${"a".repeat(101)}`,
  ])
    assert.equal(screenOfUrl(bad), null, bad);
});

test("boni://peek?hide=1 puts the peek away, nothing more", () => {
  assert.deepEqual(screenOfUrl("boni://peek?hide=1"), { hidePeek: true });
  assert.equal(screenOfUrl("boni://peek"), null);
  assert.equal(screenOfUrl("boni://peek?hide=0"), null);
});

test("boni://proposal opens a proposal of the inbox by its id, nothing else", () => {
  const id = "0b6f1c2e-5d4a-4c8e-9f10-123456789abc";
  assert.deepEqual(screenOfUrl(`boni://proposal?id=${id}&peek=1`), {
    screen: `proposal:${id}`,
    peek: true,
  });
  assert.equal(screenOfUrl(`boni://proposal?id=${id}`)?.peek, false);
  for (const bad of [
    "boni://proposal",
    "boni://proposal?id=",
    "boni://proposal?id=a%2Fb",
    "boni://proposal?id=note%3Aa.md",
    `boni://proposal?id=${"a".repeat(101)}`,
  ])
    assert.equal(screenOfUrl(bad), null, bad);
});

test("finds the link among the arguments of a start", () => {
  assert.equal(linkIn(["/opt/Boni/boni", "--background"]), undefined);
  assert.equal(linkIn(["/opt/Boni/boni", "boni://note?id=e_1"]), "boni://note?id=e_1");
});
