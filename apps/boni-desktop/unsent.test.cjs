const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createUnsent, FILE, QUIT_WAIT_MS } = require("./unsent.cjs");

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), "boni-unsent-"));
const listIn = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, FILE), "utf8"));
  } catch {
    return null;
  }
};
const page = (id, at, title) => ({ path: `api/pages/${id}`, at, write: { title } });

test("only a page's or a row's write is kept until answered", () => {
  const u = createUnsent(folder(), () => 10);
  assert.deepEqual(u.sending("PUT", "api/pages/p1"), { path: "api/pages/p1", at: 10 });
  assert.ok(u.sending("PUT", "api/data/rows/r1"));
  assert.equal(u.sending("GET", "api/pages/p1"), null);
  assert.equal(u.sending("PUT", "api/data/rows/r1/type"), null);
  assert.equal(u.sending("POST", "api/pages"), null);
});

test("a write answered after the window went is taken out of the list; a newer one of the same page stays", () => {
  const dir = folder();
  let clock = 100;
  const u = createUnsent(dir, () => clock);
  // The page sent «Hola» (kept at 90), then went with «Hola mundo» typed at 120, not yet sent.
  const ticket = u.sending("PUT", "api/pages/p1");
  u.keep(JSON.stringify([page("p1", 90, "Hola"), page("p2", 95, "Otra")]));
  clock = 130;
  u.answered(ticket, true);
  assert.deepEqual(listIn(dir), [page("p2", 95, "Otra")]);
  // A newer write of p1, made after the answered one left, is not taken out by that answer.
  const second = u.sending("PUT", "api/pages/p2");
  u.keep(JSON.stringify([page("p2", 95, "Otra"), page("p1", 120, "Hola mundo")]));
  u.answered(second, true);
  assert.deepEqual(listIn(dir), [page("p1", 120, "Hola mundo")]);
});

test("a list the page keeps after an answer it had not seen yet leaves that write out", () => {
  const dir = folder();
  const u = createUnsent(dir, () => 200);
  u.answered(u.sending("PUT", "api/data/rows/r1"), true);
  u.keep(JSON.stringify([{ path: "api/data/rows/r1", at: 150 }]));
  assert.equal(listIn(dir), null);
});

test("a server that could not be reached leaves the write kept", () => {
  const dir = folder();
  const u = createUnsent(dir, () => 300);
  const t = u.sending("PUT", "api/pages/p1");
  u.keep(JSON.stringify([page("p1", 290, "Sin red")]));
  u.answered(t, false);
  assert.deepEqual(listIn(dir), [page("p1", 290, "Sin red")]);
});

test("the main window's list and the peek's are kept together, a write's later fields over its earlier ones", () => {
  const dir = folder();
  const u = createUnsent(dir, () => 500);
  u.keep(
    JSON.stringify([
      page("p1", 10, "Uno"),
      { path: "api/data/rows/r1", at: 20, values: { a: "1" } },
    ]),
  );
  u.keep(JSON.stringify([{ path: "api/data/rows/r1", at: 30, values: { b: "2" }, body: "Texto" }]));
  // An older list of the main window does not take back the peek's later text.
  u.keep(
    JSON.stringify([
      page("p1", 10, "Uno"),
      { path: "api/data/rows/r1", at: 20, values: { a: "1" } },
    ]),
  );
  assert.deepEqual(listIn(dir), [
    page("p1", 10, "Uno"),
    { path: "api/data/rows/r1", at: 30, values: { a: "1", b: "2" }, body: "Texto" },
  ]);
});

test(`quitting waits for the answers in flight, ${QUIT_WAIT_MS} ms at most`, async () => {
  const u = createUnsent(folder());
  const start = Date.now();
  await u.settle();
  assert.ok(Date.now() - start < 50, "nothing in flight: no wait");
  const t = u.sending("PUT", "api/pages/p1");
  setTimeout(() => u.answered(t, true), 50);
  const a = Date.now();
  await u.settle();
  const took = Date.now() - a;
  assert.ok(took >= 40 && took < 500, `waited ${took} ms for the answer`);
  u.sending("PUT", "api/pages/p2");
  const b = Date.now();
  await u.settle(200);
  const bound = Date.now() - b;
  assert.ok(bound >= 190 && bound < 600, `an answer that never comes is waited ${bound} ms`);
});
